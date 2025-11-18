// ===== ANALYTICS DASHBOARD - HERZIENE VERSIE =====
// Elke categorie heeft zijn eigen upload en datasets

// ===== APP STATE =====
const appState = {
    categories: {
        ACQUISITION: { datasets: [] },
        BEHAVIOR: { datasets: [] },
        CONVERSION: { datasets: [] },
        LOYALTY: { datasets: [] }
    }
};

// Chart instances
const chartInstances = {};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    renderAll();
});

// ===== EVENT LISTENERS =====
function setupEventListeners() {
    // Upload buttons per categorie
    document.querySelectorAll('.upload-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const category = btn.dataset.category;
            document.getElementById(`upload-${category}`).click();
        });
    });

    // File uploads
    ['ACQUISITION', 'BEHAVIOR', 'CONVERSION', 'LOYALTY'].forEach(category => {
        document.getElementById(`upload-${category}`).addEventListener('change', (e) => {
            handleCsvUpload(e, category);
        });
    });

    // PDF Export
    document.getElementById('exportPdfBtn').addEventListener('click', generatePdf);
}

// ===== CSV UPLOAD =====
function handleCsvUpload(event, category) {
    const files = event.target.files;
    
    Array.from(files).forEach(file => {
        Papa.parse(file, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                addDataset(category, file.name, results.data, results.meta.fields);
            },
            error: (error) => {
                console.error('CSV parse error:', error);
                alert('Fout bij het inlezen van CSV: ' + error.message);
            }
        });
    });

    event.target.value = '';
}

// ===== ADD DATASET =====
function addDataset(category, filename, data, columns) {
    // Filter irrelevante kolommen (die met < beginnen zijn niet relevant)
    const relevantColumns = columns.filter(col => !col.startsWith('<'));
    
    // Bepaal numerieke kolommen voor grafieken
    const numericColumns = relevantColumns.filter(col => 
        isNumericColumn(col, data)
    );

    const dataset = {
        id: Date.now() + Math.random(),
        name: filename.replace('.csv', ''),
        data: data,
        allColumns: columns,
        visibleColumns: [...relevantColumns],
        selectedMetrics: numericColumns.slice(0, 3), // Max 3 metrics standaard
        includePdf: true,
        comments: '',
        sortColumn: null,
        sortDirection: 'asc',
        expanded: false
    };

    appState.categories[category].datasets.push(dataset);
    saveState();
    renderCategory(category);
}

// ===== CHECK NUMERIC COLUMN =====
function isNumericColumn(columnName, data) {
    // Skip duidelijk niet-numerieke kolommen
    const lowerName = columnName.toLowerCase();
    if (lowerName.includes('pad') || lowerName.includes('naam') || 
        lowerName.includes('klasse') || lowerName.includes('pagina')) {
        return false;
    }

    const samples = data.slice(0, 10)
        .map(row => row[columnName])
        .filter(v => v != null);
    
    return samples.some(value => 
        typeof value === 'number' || !isNaN(parseFloat(value))
    );
}

// ===== RENDER ALL =====
function renderAll() {
    ['ACQUISITION', 'BEHAVIOR', 'CONVERSION', 'LOYALTY'].forEach(category => {
        renderCategory(category);
    });
}

// ===== RENDER CATEGORY =====
function renderCategory(category) {
    const container = document.getElementById(`datasets-${category}`);
    const datasets = appState.categories[category].datasets;

    if (datasets.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '';

    datasets.forEach((dataset, index) => {
        const card = createDatasetCard(dataset, category, index);
        container.appendChild(card);
    });
}

// ===== CREATE DATASET CARD =====
function createDatasetCard(dataset, category, index) {
    const card = document.createElement('div');
    card.className = 'dataset-card';

    card.innerHTML = `
        <div class="dataset-card-header">
            <div class="dataset-title">
                <div class="dataset-name">${dataset.name}</div>
                <div class="dataset-meta">${dataset.data.length} rijen • ${dataset.visibleColumns.length} kolommen</div>
            </div>
            <div class="dataset-actions">
                <button class="btn btn-danger delete-btn" data-category="${category}" data-index="${index}">
                    🗑️
                </button>
            </div>
        </div>

        <!-- Mini Chart Preview -->
        <div class="mini-chart-container">
            <canvas class="mini-chart-canvas" id="mini-chart-${dataset.id}"></canvas>
        </div>

        <label class="pdf-checkbox">
            <input type="checkbox" ${dataset.includePdf ? 'checked' : ''} 
                   class="include-pdf-check" data-category="${category}" data-index="${index}">
            Opnemen in PDF rapport
        </label>

        <!-- Expandable Details -->
        <div class="expandable-section">
            <button class="expand-toggle" data-dataset-id="${dataset.id}">
                Tabel & Opties tonen
            </button>
            <div class="expandable-content" id="expand-${dataset.id}">
                
                <!-- Column Visibility -->
                <div class="column-visibility">
                    <h4>Zichtbare kolommen:</h4>
                    <div class="column-checkboxes">
                        ${dataset.visibleColumns.map(col => `
                            <label class="checkbox-label">
                                <input type="checkbox" checked 
                                       data-category="${category}" 
                                       data-index="${index}" 
                                       data-column="${col}" 
                                       class="column-toggle">
                                ${col}
                            </label>
                        `).join('')}
                    </div>
                </div>

                <!-- Data Table -->
                <div class="data-table-container">
                    <table class="data-table" id="table-${dataset.id}"></table>
                </div>

                <!-- Chart Controls -->
                <div class="chart-controls">
                    <h4>Metrics in grafiek:</h4>
                    <div class="metric-checkboxes">
                        ${dataset.visibleColumns.filter(col => isNumericColumn(col, dataset.data)).map(col => `
                            <label class="checkbox-label">
                                <input type="checkbox" 
                                       ${dataset.selectedMetrics.includes(col) ? 'checked' : ''}
                                       data-category="${category}" 
                                       data-index="${index}" 
                                       data-metric="${col}" 
                                       class="metric-toggle">
                                ${col}
                            </label>
                        `).join('')}
                    </div>
                </div>

                <!-- Full Chart -->
                <div class="full-chart-container">
                    <canvas id="chart-${dataset.id}"></canvas>
                </div>

                <!-- Comments -->
                <div class="comments-section">
                    <label>Opmerkingen:</label>
                    <textarea class="comments-textarea" 
                              data-category="${category}" 
                              data-index="${index}"
                              placeholder="Voeg opmerkingen toe over deze dataset...">${dataset.comments || ''}</textarea>
                </div>

            </div>
        </div>
    `;

    // Setup event listeners
    setupCardListeners(card, dataset, category, index);

    // Render charts en table
    renderMiniChart(dataset);
    renderTable(dataset);
    renderFullChart(dataset);

    return card;
}

// ===== SETUP CARD LISTENERS =====
function setupCardListeners(card, dataset, category, index) {
    // Delete button
    card.querySelector('.delete-btn').addEventListener('click', () => {
        if (confirm('Dataset verwijderen?')) {
            destroyCharts(dataset);
            appState.categories[category].datasets.splice(index, 1);
            saveState();
            renderCategory(category);
        }
    });

    // PDF checkbox
    card.querySelector('.include-pdf-check').addEventListener('change', (e) => {
        dataset.includePdf = e.target.checked;
        saveState();
    });

    // Expand/collapse
    const toggleBtn = card.querySelector('.expand-toggle');
    const content = card.querySelector('.expandable-content');
    
    toggleBtn.addEventListener('click', () => {
        dataset.expanded = !dataset.expanded;
        toggleBtn.classList.toggle('expanded', dataset.expanded);
        content.classList.toggle('expanded', dataset.expanded);
        
        if (dataset.expanded) {
            // Re-render charts when expanded
            setTimeout(() => {
                renderFullChart(dataset);
            }, 100);
        }
        saveState();
    });

    // Set initial state
    if (dataset.expanded) {
        toggleBtn.classList.add('expanded');
        content.classList.add('expanded');
    }

    // Column toggles
    card.querySelectorAll('.column-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const column = e.target.dataset.column;
            if (!e.target.checked) {
                dataset.visibleColumns = dataset.visibleColumns.filter(c => c !== column);
            } else {
                if (!dataset.visibleColumns.includes(column)) {
                    dataset.visibleColumns.push(column);
                }
            }
            saveState();
            renderTable(dataset);
        });
    });

    // Metric toggles
    card.querySelectorAll('.metric-toggle').forEach(checkbox => {
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
            renderMiniChart(dataset);
            renderFullChart(dataset);
        });
    });

    // Comments
    card.querySelector('.comments-textarea').addEventListener('input', (e) => {
        dataset.comments = e.target.value;
        saveState();
    });
}

// ===== RENDER TABLE =====
function renderTable(dataset) {
    const table = document.getElementById(`table-${dataset.id}`);
    if (!table) return;

    let sortedData = [...dataset.data];
    if (dataset.sortColumn) {
        sortedData.sort((a, b) => {
            const aVal = a[dataset.sortColumn];
            const bVal = b[dataset.sortColumn];
            
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return dataset.sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }
            
            const aStr = String(aVal || '');
            const bStr = String(bVal || '');
            return dataset.sortDirection === 'asc' 
                ? aStr.localeCompare(bStr)
                : bStr.localeCompare(aStr);
        });
    }

    const totals = calculateTotals(dataset);

    let html = '<thead><tr>';
    dataset.visibleColumns.forEach(col => {
        const sortClass = dataset.sortColumn === col 
            ? `sort-${dataset.sortDirection}` 
            : 'sortable';
        html += `<th class="${sortClass}" data-column="${col}">${col}</th>`;
    });
    html += '</tr></thead><tbody>';

    sortedData.forEach(row => {
        html += '<tr>';
        dataset.visibleColumns.forEach(col => {
            const value = row[col] != null ? row[col] : '';
            html += `<td>${formatValue(value)}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody><tfoot><tr>';
    dataset.visibleColumns.forEach(col => {
        const totalValue = totals[col];
        html += `<td><strong>${totalValue != null ? 'Σ ' + formatValue(totalValue) : ''}</strong></td>`;
    });
    html += '</tr></tfoot>';

    table.innerHTML = html;

    // Sort listeners
    table.querySelectorAll('th[data-column]').forEach(th => {
        th.addEventListener('click', () => {
            const column = th.dataset.column;
            if (dataset.sortColumn === column) {
                dataset.sortDirection = dataset.sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                dataset.sortColumn = column;
                dataset.sortDirection = 'asc';
            }
            saveState();
            renderTable(dataset);
        });
    });
}

// ===== CALCULATE TOTALS =====
function calculateTotals(dataset) {
    const totals = {};
    
    dataset.visibleColumns.forEach(col => {
        const values = dataset.data
            .map(row => row[col])
            .filter(v => v != null && typeof v === 'number');
        
        if (values.length > 0) {
            // Voor gemiddelde kolommen
            if (col.toLowerCase().includes('gemiddeld') || 
                col.toLowerCase().includes('per actieve') ||
                col.toLowerCase().includes('avg')) {
                totals[col] = values.reduce((sum, v) => sum + v, 0) / values.length;
            } else {
                // Som
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

// ===== RENDER MINI CHART =====
function renderMiniChart(dataset) {
    const canvas = document.getElementById(`mini-chart-${dataset.id}`);
    if (!canvas) return;

    const chartId = `mini-chart-${dataset.id}`;
    if (chartInstances[chartId]) {
        chartInstances[chartId].destroy();
    }

    if (dataset.selectedMetrics.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const labels = dataset.data.map((row, idx) => {
        const labelCol = dataset.visibleColumns.find(col => 
            col.toLowerCase().includes('pad') || 
            col.toLowerCase().includes('pagina')
        );
        return labelCol ? String(row[labelCol]).substring(0, 20) : `Rij ${idx + 1}`;
    });

    const datasets = dataset.selectedMetrics.map((metric, idx) => {
        const colors = ['#667eea', '#f39c12', '#e74c3c', '#2ecc71', '#3498db'];
        return {
            label: metric,
            data: dataset.data.map(row => row[metric]),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '22',
            tension: 0.3,
            borderWidth: 2
        };
    });

    const ctx = canvas.getContext('2d');
    chartInstances[chartId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 10 } } },
                title: { display: false }
            },
            scales: {
                y: { beginAtZero: true, ticks: { font: { size: 9 } } },
                x: { ticks: { font: { size: 8 }, maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

// ===== RENDER FULL CHART =====
function renderFullChart(dataset) {
    const canvas = document.getElementById(`chart-${dataset.id}`);
    if (!canvas) return;

    const chartId = `chart-${dataset.id}`;
    if (chartInstances[chartId]) {
        chartInstances[chartId].destroy();
    }

    if (dataset.selectedMetrics.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const labels = dataset.data.map((row, idx) => {
        const labelCol = dataset.visibleColumns.find(col => 
            col.toLowerCase().includes('pad') || 
            col.toLowerCase().includes('pagina')
        );
        return labelCol ? String(row[labelCol]) : `Rij ${idx + 1}`;
    });

    const datasets = dataset.selectedMetrics.map((metric, idx) => {
        const colors = ['#667eea', '#f39c12', '#e74c3c', '#2ecc71', '#3498db'];
        return {
            label: metric,
            data: dataset.data.map(row => row[metric]),
            borderColor: colors[idx % colors.length],
            backgroundColor: colors[idx % colors.length] + '33',
            tension: 0.3,
            borderWidth: 3
        };
    });

    const ctx = canvas.getContext('2d');
    chartInstances[chartId] = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: true, position: 'top' },
                title: { display: true, text: dataset.name, font: { size: 14, weight: 'bold' } }
            },
            scales: {
                y: { beginAtZero: true },
                x: { ticks: { maxRotation: 45, minRotation: 0 } }
            }
        }
    });
}

// ===== DESTROY CHARTS =====
function destroyCharts(dataset) {
    [`mini-chart-${dataset.id}`, `chart-${dataset.id}`].forEach(chartId => {
        if (chartInstances[chartId]) {
            chartInstances[chartId].destroy();
            delete chartInstances[chartId];
        }
    });
}

// ===== PDF GENERATION =====
async function generatePdf() {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    let yOffset = 10;

    pdf.setFontSize(20);
    pdf.text('Analytics Dashboard Rapport', 10, yOffset);
    yOffset += 10;

    pdf.setFontSize(10);
    pdf.text(`Gegenereerd: ${new Date().toLocaleString('nl-NL')}`, 10, yOffset);
    yOffset += 15;

    for (const categoryName of ['ACQUISITION', 'BEHAVIOR', 'CONVERSION', 'LOYALTY']) {
        const category = appState.categories[categoryName];
        const includedDatasets = category.datasets.filter(d => d.includePdf);

        if (includedDatasets.length === 0) continue;

        pdf.setFontSize(16);
        pdf.text(categoryName, 10, yOffset);
        yOffset += 10;

        for (const dataset of includedDatasets) {
            if (yOffset > 250) {
                pdf.addPage();
                yOffset = 10;
            }

            pdf.setFontSize(14);
            pdf.text(dataset.name, 10, yOffset);
            yOffset += 7;

            // Table
            const tableEl = document.getElementById(`table-${dataset.id}`);
            if (tableEl) {
                try {
                    const canvas = await html2canvas(tableEl, { scale: 1.5 });
                    const imgData = canvas.toDataURL('image/png');
                    const imgWidth = 190;
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;
                    
                    if (yOffset + imgHeight > 280) {
                        pdf.addPage();
                        yOffset = 10;
                    }
                    
                    pdf.addImage(imgData, 'PNG', 10, yOffset, imgWidth, Math.min(imgHeight, 150));
                    yOffset += Math.min(imgHeight, 150) + 5;
                } catch (e) {
                    console.error('Error capturing table:', e);
                }
            }

            // Chart
            if (dataset.selectedMetrics.length > 0) {
                const chartCanvas = document.getElementById(`chart-${dataset.id}`);
                if (chartCanvas) {
                    try {
                        const imgData = chartCanvas.toDataURL('image/png');
                        const imgHeight = 80;
                        
                        if (yOffset + imgHeight > 280) {
                            pdf.addPage();
                            yOffset = 10;
                        }
                        
                        pdf.addImage(imgData, 'PNG', 10, yOffset, 190, imgHeight);
                        yOffset += imgHeight + 5;
                    } catch (e) {
                        console.error('Error capturing chart:', e);
                    }
                }
            }

            // Comments
            if (dataset.comments) {
                if (yOffset > 260) {
                    pdf.addPage();
                    yOffset = 10;
                }
                pdf.setFontSize(9);
                pdf.text('Opmerkingen:', 10, yOffset);
                yOffset += 5;
                const lines = pdf.splitTextToSize(dataset.comments, 190);
                pdf.text(lines, 10, yOffset);
                yOffset += lines.length * 4 + 10;
            }

            yOffset += 5;
        }

        yOffset += 10;
    }

    pdf.save(`analytics-rapport-${new Date().toISOString().split('T')[0]}.pdf`);
    alert('PDF succesvol gegenereerd!');
}

// ===== LOCAL STORAGE =====
function saveState() {
    try {
        localStorage.setItem('analyticsDashboardState', JSON.stringify(appState));
    } catch (e) {
        console.error('Error saving state:', e);
    }
}

function loadState() {
    try {
        const saved = localStorage.getItem('analyticsDashboardState');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(appState, parsed);
        }
    } catch (e) {
        console.error('Error loading state:', e);
    }
}
