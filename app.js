// ===== ANALYTICS DASHBOARD APP =====
// Pure JavaScript applicatie voor het beheren van CSV datasets en marketing data

// ===== APP STATE =====
const appState = {
    csvDatasets: [],
    categories: {
        ACQUISITION: { variables: [] },
        BEHAVIOR: { variables: [] },
        CONVERSION: { variables: [] },
        LOYALTY: { variables: [] }
    },
    ui: {
        activeTab: 'csv',
        activeCategory: 'ACQUISITION'
    }
};

// Chart instances opslaan voor cleanup
const chartInstances = {};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    renderActiveSection();
});

// ===== EVENT LISTENERS SETUP =====
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // CSV upload
    document.getElementById('uploadBtn').addEventListener('click', () => {
        document.getElementById('csvUpload').click();
    });

    document.getElementById('csvUpload').addEventListener('change', handleCsvUpload);

    // Category tabs
    document.querySelectorAll('.category-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchCategory(e.target.dataset.category);
        });
    });

    // JSON Import/Export
    document.getElementById('importJsonBtn').addEventListener('click', openJsonImportModal);
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('jsonImportConfirm').addEventListener('click', importJson);
    document.getElementById('jsonImportCancel').addEventListener('click', closeJsonImportModal);

    // PDF Export
    document.getElementById('exportPdfBtn').addEventListener('click', generatePdf);
}

// ===== TAB SWITCHING =====
function switchTab(tabName) {
    appState.ui.activeTab = tabName;
    
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    if (tabName === 'csv') {
        document.getElementById('csvSection').classList.add('active');
    } else {
        document.getElementById('marketingSection').classList.add('active');
    }

    saveState();
}

// ===== CATEGORY SWITCHING =====
function switchCategory(categoryName) {
    appState.ui.activeCategory = categoryName;
    
    // Update category tabs
    document.querySelectorAll('.category-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === categoryName);
    });

    renderCategoryContent();
    saveState();
}

// ===== CSV UPLOAD & PARSING =====
function handleCsvUpload(event) {
    const files = event.target.files;
    
    Array.from(files).forEach(file => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                addCsvDataset(file.name, results.data, results.meta.fields);
            },
            error: (error) => {
                console.error('CSV parse error:', error);
                alert('Fout bij het inlezen van CSV: ' + error.message);
            }
        });
    });

    // Reset file input
    event.target.value = '';
}

function addCsvDataset(filename, data, columns) {
    const dataset = {
        id: Date.now() + Math.random(), // Unieke ID
        name: filename.replace('.csv', ''),
        data: data,
        columns: columns,
        visibleColumns: [...columns], // Alle kolommen standaard zichtbaar
        selectedMetrics: columns.filter(col => isNumericColumn(col, data)), // Numerieke kolommen voor grafiek
        includePdf: true,
        visible: true,
        comments: '',
        sortColumn: null,
        sortDirection: 'asc'
    };

    appState.csvDatasets.push(dataset);
    saveState();
    renderCsvDatasets();
}

// ===== CHECK OF KOLOM NUMERIEK IS =====
function isNumericColumn(columnName, data) {
    // Check eerste 5 niet-null waarden
    const samples = data.slice(0, 5).map(row => row[columnName]).filter(v => v != null);
    return samples.some(value => typeof value === 'number' || !isNaN(parseFloat(value)));
}

// ===== RENDER CSV DATASETS =====
function renderCsvDatasets() {
    const container = document.getElementById('csvDatasetsContainer');
    container.innerHTML = '';

    if (appState.csvDatasets.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #95a5a6; padding: 3rem;">Geen datasets geladen. Upload een CSV bestand om te beginnen.</p>';
        return;
    }

    appState.csvDatasets.forEach((dataset, index) => {
        if (!dataset.visible) return;

        const card = document.createElement('div');
        card.className = 'dataset-card';
        card.innerHTML = `
            <div class="dataset-header">
                <div class="dataset-title">
                    <input 
                        type="text" 
                        class="dataset-name-input" 
                        value="${dataset.name}"
                        data-index="${index}"
                    >
                </div>
                <div class="dataset-controls">
                    <label class="checkbox-label">
                        <input 
                            type="checkbox" 
                            ${dataset.includePdf ? 'checked' : ''}
                            data-index="${index}"
                            class="include-pdf-check"
                        >
                        Opnemen in PDF
                    </label>
                    <button class="btn btn-danger btn-small delete-dataset" data-index="${index}">🗑️ Verwijder</button>
                </div>
            </div>

            <div class="column-visibility">
                <h4>Kolom zichtbaarheid:</h4>
                <div class="column-checkboxes" data-index="${index}">
                    ${dataset.columns.map(col => `
                        <label class="checkbox-label">
                            <input 
                                type="checkbox" 
                                ${dataset.visibleColumns.includes(col) ? 'checked' : ''}
                                data-column="${col}"
                            >
                            ${col}
                        </label>
                    `).join('')}
                </div>
            </div>

            <div class="data-table-container">
                <table class="data-table" id="table-${dataset.id}"></table>
            </div>

            <div class="chart-section">
                <div class="chart-controls">
                    <h4>Metrics voor grafiek:</h4>
                    <div class="metric-checkboxes" data-index="${index}">
                        ${dataset.columns.filter(col => isNumericColumn(col, dataset.data)).map(col => `
                            <label class="checkbox-label">
                                <input 
                                    type="checkbox" 
                                    ${dataset.selectedMetrics.includes(col) ? 'checked' : ''}
                                    data-metric="${col}"
                                >
                                ${col}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="chart-canvas">
                    <canvas id="chart-${dataset.id}"></canvas>
                </div>
            </div>

            <div class="comments-section">
                <label>Opmerkingen:</label>
                <textarea 
                    class="comments-textarea" 
                    data-index="${index}"
                    placeholder="Voeg hier opmerkingen toe over deze dataset..."
                >${dataset.comments || ''}</textarea>
            </div>
        `;

        container.appendChild(card);

        // Event listeners voor deze card
        setupDatasetCardListeners(card, dataset, index);

        // Render tabel en grafiek
        renderDataTable(dataset);
        renderChart(dataset);
    });
}

// ===== SETUP LISTENERS VOOR DATASET CARD =====
function setupDatasetCardListeners(card, dataset, index) {
    // Dataset naam wijzigen
    card.querySelector('.dataset-name-input').addEventListener('change', (e) => {
        appState.csvDatasets[index].name = e.target.value;
        saveState();
    });

    // Include PDF toggle
    card.querySelector('.include-pdf-check').addEventListener('change', (e) => {
        appState.csvDatasets[index].includePdf = e.target.checked;
        saveState();
    });

    // Delete dataset
    card.querySelector('.delete-dataset').addEventListener('click', () => {
        if (confirm('Weet je zeker dat je deze dataset wilt verwijderen?')) {
            // Destroy chart instance
            if (chartInstances[dataset.id]) {
                chartInstances[dataset.id].destroy();
                delete chartInstances[dataset.id];
            }
            appState.csvDatasets.splice(index, 1);
            saveState();
            renderCsvDatasets();
        }
    });

    // Kolom visibility checkboxes
    card.querySelectorAll('.column-checkboxes input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const column = e.target.dataset.column;
            if (e.target.checked) {
                if (!dataset.visibleColumns.includes(column)) {
                    dataset.visibleColumns.push(column);
                }
            } else {
                dataset.visibleColumns = dataset.visibleColumns.filter(c => c !== column);
            }
            saveState();
            renderDataTable(dataset);
        });
    });

    // Metric checkboxes voor grafiek
    card.querySelectorAll('.metric-checkboxes input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const metric = e.target.dataset.metric;
            if (e.target.checked) {
                if (!dataset.selectedMetrics.includes(metric)) {
                    dataset.selectedMetrics.push(metric);
                }
            } else {
                dataset.selectedMetrics = dataset.selectedMetrics.filter(m => m !== metric);
            }
            saveState();
            renderChart(dataset);
        });
    });

    // Comments textarea
    card.querySelector('.comments-textarea').addEventListener('input', (e) => {
        appState.csvDatasets[index].comments = e.target.value;
        saveState();
    });
}

// ===== RENDER DATA TABLE =====
function renderDataTable(dataset) {
    const table = document.getElementById(`table-${dataset.id}`);
    if (!table) return;

    // Sorteer data indien nodig
    let sortedData = [...dataset.data];
    if (dataset.sortColumn) {
        sortedData.sort((a, b) => {
            const aVal = a[dataset.sortColumn];
            const bVal = b[dataset.sortColumn];
            
            // Numerieke vergelijking
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return dataset.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }
            
            // String vergelijking
            const aStr = String(aVal || '');
            const bStr = String(bVal || '');
            return dataset.sortDirection === 'asc' 
                ? aStr.localeCompare(bStr)
                : bStr.localeCompare(aStr);
        });
    }

    // Bereken totalen
    const totals = calculateTotals(dataset);

    // Build HTML
    let html = '<thead><tr>';
    dataset.visibleColumns.forEach(col => {
        const sortClass = dataset.sortColumn === col 
            ? `sort-${dataset.sortDirection}` 
            : 'sortable';
        html += `<th class="${sortClass}" data-column="${col}">${col}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    sortedData.forEach(row => {
        html += '<tr>';
        dataset.visibleColumns.forEach(col => {
            const value = row[col] != null ? row[col] : '';
            html += `<td>${formatValue(value)}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody>';

    // Totalen rij
    html += '<tfoot><tr>';
    dataset.visibleColumns.forEach(col => {
        const totalValue = totals[col];
        html += `<td>${totalValue != null ? formatValue(totalValue) : ''}</td>`;
    });
    html += '</tr></tfoot>';

    table.innerHTML = html;

    // Add sort listeners
    table.querySelectorAll('th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;
            if (dataset.sortColumn === column) {
                // Toggle direction
                dataset.sortDirection = dataset.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                dataset.sortColumn = column;
                dataset.sortDirection = 'asc';
            }
            saveState();
            renderDataTable(dataset);
        });
    });
}

// ===== BEREKEN TOTALEN =====
function calculateTotals(dataset) {
    const totals = {};
    
    dataset.columns.forEach(col => {
        const values = dataset.data
            .map(row => row[col])
            .filter(v => v != null && typeof v === 'number');
        
        if (values.length > 0) {
            // Simpele som voor numerieke waarden
            // Voor gemiddeldes zou je kunnen checken op specifieke kolomnamen
            if (col.toLowerCase().includes('gemiddeld') || col.toLowerCase().includes('avg')) {
                totals[col] = values.reduce((sum, v) => sum + v, 0) / values.length;
            } else {
                totals[col] = values.reduce((sum, v) => sum + v, 0);
            }
        }
    });
    
    return totals;
}

// ===== FORMAT VALUE =====
function formatValue(value) {
    if (typeof value === 'number') {
        return value.toLocaleString('nl-NL', { maximumFractionDigits: 2 });
    }
    return value;
}

// ===== RENDER CHART =====
function renderChart(dataset) {
    const canvas = document.getElementById(`chart-${dataset.id}`);
    if (!canvas) return;

    // Destroy bestaande chart
    if (chartInstances[dataset.id]) {
        chartInstances[dataset.id].destroy();
    }

    // Geen metrics geselecteerd
    if (dataset.selectedMetrics.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    // Bepaal X-as labels (eerste kolom of index)
    const labels = dataset.data.map((row, idx) => {
        // Probeer een datum/label kolom te vinden
        const labelCol = dataset.columns.find(col => 
            col.toLowerCase().includes('date') || 
            col.toLowerCase().includes('datum') ||
            col.toLowerCase().includes('week') ||
            col.toLowerCase().includes('dag')
        );
        return labelCol ? row[labelCol] : `Rij ${idx + 1}`;
    });

    // Datasets voor Chart.js
    const datasets = dataset.selectedMetrics.map((metric, idx) => {
        const colors = [
            '#667eea', '#f39c12', '#e74c3c', '#2ecc71', '#3498db',
            '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6', '#34495e'
        ];
        
        return {
            label: metric,
            data: dataset.data.map(row => row[metric]),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '33',
            tension: 0.3
        };
    });

    const ctx = canvas.getContext('2d');
    chartInstances[dataset.id] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                title: {
                    display: true,
                    text: dataset.name
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// ===== MARKETING DASHBOARD - RENDER CATEGORY CONTENT =====
function renderCategoryContent() {
    const container = document.getElementById('categoryContent');
    const category = appState.ui.activeCategory;
    const categoryData = appState.categories[category];

    if (!categoryData || !categoryData.variables || categoryData.variables.length === 0) {
        container.innerHTML = `
            <p style="text-align: center; color: #95a5a6; padding: 2rem;">
                Geen variabelen gevonden in ${category}. Importeer JSON data om te beginnen.
            </p>
        `;
        return;
    }

    container.innerHTML = '';

    categoryData.variables.forEach((variable, varIndex) => {
        const card = document.createElement('div');
        card.className = 'variable-card';

        // Bepaal periodes uit data keys
        const periods = variable.data ? Object.keys(variable.data) : [];

        card.innerHTML = `
            <div class="variable-header">
                <div class="variable-info">
                    <h3>${variable.name}</h3>
                    <div class="variable-tags">
                        ${(variable.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('')}
                        ${variable.unit ? `<span class="tag unit-badge">${variable.unit}</span>` : ''}
                    </div>
                </div>
                <label class="checkbox-label">
                    <input 
                        type="checkbox" 
                        ${variable.includePdf !== false ? 'checked' : ''}
                        class="var-include-pdf"
                        data-var-index="${varIndex}"
                    >
                    Opnemen in PDF
                </label>
            </div>

            <table class="variable-data-table">
                <thead>
                    <tr>
                        <th>Periode</th>
                        <th>Waarde</th>
                    </tr>
                </thead>
                <tbody>
                    ${periods.map(period => `
                        <tr>
                            <td>${period}</td>
                            <td>
                                <input 
                                    type="text" 
                                    value="${variable.data[period] != null ? variable.data[period] : ''}"
                                    data-var-index="${varIndex}"
                                    data-period="${period}"
                                    class="var-data-input"
                                >
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>

            <div class="comments-section">
                <label>Opmerkingen:</label>
                <textarea 
                    class="comments-textarea var-comments" 
                    data-var-index="${varIndex}"
                    placeholder="Voeg hier opmerkingen toe..."
                >${variable.comments || ''}</textarea>
            </div>

            <div class="chart-canvas" style="margin-top: 1rem;">
                <canvas id="var-chart-${category}-${varIndex}"></canvas>
            </div>

            ${variable.subVariables && variable.subVariables.length > 0 ? `
                <div class="sub-variables">
                    <h4>Sub-variabelen:</h4>
                    ${variable.subVariables.map((subVar, subIndex) => `
                        <div class="sub-variable">
                            <h4>${subVar.name}</h4>
                            <table class="variable-data-table">
                                <thead>
                                    <tr>
                                        <th>Periode</th>
                                        <th>Waarde</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${Object.keys(subVar.data || {}).map(period => `
                                        <tr>
                                            <td>${period}</td>
                                            <td>
                                                <input 
                                                    type="text" 
                                                    value="${subVar.data[period] != null ? subVar.data[period] : ''}"
                                                    data-var-index="${varIndex}"
                                                    data-sub-index="${subIndex}"
                                                    data-period="${period}"
                                                    class="subvar-data-input"
                                                >
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                            <div class="comments-section">
                                <label>Opmerkingen:</label>
                                <textarea 
                                    class="comments-textarea subvar-comments" 
                                    data-var-index="${varIndex}"
                                    data-sub-index="${subIndex}"
                                    placeholder="Voeg hier opmerkingen toe..."
                                >${subVar.comments || ''}</textarea>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
        `;

        container.appendChild(card);

        // Event listeners
        setupVariableCardListeners(card, category, varIndex);

        // Render chart
        renderVariableChart(category, variable, varIndex);
    });
}

// ===== SETUP VARIABLE CARD LISTENERS =====
function setupVariableCardListeners(card, category, varIndex) {
    const categoryData = appState.categories[category];
    const variable = categoryData.variables[varIndex];

    // Include PDF checkbox
    card.querySelector('.var-include-pdf')?.addEventListener('change', (e) => {
        variable.includePdf = e.target.checked;
        saveState();
    });

    // Variable data inputs
    card.querySelectorAll('.var-data-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const period = e.target.dataset.period;
            const value = e.target.value.trim();
            variable.data[period] = value === '' ? null : parseFloat(value) || value;
            saveState();
            renderVariableChart(category, variable, varIndex);
        });
    });

    // Variable comments
    card.querySelector('.var-comments')?.addEventListener('input', (e) => {
        variable.comments = e.target.value;
        saveState();
    });

    // Sub-variable data inputs
    card.querySelectorAll('.subvar-data-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const subIndex = parseInt(e.target.dataset.subIndex);
            const period = e.target.dataset.period;
            const value = e.target.value.trim();
            const subVar = variable.subVariables[subIndex];
            subVar.data[period] = value === '' ? null : parseFloat(value) || value;
            saveState();
        });
    });

    // Sub-variable comments
    card.querySelectorAll('.subvar-comments').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            const subIndex = parseInt(e.target.dataset.subIndex);
            variable.subVariables[subIndex].comments = e.target.value;
            saveState();
        });
    });
}

// ===== RENDER VARIABLE CHART =====
function renderVariableChart(category, variable, varIndex) {
    const chartId = `var-chart-${category}-${varIndex}`;
    const canvas = document.getElementById(chartId);
    if (!canvas) return;

    // Destroy bestaande chart
    if (chartInstances[chartId]) {
        chartInstances[chartId].destroy();
    }

    const periods = Object.keys(variable.data || {});
    const values = Object.values(variable.data || {}).map(v => 
        v != null && !isNaN(v) ? parseFloat(v) : null
    );

    const ctx = canvas.getContext('2d');
    chartInstances[chartId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: periods,
            datasets: [{
                label: variable.name,
                data: values,
                borderColor: '#667eea',
                backgroundColor: '#667eea33',
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: variable.name
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// ===== JSON IMPORT/EXPORT =====
function openJsonImportModal() {
    document.getElementById('jsonImportModal').classList.add('active');
}

function closeJsonImportModal() {
    document.getElementById('jsonImportModal').classList.remove('active');
    document.getElementById('jsonImportTextarea').value = '';
}

function importJson() {
    const textarea = document.getElementById('jsonImportTextarea');
    const jsonText = textarea.value.trim();

    if (!jsonText) {
        alert('Plak eerst JSON data in het tekstveld.');
        return;
    }

    try {
        const imported = JSON.parse(jsonText);
        
        // Valideer structuur
        if (typeof imported !== 'object') {
            throw new Error('Geen geldig JSON object');
        }

        // Merge of replace categorieën
        Object.keys(imported).forEach(category => {
            if (['ACQUISITION', 'BEHAVIOR', 'CONVERSION', 'LOYALTY'].includes(category)) {
                appState.categories[category] = imported[category];
            }
        });

        saveState();
        renderCategoryContent();
        closeJsonImportModal();
        alert('JSON data succesvol geïmporteerd!');
    } catch (error) {
        alert('Fout bij het importeren van JSON: ' + error.message);
    }
}

function exportJson() {
    const jsonData = JSON.stringify(appState.categories, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'marketing-dashboard-data.json';
    a.click();
    URL.revokeObjectURL(url);
}

// ===== PDF GENERATION =====
async function generatePdf() {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    let yOffset = 10;

    // Titel
    pdf.setFontSize(20);
    pdf.text('Analytics Dashboard Rapport', 10, yOffset);
    yOffset += 10;

    pdf.setFontSize(10);
    pdf.text(`Gegenereerd op: ${new Date().toLocaleDateString('nl-NL')}`, 10, yOffset);
    yOffset += 15;

    // CSV Datasets
    for (const dataset of appState.csvDatasets) {
        if (!dataset.includePdf || !dataset.visible) continue;

        // Nieuwe pagina als niet genoeg ruimte
        if (yOffset > 250) {
            pdf.addPage();
            yOffset = 10;
        }

        pdf.setFontSize(14);
        pdf.text(dataset.name, 10, yOffset);
        yOffset += 7;

        // Capture tabel
        const tableElement = document.getElementById(`table-${dataset.id}`);
        if (tableElement) {
            try {
                const canvas = await html2canvas(tableElement, {
                    scale: 2,
                    logging: false
                });
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = 190;
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                if (yOffset + imgHeight > 280) {
                    pdf.addPage();
                    yOffset = 10;
                }
                
                pdf.addImage(imgData, 'PNG', 10, yOffset, imgWidth, imgHeight);
                yOffset += imgHeight + 10;
            } catch (error) {
                console.error('Error capturing table:', error);
            }
        }

        // Capture grafiek
        if (dataset.selectedMetrics.length > 0) {
            const chartCanvas = document.getElementById(`chart-${dataset.id}`);
            if (chartCanvas) {
                try {
                    const imgData = chartCanvas.toDataURL('image/png');
                    const imgWidth = 190;
                    const imgHeight = 100;
                    
                    if (yOffset + imgHeight > 280) {
                        pdf.addPage();
                        yOffset = 10;
                    }
                    
                    pdf.addImage(imgData, 'PNG', 10, yOffset, imgWidth, imgHeight);
                    yOffset += imgHeight + 10;
                } catch (error) {
                    console.error('Error capturing chart:', error);
                }
            }
        }

        // Opmerkingen
        if (dataset.comments) {
            if (yOffset > 260) {
                pdf.addPage();
                yOffset = 10;
            }
            pdf.setFontSize(10);
            pdf.text('Opmerkingen:', 10, yOffset);
            yOffset += 5;
            const lines = pdf.splitTextToSize(dataset.comments, 190);
            pdf.text(lines, 10, yOffset);
            yOffset += lines.length * 5 + 10;
        }

        yOffset += 5;
    }

    // Marketing Dashboard categorieën
    for (const categoryName of ['ACQUISITION', 'BEHAVIOR', 'CONVERSION', 'LOYALTY']) {
        const category = appState.categories[categoryName];
        if (!category || !category.variables) continue;

        const includedVars = category.variables.filter(v => v.includePdf !== false);
        if (includedVars.length === 0) continue;

        pdf.addPage();
        yOffset = 10;

        pdf.setFontSize(16);
        pdf.text(categoryName, 10, yOffset);
        yOffset += 10;

        for (const variable of includedVars) {
            if (yOffset > 250) {
                pdf.addPage();
                yOffset = 10;
            }

            pdf.setFontSize(12);
            pdf.text(variable.name, 10, yOffset);
            yOffset += 7;

            // Variable data als tabel
            pdf.setFontSize(9);
            const periods = Object.keys(variable.data || {});
            const cellWidth = 40;
            let xPos = 10;

            // Headers
            pdf.text('Periode', xPos, yOffset);
            xPos += cellWidth;
            pdf.text('Waarde', xPos, yOffset);
            yOffset += 5;

            // Data rows
            periods.forEach(period => {
                xPos = 10;
                pdf.text(period, xPos, yOffset);
                xPos += cellWidth;
                const value = variable.data[period];
                pdf.text(value != null ? String(value) : '-', xPos, yOffset);
                yOffset += 5;
            });

            yOffset += 5;

            // Opmerkingen
            if (variable.comments) {
                if (yOffset > 260) {
                    pdf.addPage();
                    yOffset = 10;
                }
                pdf.setFontSize(9);
                pdf.text('Opmerkingen:', 10, yOffset);
                yOffset += 4;
                const lines = pdf.splitTextToSize(variable.comments, 190);
                pdf.text(lines, 10, yOffset);
                yOffset += lines.length * 4 + 5;
            }
        }
    }

    // Save PDF
    pdf.save('analytics-dashboard-rapport.pdf');
    alert('PDF succesvol gegenereerd!');
}

// ===== LOCAL STORAGE =====
function saveState() {
    try {
        const serialized = JSON.stringify(appState);
        localStorage.setItem('analyticsDashboardState', serialized);
    } catch (error) {
        console.error('Error saving state:', error);
    }
}

function loadState() {
    try {
        const saved = localStorage.getItem('analyticsDashboardState');
        if (saved) {
            const parsed = JSON.parse(saved);
            
            // Merge met bestaande state
            if (parsed.csvDatasets) {
                appState.csvDatasets = parsed.csvDatasets;
            }
            if (parsed.categories) {
                appState.categories = parsed.categories;
            }
            if (parsed.ui) {
                appState.ui = parsed.ui;
            }

            // Update UI op basis van opgeslagen state
            if (appState.ui.activeTab) {
                switchTab(appState.ui.activeTab);
            }
            if (appState.ui.activeCategory) {
                document.querySelectorAll('.category-tab').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.category === appState.ui.activeCategory);
                });
            }
        } else {
            // Initialiseer met voorbeeld data
            initializeDefaultData();
        }
    } catch (error) {
        console.error('Error loading state:', error);
        initializeDefaultData();
    }
}

// ===== INITIALISEER DEFAULT DATA =====
function initializeDefaultData() {
    appState.categories = {
        ACQUISITION: {
            variables: [
                {
                    name: "Nieuwe bezoekers",
                    tags: ["website"],
                    unit: "",
                    data: {
                        "Week 1": 322,
                        "Week 2": null,
                        "Week 3": null,
                        "Week 4": null
                    },
                    includePdf: true,
                    comments: "",
                    subVariables: [
                        {
                            name: "Pageviews van landingspagina",
                            data: {
                                "Week 1": null,
                                "Week 2": null,
                                "Week 3": null,
                                "Week 4": null
                            },
                            comments: ""
                        }
                    ]
                }
            ]
        },
        BEHAVIOR: {
            variables: [
                {
                    name: "Gemiddelde sessieduur",
                    tags: ["engagement"],
                    unit: "minuten",
                    data: {
                        "Week 1": 3.5,
                        "Week 2": null,
                        "Week 3": null,
                        "Week 4": null
                    },
                    includePdf: true,
                    comments: "",
                    subVariables: []
                }
            ]
        },
        CONVERSION: {
            variables: [
                {
                    name: "Conversie rate",
                    tags: ["sales"],
                    unit: "%",
                    data: {
                        "Week 1": 2.5,
                        "Week 2": null,
                        "Week 3": null,
                        "Week 4": null
                    },
                    includePdf: true,
                    comments: "",
                    subVariables: []
                }
            ]
        },
        LOYALTY: {
            variables: [
                {
                    name: "Terugkerende bezoekers",
                    tags: ["retention"],
                    unit: "",
                    data: {
                        "Week 1": 156,
                        "Week 2": null,
                        "Week 3": null,
                        "Week 4": null
                    },
                    includePdf: true,
                    comments: "",
                    subVariables: []
                }
            ]
        }
    };
    saveState();
}

// ===== RENDER ACTIVE SECTION =====
function renderActiveSection() {
    if (appState.ui.activeTab === 'csv') {
        renderCsvDatasets();
    } else {
        renderCategoryContent();
    }
}
                