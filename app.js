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
            columns: [],
            columnVisibility: {},
            rows: [], // { id: string, data: { [col]: value }, selected: boolean }
            metricColumn: null,
            sortColumn: null,
            sortDirection: 'asc', // 'asc' of 'desc'
            chartInstance: null // Chart.js instantie
        },
        behaviour: { ... },
        conversion: { ... },
        loyalty: { ... }
    }
};

// Initialiseer de andere categorieën met de basisstructuur
categoryKeys.forEach(key => {
    if (key !== 'acquisition') {
        appState.categories[key] = {
            ...appState.categories.acquisition,
            title: key.charAt(0).toUpperCase() + key.slice(1),
            datasetTitle: "Onbekende dataset",
            includeInPdf: true
        };
    }
});

function saveState() {
    // Sla de chartInstance niet op in localStorage
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
        // Merge parsed in appState, behoud chartInstance
        categoryKeys.forEach(key => {
            if (parsed.categories[key]) {
                const currentChartInstance = appState.categories[key].chartInstance;
                appState.categories[key] = { ...appState.categories[key], ...parsed.categories[key] };
                appState.categories[key].chartInstance = currentChartInstance;
            }
        });
        console.log("State geladen uit localStorage");
    } catch (e) {
        console.error("Fout bij het laden van state uit localStorage", e);
    }
}

// --- 3. CSV-parsing (Google Analytics exports) ---

/**
 * Parsed een ruwe Google Analytics CSV tekst.
 * @param {string} text - De ruwe CSV tekst.
 * @returns {{header: string[], data: object[]}} De geparste header en data.
 */
function parseGoogleAnalyticsCsv(text) {
    // Gebruik Papa Parse voor robuustere en correctere parsing van komma's in waarden,
    // maar volg de GA-specifieke logica voor het vinden van de header.

    const rows = text.split(/\r?\n/);
    let header = [];
    let headerFound = false;
    let headerRowIndex = -1;

    // 1. Zoek de header: de eerste niet-lege, niet-commentaar (#) regel met komma's
    for (let i = 0; i < rows.length; i++) {
        const line = rows[i].trim();
        if (line === "" || line.startsWith("#")) continue;

        if (line.includes(",")) {
            headerRowIndex = i;
            // Gebruik Papa Parse om de headerrij te parsen
            const parseResult = Papa.parse(line, { header: false });
            if (parseResult.data.length > 0 && parseResult.data[0].length > 0) {
                 // Soms geeft Papa Parse een array van arrays terug, pak de eerste rij
                header = parseResult.data[0].map(h => h.trim());
                headerFound = true;
                break;
            }
        }
    }

    if (!headerFound) {
        return { header: [], data: [] };
    }

    // 2. Parse de data (alle rijen ná de header)
    const dataText = rows.slice(headerRowIndex + 1).join('\n');
    const parseResult = Papa.parse(dataText, {
        header: false,
        skipEmptyLines: true,
        // Alleen rijen parsen die niet met # beginnen
        // Papa Parse heeft geen ingebouwde #-commentaar support, dus we filteren later
    });

    const data = [];
    if (parseResult.data) {
        let uniqueIdCounter = Date.now(); // Gebruik timestamp als basis voor unieke ID's
        for (const rowValues of parseResult.data) {
             // Controleer of de rij een valide datarij is (niet leeg en niet een commentaarrij)
             // Omdat we Papa Parse over een deel van het bestand laten lopen,
             // moeten we alleen nog controleren op GA-specifieke metadata/commentaar die de Papa Parse opties niet vangen.
            if (rowValues.length === header.length && !String(rowValues[0]).trim().startsWith("#")) {
                const rowObj = { id: `row-${uniqueIdCounter++}`, data: {}, selected: true };
                header.forEach((col, i) => {
                    rowObj.data[col] = rowValues[i] !== undefined ? String(rowValues[i]).trim() : "";
                });
                data.push(rowObj);
            }
        }
    }

    return { header, data };
}


/**
 * Kijkt welke kolommen numerieke data bevatten.
 * @param {object[]} rows - De datasetrijen.
 * @returns {string[]} Lijst van kolomnamen die numeriek zijn.
 */
function getNumericColumns(rows) {
    if (rows.length === 0) return [];
    const allColumns = Object.keys(rows[0].data);
    const numericColumns = [];

    // Test de eerste 100 rijen om te bepalen of een kolom numeriek is
    const testRows = rows.slice(0, 100);

    for (const col of allColumns) {
        // Een kolom is numeriek als minstens één waarde een getal is en
        // de meerderheid van de waarden (die niet leeg zijn) getallen zijn.
        // Dit is een heuristiek om dimensies (zoals "Pagina") uit te sluiten.
        let numericCount = 0;
        let nonNumericCount = 0;

        for (const row of testRows) {
            const value = String(row.data[col]).replace(/%/g, '').replace(/,/g, '.'); // % en komma's verwerken
            if (value === "") continue;

            if (!isNaN(Number(value))) {
                numericCount++;
            } else {
                nonNumericCount++;
            }
        }

        // Als er (substantieel) meer numerieke waarden dan niet-numerieke zijn, beschouw het als numeriek.
        // We stellen een drempel in (bv. 70% van de niet-lege waarden).
        if (numericCount > 0 && (numericCount / (numericCount + nonNumericCount)) > 0.7) {
            numericColumns.push(col);
        }
    }
    return numericColumns;
}

/**
 * Berekent de totaalrij (som voor numerieke kolommen, 'Totaal' of leeg voor andere).
 * @param {object[]} rows - De datasetrijen.
 * @param {string[]} visibleColumns - De kolommen die zichtbaar zijn.
 * @returns {object} De totaalrij.
 */
function computeTotals(rows, visibleColumns) {
    const totalRow = {};
    const numericColumns = getNumericColumns(rows);

    // Initialiseer totalen
    visibleColumns.forEach(col => {
        if (numericColumns.includes(col)) {
            totalRow[col] = 0;
        } else {
            // Eerste kolom krijgt het label 'Totaal'
            totalRow[col] = visibleColumns.indexOf(col) === 0 ? "Totaal" : "";
        }
    });

    // Bereken de som
    rows.forEach(row => {
        visibleColumns.forEach(col => {
            if (numericColumns.includes(col)) {
                let value = String(row.data[col]).replace(/%/g, '').replace(/,/g, '.');
                totalRow[col] += isNaN(Number(value)) ? 0 : Number(value);
            }
        });
    });

    // Formatteer de numerieke totalen
    visibleColumns.forEach(col => {
        if (numericColumns.includes(col) && totalRow[col] !== "") {
            // Rond af op 2 decimalen, of integer als het een geheel getal is
            const value = totalRow[col];
            totalRow[col] = Number.isInteger(value) ? value.toLocaleString('nl-NL') : value.toFixed(2).toLocaleString('nl-NL');
        }
    });

    return totalRow;
}

/**
 * Handle de upload van één of meerdere CSV-bestanden.
 * @param {string} categoryKey - De categorie waar de CSV's bij horen.
 * @param {FileList} fileList - De FileList van de input.
 * @param {boolean} clearExisting - Moeten bestaande rijen gewist worden?
 */
async function handleCsvUpload(categoryKey, fileList, clearExisting) {
    const category = appState.categories[categoryKey];
    const newRows = [];
    let newHeader = [];
    let firstFileName = null;

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
                // Controleer of de headers consistent zijn (simpele check)
                if (JSON.stringify(newHeader) !== JSON.stringify(header)) {
                    console.warn(`Header van ${file.name} is anders dan de eerste CSV. Deze wordt overgeslagen.`);
                    continue;
                }
            }
            newRows.push(...data);
        }
    }

    if (newRows.length > 0) {
        // Voeg unieke ID's toe en zet de geselecteerd-status
        const rowsWithState = newRows.map(dataObj => ({
            id: `row-${categoryKey}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            data: dataObj,
            selected: true // Standaard zijn alle nieuwe rijen geselecteerd
        }));

        category.rows.push(...rowsWithState);

        // Update kolommen en zichtbaarheid (alleen als dit de eerste upload is)
        if (category.columns.length === 0 || clearExisting) {
            category.columns = newHeader;
            category.columnVisibility = newHeader.reduce((acc, col) => {
                acc[col] = true; // Standaard alles zichtbaar
                return acc;
            }, {});
            category.datasetTitle = firstFileName || category.datasetTitle;

            // Bepaal de eerste numerieke kolom als standaard metriek
            const numericCols = getNumericColumns(category.rows);
            category.metricColumn = numericCols.length > 0 ? numericCols[0] : null;
        }

        saveState();
        renderAll();
    }
}

// --- 5. Rendering & interactie ---

let chartInstances = {}; // Houdt alle Chart.js instanties bij

/**
 * Render de Chart.js grafiek voor een categorie.
 * @param {string} categoryKey - De categorie sleutel.
 */
function renderChartForCategory(categoryKey) {
    const category = appState.categories[categoryKey];
    const chartContainer = document.getElementById(`chart-canvas-${categoryKey}`);

    if (!chartContainer || !category.metricColumn) {
        if (category.chartInstance) {
             // Als er geen metriek meer is, maar wel een grafiek, vernietig deze
            category.chartInstance.destroy();
            category.chartInstance = null;
        }
        return;
    }

    const selectedRows = category.rows.filter(r => r.selected);
    const metric = category.metricColumn;

    // Bepaal de X-as: gebruik de eerste dimensiekolom, of anders een index.
    const dimensionColumns = category.columns.filter(col => !getNumericColumns(category.rows).includes(col));
    const xColumn = dimensionColumns.length > 0 ? dimensionColumns[0] : null;

    let labels = [];
    let data = [];

    if (xColumn) {
        // Gebruik de dimensiekolom als label
        labels = selectedRows.map(r => r.data[xColumn]);
        data = selectedRows.map(r => {
            let val = String(r.data[metric]).replace(/%/g, '').replace(/,/g, '.');
            return isNaN(Number(val)) ? 0 : Number(val);
        });
    } else {
        // Gebruik een simpele index als label
        labels = selectedRows.map((_, i) => i + 1);
        data = selectedRows.map(r => {
            let val = String(r.data[metric]).replace(/%/g, '').replace(/,/g, '.');
            return isNaN(Number(val)) ? 0 : Number(val);
        });
    }

    if (category.chartInstance) {
        // Update bestaande grafiek
        category.chartInstance.data.labels = labels;
        category.chartInstance.data.datasets[0].data = data;
        category.chartInstance.data.datasets[0].label = metric;
        category.chartInstance.options.scales.y.title.text = metric;
        category.chartInstance.update();
    } else {
        // Nieuwe grafiek maken
        const ctx = chartContainer.getContext('2d');
        const newChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: metric,
                    data: data,
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1,
                    pointRadius: 3
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
                            minRotation: 45
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
                    legend: {
                        display: false
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
        category.chartInstance = newChart;
    }
}

/**
 * Sorteer de rijen in de state.
 * @param {string} categoryKey - De categorie sleutel.
 * @param {string} column - De kolom om op te sorteren.
 */
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
             // Numerieke sortering
            const numA = Number(String(aVal).replace(/%/g, '').replace(/,/g, '.'));
            const numB = Number(String(bVal).replace(/%/g, '').replace(/,/g, '.'));
            if (!isNaN(numA) && !isNaN(numB)) {
                comparison = numA - numB;
            } else if (!isNaN(numA)) {
                 comparison = -1; // Lege/ongeldige numerieke waarden komen achteraan
            } else if (!isNaN(numB)) {
                 comparison = 1;
            } else {
                 comparison = String(aVal).localeCompare(String(bVal)); // Fallback op string
            }
        } else {
             // Alfabetische sortering
            comparison = String(aVal).localeCompare(String(bVal));
        }

        return direction === 'asc' ? comparison : -comparison;
    });

    saveState();
    renderCategory(categoryKey);
}


/**
 * Render de HTML voor één categoriepaneel op basis van de state.
 * @param {string} categoryKey - De categorie sleutel.
 */
function renderCategory(categoryKey) {
    const category = appState.categories[categoryKey];
    const container = document.getElementById(`panel-${categoryKey}`);

    if (!container) return;

    const visibleColumns = category.columns.filter(col => category.columnVisibility[col]);
    const totalRow = category.rows.length > 0 ? computeTotals(category.rows, visibleColumns) : {};
    const numericColumns = getNumericColumns(category.rows);

    // Bovenste gedeelte van het paneel: Titel, PDF-checkbox
    let html = `
        <div class="panel-header">
            <h2>${category.title}</h2>
            <label>
                <input type="checkbox" data-category="${categoryKey}" id="pdf-include-${categoryKey}" ${category.includeInPdf ? 'checked' : ''}>
                Opnemen in PDF
            </label>
        </div>
    `;

    // CSV upload
    html += `
        <div class="file-input-wrapper">
            <label for="csv-upload-${categoryKey}" class="button">
                CSV inladen (file)
                <input type="file" id="csv-upload-${categoryKey}" data-category="${categoryKey}" accept=".csv" multiple style="display: none;">
            </label>
            ${category.rows.length > 0 ? `
                <label for="csv-add-${categoryKey}" class="button">
                    Week toevoegen (CSV)
                    <input type="file" id="csv-add-${categoryKey}" data-category="${categoryKey}" data-mode="add" accept=".csv" multiple style="display: none;">
                </label>
            ` : ''}
        </div>
    `;

    if (category.rows.length > 0) {
        // Instellingen: Titel, Kolom-instellingen
        html += `
            <div class="settings-section">
                <h3>Dataset Instellingen</h3>
                <p>
                    <label>Dataset-titel:
                        <input type="text" data-category="${categoryKey}" id="dataset-title-${categoryKey}" value="${category.datasetTitle}" style="width: 300px;">
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

        // Tabel
        html += `
            <div class="data-table-container">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>PDF/Grafiek</th>
                            ${visibleColumns.map(col => {
                                const isSorting = category.sortColumn === col;
                                const indicator = isSorting ? (category.sortDirection === 'asc' ? '▲' : '▼') : '';
                                return `<th data-column="${col}" class="sortable-header">
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

        // Grafiek
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

    // Herteken de grafiek na het inbrengen van de HTML
    if (category.rows.length > 0) {
        renderChartForCategory(categoryKey);
    }
}

/**
 * Render alle categorieën en hecht event handlers.
 */
function renderAll() {
    categoryKeys.forEach(key => {
        renderCategory(key);
        attachCategoryEventHandlers(key);
    });
}

/**
 * Hecht event handlers aan een categoriepaneel.
 * @param {string} categoryKey - De categorie sleutel.
 */
function attachCategoryEventHandlers(categoryKey) {
    const container = document.getElementById(`panel-${categoryKey}`);
    if (!container) return;

    // PDF Include checkbox
    container.querySelector(`#pdf-include-${categoryKey}`)?.addEventListener('change', (e) => {
        appState.categories[categoryKey].includeInPdf = e.target.checked;
        saveState();
    });

    // CSV Upload (Nieuwe dataset)
    container.querySelector(`#csv-upload-${categoryKey}`)?.addEventListener('change', (e) => {
        handleCsvUpload(categoryKey, e.target.files, true);
    });

    // CSV Toevoegen (Week toevoegen)
    container.querySelector(`#csv-add-${categoryKey}`)?.addEventListener('change', (e) => {
        handleCsvUpload(categoryKey, e.target.files, false);
    });

    // Dataset Titel
    container.querySelector(`#dataset-title-${categoryKey}`)?.addEventListener('input', (e) => {
        appState.categories[categoryKey].datasetTitle = e.target.value;
        saveState();
    });

    // Kolom Zichtbaarheid
    container.querySelectorAll('.col-visibility-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const col = e.target.dataset.column;
            appState.categories[categoryKey].columnVisibility[col] = e.target.checked;
            saveState();
            renderCategory(categoryKey); // Rerender om de tabel en grafiek aan te passen
        });
    });

    // Rij Selectie (PDF/Grafiek)
    container.querySelectorAll('.row-select-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const rowId = e.target.dataset.rowId;
            const row = appState.categories[categoryKey].rows.find(r => r.id === rowId);
            if (row) {
                row.selected = e.target.checked;
                saveState();
                renderChartForCategory(categoryKey); // Alleen grafiek updaten
            }
        });
    });

    // Sortering
    container.querySelectorAll('.sortable-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const column = e.currentTarget.dataset.column;
            sortData(categoryKey, column);
        });
    });

    // Grafiek Metriek Selectie
    container.querySelector(`#chart-metric-select-${categoryKey}`)?.addEventListener('change', (e) => {
        appState.categories[categoryKey].metricColumn = e.target.value;
        saveState();
        renderChartForCategory(categoryKey);
    });
}

// --- 6. PDF-export ---

async function generatePdf() {
    // Gebruik de ES module van jsPDF, die is ge-exposed als window.jspdf
    const { jsPDF } = window.jspdf;
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

        // Zoek het DOM-element van dit categorie-paneel
        const panelElement = document.getElementById(`panel-${key}`);

        // html2canvas rendert de huidige DOM-staat naar een canvas
        const canvas = await html2canvas(panelElement, {
             // Zorg dat de tabel-scrollbare inhoud volledig wordt meegenomen
            allowTaint: true,
            useCORS: true,
            // Scroll de container naar boven voor de screenshot
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
        
        // Bereken de ratio om het canvas op de pagina te passen
        const padding = 40; // 20pt aan elke kant
        const maxImageWidth = pageWidth - padding;
        const maxImageHeight = pageHeight - padding;

        const ratioX = maxImageWidth / canvas.width;
        const ratioY = maxImageHeight / canvas.height;
        const ratio = Math.min(ratioX, ratioY); // Behoud aspect ratio en zorg dat het past

        const imgWidth = canvas.width * ratio;
        const imgHeight = canvas.height * ratio;

        doc.addImage(imgData, "PNG",
            (pageWidth - imgWidth) / 2, // X-positie (gecentreerd)
            padding / 2, // Y-positie (kleine marge bovenaan)
            imgWidth,
            imgHeight
        );
    }

    if (!firstPage) {
         // Alleen opslaan als er daadwerkelijk content is toegevoegd
        doc.save("ga-dashboard-rapport.pdf");
    } else {
        alert("Geen categorieën geselecteerd voor de PDF of geen data geladen.");
    }
}


// --- 5. Initialisatie ---

function init() {
    loadState();
    renderAll();
    document.getElementById('generate-pdf-btn').addEventListener('click', generatePdf);
}

// Start de app
init();
