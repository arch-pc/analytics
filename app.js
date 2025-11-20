// Globale variabele voor jsPDF om makkelijker te gebruiken
const { jsPDF } = window.jspdf;

// --- 4. State & localStorage ---
const categoryKeys = ["acquisition", "behaviour", "conversion", "loyalty"];
const appState = {
    categories: {
        acquisition: {
            title: "Acquisition",
            includeInPdf: true,
            datasetTitle: "Onbekende dataset",
            notes: "", // NIEUW: Opmerkingen veld
            columns: [],
            columnVisibility: {},
            rows: [], // { id: string, data: { [col]: value }, selected: boolean }
            metricColumn: null,
            chartType: 'bar', // NIEUW: Grafiektype (bar, line)
            sortColumn: null,
            sortDirection: 'asc',
            chartInstance: null
        }
    }
};

// Initialiseer de andere categorieën met de basisstructuur
categoryKeys.forEach(key => {
    if (key !== 'acquisition') {
        appState.categories[key] = {
            title: key.charAt(0).toUpperCase() + key.slice(1),
            includeInPdf: true,
            datasetTitle: "Onbekende dataset",
            notes: "",
            columns: [],
            columnVisibility: {},
            rows: [],
            metricColumn: null,
            chartType: 'bar',
            sortColumn: null,
            sortDirection: 'asc',
            chartInstance: null
        };
    }
});

function saveState() {
    const stateToSave = JSON.parse(JSON.stringify(appState));
    categoryKeys.forEach(key => {
        delete stateToSave.categories[key].chartInstance;
    });
    localStorage.setItem("analyticsDashboardState", JSON.stringify(stateToSave));
}

function loadState() {
    const raw = localStorage.getItem("analyticsDashboardState");
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        categoryKeys.forEach(key => {
            if (parsed.categories[key]) {
                const currentChartInstance = appState.categories[key].chartInstance;
                appState.categories[key] = { ...appState.categories[key], ...parsed.categories[key] };
                appState.categories[key].chartInstance = currentChartInstance;
            }
        });
        const statusEl = document.getElementById('load-status');
        if (statusEl) statusEl.textContent = "Staat hersteld uit lokale opslag.";
    } catch (e) {
        console.error("Fout bij het laden van state uit localStorage", e);
    }
}

// --- 3. CSV-parsing (Google Analytics exports) ---

function parseGoogleAnalyticsCsv(text) {
    if (typeof Papa === 'undefined') {
        console.error("Papa Parse is niet geladen. Controleer de CDN in index.html.");
        return { header: [], data: [] };
    }

    const rows = text.split(/\r?\n/);
    let header = [];
    let headerFound = false;
    let headerRowIndex = -1;

    for (let i = 0; i < rows.length; i++) {
        const line = rows[i].trim();
        if (line === "" || line.startsWith("#")) continue;

        if (line.includes(",")) {
            headerRowIndex = i;
            const parseResult = Papa.parse(line, { header: false, skipEmptyLines: true });
            if (parseResult.data.length > 0 && parseResult.data[0].length > 0) {
                header = parseResult.data[0].map(h => h.trim().replace(/^"|"$/g, ''));
                headerFound = true;
                break;
            }
        }
    }

    if (!headerFound) {
        return { header: [], data: [] };
    }

    const dataText = rows.slice(headerRowIndex + 1).join('\n');
    const parseResult = Papa.parse(dataText, {
        header: false,
        skipEmptyLines: true,
        delimiter: ',',
    });

    const data = [];
    if (parseResult.data) {
        let uniqueIdCounter = Date.now();
        for (const rowValues of parseResult.data) {
            if (rowValues.length === header.length && rowValues.some(v => String(v).trim() !== "") && !String(rowValues[0]).trim().startsWith("#")) {
                const rowObj = { id: `row-${uniqueIdCounter++}-${Math.random().toString(36).substring(2, 4)}`, data: {}, selected: true };
                header.forEach((col, i) => {
                    rowObj.data[col] = rowValues[i] !== undefined ? String(rowValues[i]).trim() : "";
                });
                data.push(rowObj);
            }
        }
    }

    return { header, data };
}

function getNumericColumns(rows) {
    if (rows.length === 0) return [];
    
    const dataRows = rows.map(r => r.data || r); 
    const allColumns = Object.keys(dataRows[0] || {});
    const numericColumns = [];

    const testRows = dataRows.slice(0, 100);

    for (const col of allColumns) {
        let numericCount = 0;
        let nonNumericCount = 0;

        for (const row of testRows) {
            const value = String(row[col] || '').replace(/%/g, '').replace(/,/g, '.');
            if (value === "") continue;

            if (!isNaN(Number(value)) && isFinite(Number(value))) {
                numericCount++;
            } else {
                nonNumericCount++;
            }
        }

        if (numericCount > 0 && (numericCount / (numericCount + nonNumericCount)) > 0.7) {
            numericColumns.push(col);
        }
    }
    return numericColumns;
}

function computeTotals(rows, visibleColumns) {
    const totalRow = {};
    const numericColumns = getNumericColumns(rows);

    visibleColumns.forEach(col => {
        if (numericColumns.includes(col)) {
            totalRow[col] = 0;
        } else {
            totalRow[col] = visibleColumns.indexOf(col) === 0 ? "Totaal" : "";
        }
    });

    rows.forEach(row => {
        if (!row.selected) return; 

        visibleColumns.forEach(col => {
            if (numericColumns.includes(col)) {
                let value = String(row.data[col]).replace(/%/g, '').replace(/,/g, '.');
                totalRow[col] += isNaN(Number(value)) ? 0 : Number(value);
            }
        });
    });

    visibleColumns.forEach(col => {
        if (numericColumns.includes(col) && totalRow[col] !== "") {
            const value = totalRow[col];
            totalRow[col] = Number.isInteger(value) ? value.toLocaleString('nl-NL') : value.toFixed(2).toLocaleString('nl-NL');
        }
    });

    return totalRow;
}

async function handleCsvUpload(categoryKey, fileList, clearExisting) {
    const category = appState.categories[categoryKey];
    const newRows = [];
    let newHeader = [];
    let firstFileName = null;

    const statusEl = document.getElementById('load-status');
    if (statusEl) statusEl.textContent = "Bestand(en) inladen en parsen...";

    if (clearExisting) {
        category.rows = [];
    }

    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        if (file.type !== 'text/csv' && !file.name.toLowerCase().endsWith('.csv')) continue;

        if (firstFileName === null) {
            firstFileName = file.name;
        }

        const text = await file.text();
        const { header, data } = parseGoogleAnalyticsCsv(text);

        if (data.length > 0) {
            if (newHeader.length === 0) {
                newHeader = header;
            } else {
                if (JSON.stringify(newHeader) !== JSON.stringify(header)) {
                    console.warn(`Header van ${file.name} is anders dan de eerste CSV. Deze wordt overgeslagen.`);
                    continue;
                }
            }
            newRows.push(...data);
        }
    }

    if (newRows.length > 0) {
        const rowsWithState = newRows.map(dataObj => ({
            id: `row-${categoryKey}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            data: dataObj.data,
            selected: true
        }));
        
        category.rows.push(...rowsWithState); 

        if (category.columns.length === 0 || clearExisting) {
            category.columns = newHeader;
            category.columnVisibility = newHeader.reduce((acc, col) => {
                acc[col] = true;
                return acc;
            }, {});
            category.datasetTitle = firstFileName.replace(/\.csv$/i, '').trim() || category.datasetTitle;

            const numericCols = getNumericColumns(category.rows);
            category.metricColumn = numericCols.length > 0 ? numericCols[0] : null;
        }

        saveState();
        renderAll();
        if (statusEl) statusEl.textContent = `${newRows.length} rijen geladen in ${category.title}.`;

    } else {
        if (statusEl) statusEl.textContent = `Geen geldige data gevonden.`;
    }
}

// NIEUW: Dataset verwijderen
function clearDataset(categoryKey) {
    if (!confirm(`Weet je zeker dat je de dataset voor ${appState.categories[categoryKey].title} wilt verwijderen?`)) {
        return;
    }
    
    const category = appState.categories[categoryKey];
    
    // Vernietig de grafiek
    if (category.chartInstance) {
        category.chartInstance.destroy();
        category.chartInstance = null;
    }
    
    // Reset de category naar de initiële staat
    category.rows = [];
    category.columns = [];
    category.columnVisibility = {};
    category.datasetTitle = "Onbekende dataset";
    category.notes = "";
    category.metricColumn = null;
    category.sortColumn = null;
    category.sortDirection = 'asc';
    
    saveState();
    renderAll();
    
    const statusEl = document.getElementById('load-status');
    if (statusEl) statusEl.textContent = `Dataset voor ${category.title} verwijderd.`;
}

// --- 5. Rendering & interactie ---

function renderChartForCategory(categoryKey) {
    const category = appState.categories[categoryKey];
    const chartContainer = document.getElementById(`chart-canvas-${categoryKey}`);

    if (!chartContainer || !category.metricColumn || category.rows.length === 0) {
        if (category.chartInstance) {
            category.chartInstance.destroy();
            category.chartInstance = null;
        }
        return;
    }

    const selectedRows = category.rows.filter(r => r.selected);
    const metric = category.metricColumn;

    const numericColumns = getNumericColumns(category.rows);
    const dimensionColumns = category.columns.filter(col => !numericColumns.includes(col));
    const xColumn = dimensionColumns.length > 0 ? dimensionColumns[0] : null;

    let labels = [];
    let data = [];

    labels = selectedRows.map((r, i) => {
        if (xColumn) return r.data[xColumn];
        return `Record ${i + 1}`;
    });

    data = selectedRows.map(r => {
        let val = String(r.data[metric]).replace(/%/g, '').replace(/,/g, '.');
        return isNaN(Number(val)) ? 0 : Number(val);
    });

    if (category.chartInstance) {
        category.chartInstance.destroy();
    }
    
    const ctx = chartContainer.getContext('2d');
    const newChart = new Chart(ctx, {
        type: category.chartType, // Dynamisch grafiektype
        data: {
            labels: labels,
            datasets: [{
                label: metric,
                data: data,
                backgroundColor: category.chartType === 'bar' ? 'rgba(75, 192, 192, 0.6)' : undefined,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1,
                pointRadius: category.chartType === 'line' ? 3 : 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: xColumn || 'Record Index'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        autoSkip: true,
                        maxTicksLimit: 10
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: metric
                    }
                }
            },
            plugins: {
                legend: { display: false },
                title: {
                    display: true,
                    text: category.datasetTitle || 'Grafiek'
                }
            }
        }
    });
    category.chartInstance = newChart;
}

function sortData(categoryKey, column) {
    const category = appState.categories[categoryKey];
    const numericColumns = getNumericColumns(category.rows);

    let direction = 'asc';
    if (category.sortColumn === column) {
        direction = category.sortDirection === 'asc' ? 'desc' : 'asc';
    }

    category.sortColumn = column;
    category.sortDirection = direction;

    category.rows.sort((a, b) => {
        const aVal = a.data[column];
        const bVal = b.data[column];

        let comparison = 0;

        if (numericColumns.includes(column)) {
            const numA = Number(String(aVal).replace(/%/g, '').replace(/,/g, '.'));
            const numB = Number(String(bVal).replace(/%/g, '').replace(/,/g, '.'));
            
            if (!isNaN(numA) && !isNaN(numB)) {
                comparison = numA - numB;
            } else if (isNaN(numA) && !isNaN(numB)) {
                comparison = 1;
            } else if (!isNaN(numA) && isNaN(numB)) {
                comparison = -1;
            } else {
                comparison = String(aVal).localeCompare(String(bVal));
            }
        } else {
            comparison = String(aVal).localeCompare(String(bVal));
        }

        return direction === 'asc' ? comparison : -comparison;
    });

    saveState();
    renderCategory(categoryKey);
}

function renderCategory(categoryKey) {
    const category = appState.categories[categoryKey];
    const container = document.getElementById(`panel-${categoryKey}`);

    if (!container) return;
    
    container.className = 'category-panel';

    const visibleColumns = category.columns.filter(col => category.columnVisibility[col]);
    const totalRow = category.rows.length > 0 ? computeTotals(category.rows, visibleColumns) : {};
    const numericColumns = getNumericColumns(category.rows);

    let html = `
        <div class="panel-header">
            <h2>${category.title}</h2>
            <label>
                <input type="checkbox" data-category="${categoryKey}" id="pdf-include-${categoryKey}" class="pdf-include-toggle" ${category.includeInPdf ? 'checked' : ''}>
                Opnemen in PDF
            </label>
        </div>
    `;

    html += `
        <div class="file-input-wrapper">
            <label for="csv-upload-${categoryKey}" class="button">
                CSV inladen (nieuw)
                <input type="file" id="csv-upload-${categoryKey}" data-category="${categoryKey}" accept=".csv" multiple style="display: none;">
            </label>
            ${category.rows.length > 0 ? `
                <label for="csv-add-${categoryKey}" class="button">
                    Week toevoegen (CSV)
                    <input type="file" id="csv-add-${categoryKey}" data-category="${categoryKey}" data-mode="add" accept=".csv" multiple style="display: none;">
                </label>
                <button class="button-danger" data-category="${categoryKey}" id="clear-dataset-${categoryKey}">
                    Dataset verwijderen
                </button>
            ` : ''}
        </div>
    `;

    if (category.rows.length > 0) {
        html += `
            <div class="settings-section">
                <h3>Dataset Instellingen</h3>
                <p>
                    <label>Dataset-titel:
                        <input type="text" data-category="${categoryKey}" id="dataset-title-${categoryKey}" value="${category.datasetTitle}" style="width: 300px;">
                    </label>
                </p>
                <p>
                    <label>Opmerkingen:
                        <textarea data-category="${categoryKey}" id="dataset-notes-${categoryKey}" rows="3" style="width: 100%; max-width: 500px;">${category.notes}</textarea>
                    </label>
                </p>

                <h4>Kolom-instellingen (Zichtbaarheid)</h4>
                <div class="column-visibility-list">
                    ${category.columns.map(col => `
                        <label>
                            <input type="checkbox" data-column="${col}" data-category="${categoryKey}" class="col-visibility-toggle" ${category.columnVisibility[col] ? 'checked' : ''}>
                            ${col}
                        </label>
                    `).join('')}
                </div>
            </div>
        `;

        html += `
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th style="width: 50px;">Selectie</th>
                            ${visibleColumns.map(col => {
                                const isSorting = category.sortColumn === col;
                                const indicator = isSorting ? (category.sortDirection === 'asc' ? '▲' : '▼') : '';
                                return `<th data-column="${col}" data-category="${categoryKey}" class="sortable-header">
                                    ${col} <span class="sort-indicator">${indicator}</span>
                                </th>`;
                            }).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="total-row">
                            <td></td>
                            ${visibleColumns.map(col => `<td>${totalRow[col] || ''}</td>`).join('')}
                        </tr>
                        ${category.rows.map(row => `
                            <tr>
                                <td>
                                    <input type="checkbox" data-row-id="${row.id}" data-category="${categoryKey}" class="row-select-checkbox" ${row.selected ? 'checked' : ''}>
                                </td>
                                ${visibleColumns.map(col => `<td>${row.data[col]}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;

        const availableMetrics = numericColumns;

        html += `
            <div class="chart-container">
                <h3>Grafiek Preview</h3>
                <div class="chart-controls">
                    <label>Y-as Metriek:
                        <select id="chart-metric-select-${categoryKey}" data-category="${categoryKey}">
                            ${availableMetrics.map(col => `
                                <option value="${col}" ${category.metricColumn === col ? 'selected' : ''}>${col}</option>
                            `).join('')}
                            ${availableMetrics.length === 0 ? '<option value="" disabled selected>Geen numerieke kolommen</option>' : ''}
                        </select>
                    </label>
                    <label>Grafiektype:
                        <select id="chart-type-select-${categoryKey}" data-category="${categoryKey}">
                            <option value="bar" ${category.chartType === 'bar' ? 'selected' : ''}>Staafdiagram</option>
                            <option value="line" ${category.chartType === 'line' ? 'selected' : ''}>Lijndiagram</option>
                        </select>
                    </label>
                </div>
                <div class="chart-canvas">
                    <canvas id="chart-canvas-${categoryKey}"></canvas>
                </div>
            </div>
        `;
    } else {
        html += '<p>Upload een Google Analytics CSV om te beginnen.</p>';
    }

    container.innerHTML = html;

    if (category.rows.length > 0) {
        renderChartForCategory(categoryKey);
    }
}

function renderAll() {
    categoryKeys.forEach(key => {
        renderCategory(key);
        attachCategoryEventHandlers(key);
    });
}

function attachCategoryEventHandlers(categoryKey) {
    const container = document.getElementById(`panel-${categoryKey}`);
    if (!container) return;

    container.querySelector(`#pdf-include-${categoryKey}`)?.addEventListener('change', (e) => {
        appState.categories[categoryKey].includeInPdf = e.target.checked;
        saveState();
    });

    container.querySelector(`#csv-upload-${categoryKey}`)?.addEventListener('change', (e) => {
        handleCsvUpload(categoryKey, e.target.files, true);
        e.target.value = ''; // Reset file input
    });

    container.querySelector(`#csv-add-${categoryKey}`)?.addEventListener('change', (e) => {
        handleCsvUpload(categoryKey, e.target.files, false);
        e.target.value = ''; // Reset file input
    });

    container.querySelector(`#clear-dataset-${categoryKey}`)?.addEventListener('click', () => {
        clearDataset(categoryKey);
    });

    container.querySelector(`#dataset-title-${categoryKey}`)?.addEventListener('input', (e) => {
        appState.categories[categoryKey].datasetTitle = e.target.value;
        saveState();
        // Update grafiek titel
        if (appState.categories[categoryKey].chartInstance) {
            renderChartForCategory(categoryKey);
        }
    });

    container.querySelector(`#dataset-notes-${categoryKey}`)?.addEventListener('input', (e) => {
        appState.categories[categoryKey].notes = e.target.value;
        saveState();
    });

    container.querySelectorAll('.col-visibility-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const col = e.target.dataset.column;
            appState.categories[categoryKey].columnVisibility[col] = e.target.checked;
            saveState();
            renderCategory(categoryKey);
        });
    });

    container.querySelectorAll('.row-select-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const rowId = e.target.dataset.rowId;
            const row = appState.categories[categoryKey].rows.find(r => r.id === rowId);
            if (row) {
                row.selected = e.target.checked;
                saveState();
                renderCategory(categoryKey);
            }
        });
    });

    container.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const column = e.currentTarget.dataset.column;
            const catKey = e.currentTarget.dataset.category;
            sortData(catKey, column);
        });
    });

    container.querySelector(`#chart-metric-select-${categoryKey}`)?.addEventListener('change', (e) => {
        appState.categories[categoryKey].metricColumn = e.target.value;
        saveState();
        renderChartForCategory(categoryKey);
    });

    container.querySelector(`#chart-type-select-${categoryKey}`)?.addEventListener('change', (e) => {
        appState.categories[categoryKey].chartType = e.target.value;
        saveState();
        renderChartForCategory(categoryKey);
    });
}

// --- 6. PDF-export ---

async function generatePdf() {
    const statusEl = document.getElementById('load-status');
    statusEl.textContent = "PDF generatie gestart...";
    
    const doc = new jsPDF({ orientation: "p", unit: "pt", format: "a4" });

    const categoryOrder = ["acquisition", "behaviour", "conversion", "loyalty"];

    let firstPage = true;
    for (const key of categoryOrder) {
        const cat = appState.categories[key];
        if (!cat.includeInPdf || cat.rows.length === 0) continue;

        if (!firstPage) {
            doc.addPage();
        }
        firstPage = false;

        statusEl.textContent = `Bezig met ${cat.title} ...`;

        const panelElement = document.getElementById(`panel-${key}`);

        const canvas = await html2canvas(panelElement, {
            scale: 2,
            allowTaint: true,
            useCORS: true,
            onclone: (doc) => {
                const tableContainer = doc.getElementById(`panel-${key}`).querySelector('.data-table-container');
                if (tableContainer) {
                    tableContainer.scrollTop = 0;
                }
            }
        });

        const imgData = canvas.toDataURL("image/png");

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        const padding = 40; 
        const maxImageWidth = pageWidth - padding;
        const maxImageHeight = pageHeight - padding;

        const ratioX = maxImageWidth / canvas.width;
        const ratioY = maxImageHeight / canvas.height;
        const ratio = Math.min(ratioX, ratioY); 

        const imgWidth = canvas.width * ratio;
        const imgHeight = canvas.height * ratio;

        doc.addImage(imgData, "PNG",
            (pageWidth - imgWidth) / 2,
            padding / 2,
            imgWidth,
            imgHeight
        );
    }

    if (!firstPage) {
        doc.save("ga-dashboard-rapport.pdf");
        statusEl.textContent = "PDF succesvol gegenereerd.";
    } else {
        alert("Geen categorieën geselecteerd voor de PDF of geen data geladen.");
        statusEl.textContent = "PDF generatie geannuleerd.";
    }
}

// --- 5. Initialisatie ---

function init() {
    loadState();
    renderAll();
    document.getElementById('export-pdf-btn').addEventListener('click', generatePdf);
}

document.addEventListener('DOMContentLoaded', init);
