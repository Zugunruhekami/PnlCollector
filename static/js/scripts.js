document.addEventListener('DOMContentLoaded', (event) => {
    const form = document.getElementById('pnlForm');
    const message = document.getElementById('message');
    const loading = document.getElementById('loading');
    const pnlTable = document.getElementById('pnlTable');
    let pnlData = [];

    // Fetch initial PNL data
    fetchPnLData().then(data => {
        pnlData = data;
        renderPnLTable();
        startSessionCheck();
        // Call other functions that use pnlData for charts here
    });

    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            console.log('Form submit event triggered');
          
            if (!validateForm()) {
                return;
            }
      
            // Show loading spinner
            if (loading) {
                loading.style.display = 'flex';
            } else {
                console.warn('Loading element not found');
            }
          
            const formData = {
                book: document.getElementById('book').value,
                pnl: parseFloat(document.getElementById('pnl').value),
                session: document.getElementById('session').value
            };
      
            console.log('Sending form data:', formData);
      
            fetch('/submit_pnl', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                // Hide loading spinner
                if (loading) {
                    loading.style.display = 'none';
                }
                console.log('Response received:', data);
                if (data.detail) {
                    showMessage('error', data.detail);
                } else {
                    showMessage('success', data.message);
                    form.reset();
                    // Update the table with new data
                    updateTableWithNewData(formData);
                }
            })
            .catch((error) => {
                // Hide loading spinner
                if (loading) {
                    loading.style.display = 'none';
                }
                console.error('Error:', error);
                showMessage('error', `An error occurred: ${error.message}`);
            });
        });
    }
      
    function validateForm() {
        const book = document.getElementById('book').value;
        const pnl = document.getElementById('pnl').value;
        const session = document.getElementById('session').value;
      
        if (!book || book.trim() === '') {
            showMessage('error', 'Please select a book.');
            return false;
        }
      
        if (isNaN(pnl) || pnl === '') {
            showMessage('error', 'Please enter a valid number for PNL.');
            return false;
        }
      
        if (!session || session.trim() === '') {
            showMessage('error', 'Please select a session.');
            return false;
        }
      
        return true;
    }

    function showMessage(type, text) {
        message.innerHTML = `<p class="${type}">${text}</p>`;
        message.classList.add('show');
        setTimeout(() => {
            message.classList.remove('show');
        }, 5000);
    }
    
    // Create floating background elements
    const background = document.querySelector('.background');
    for (let i = 0; i < 20; i++) {
        const span = document.createElement('span');
        span.style.top = `${Math.random() * 100}%`;
        span.style.left = `${Math.random() * 100}%`;
        span.style.width = `${Math.random() * 50 + 10}px`;
        span.style.height = span.style.width;
        span.style.opacity = Math.random() * 0.1;
        span.style.animationDuration = `${Math.random() * 10 + 5}s`;
        background.appendChild(span);
    }
    
    // Add page transition effect
    const fancyLinks = document.querySelectorAll('.fancy-link');
    fancyLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const href = this.getAttribute('href');
    
            // Create and append transition overlay
            const overlay = document.createElement('div');
            overlay.classList.add('page-transition');
            document.body.appendChild(overlay);
    
            // Create and append diagonal wipe element
            const wipe = document.createElement('div');
            wipe.classList.add('diagonal-wipe');
            overlay.appendChild(wipe);
    
            // Trigger transition
            setTimeout(() => {
                overlay.classList.add('active');
            }, 10);
    
            // Navigate to new page after transition
            setTimeout(() => {
                window.location.href = href;
            }, 1000);
        });
    });
    
    // Check if we've just transitioned to this page
    if (performance.navigation.type === performance.navigation.TYPE_NAVIGATE) {
        const overlay = document.createElement('div');
        overlay.classList.add('page-transition', 'active');
        
        const wipe = document.createElement('div');
        wipe.classList.add('diagonal-wipe');
        overlay.appendChild(wipe);
        
        document.body.appendChild(overlay);
    
        setTimeout(() => {
            overlay.classList.remove('active');
        }, 10);
    
        setTimeout(() => {
            overlay.remove();
        }, 1000);
    }

    function preprocessPnLData(data) {
        const processedData = {};
        for (const [book, sessions] of Object.entries(data)) {
            processedData[book] = {
                ASIA: sessions.ASIA || undefined,
                LONDON: sessions.LONDON || undefined,
                'NEW YORK': sessions['NEW YORK'] || undefined,
                EOD: sessions.EOD || undefined
            };
        }
        return processedData;
    }

    function renderPnLTable() {
        const todayData = preprocessPnLData(pnlData.todays_pnl);
        console.log("Today's data:", todayData);
        const bookHierarchy = createBookHierarchy(todayData);
        const tableBody = document.getElementById('tableBody');
        
        if (!tableBody) {
            console.error('Table body element not found');
            return;
        }
        
        tableBody.innerHTML = '';
    
        function renderBookRow(book, level = 0) {
            const row = document.createElement('div');
            row.className = 'table-row book-row';
            row.setAttribute('data-level', level);
    
            const indentation = '&nbsp;'.repeat(level * 4);
            row.innerHTML = `
                <div class="cell book-cell">${indentation}${book.name}</div>
                ${renderPnLCells(book)}
            `;
    
            tableBody.appendChild(row);
            Object.values(book.children).forEach(child => renderBookRow(child, level + 1));
        }
    
        Object.values(bookHierarchy).forEach(book => renderBookRow(book));
        addRowGroupToggle();
        highlightMissingInputs();
    }
    
    function renderPnLCells(book) {
        return ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(session => {
            const pnl = book.pnl[session];
            const cellClass = pnl ? (Math.abs(pnl) > getStandardDeviation(book) ? 'highlight' : '') : 'missing';
            return `<div class="cell ${cellClass}">${pnl !== undefined ? pnl.toFixed(2) : '-'}</div>`;
        }).join('');
    }
    
    function updateTableWithNewData(newData) {
        const bookParts = newData.book.split('/');
        const rows = document.querySelectorAll('.book-row');
        
        rows.forEach(row => {
            const level = parseInt(row.getAttribute('data-level'));
            const bookCell = row.querySelector('.book-cell');
            const bookName = bookCell.textContent.trim();
            
            if (bookName === bookParts[level]) {
                const cells = row.querySelectorAll('.cell');
                const sessionIndex = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].indexOf(newData.session);
                
                if (sessionIndex !== -1) {
                    const cell = cells[sessionIndex + 1];
                    cell.textContent = newData.pnl.toFixed(2);
                    cell.classList.remove('missing');
                    cell.classList.add('updated');
                    
                    setTimeout(() => {
                        cell.classList.remove('updated');
                    }, 2000);
                }
            }
        });
        
        highlightMissingInputs();
    }

    function createBookHierarchy(data) {
        const hierarchy = {};
        Object.entries(data).forEach(([book, pnlData]) => {
            const bookParts = book.split('/');
            let currentLevel = hierarchy;
            bookParts.forEach((part, index) => {
                if (!currentLevel[part]) {
                    currentLevel[part] = { name: part, children: {}, pnl: {} };
                }
                if (index === bookParts.length - 1) {
                    currentLevel[part].pnl = pnlData;
                }
                currentLevel = currentLevel[part].children;
            });
        });
        return hierarchy;
    }

    function getStandardDeviation(book) {
        const values = Object.values(book.pnl).filter(v => v !== undefined);
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const squareDiffs = values.map(value => Math.pow(value - mean, 2));
        const avgSquareDiff = squareDiffs.reduce((sum, value) => sum + value, 0) / squareDiffs.length;
        return Math.sqrt(avgSquareDiff);
    }

    function addRowGroupToggle() {
        document.querySelectorAll('.book-row').forEach(row => {
            row.addEventListener('click', () => {
                const level = parseInt(row.getAttribute('data-level'));
                let nextRow = row.nextElementSibling;
                while (nextRow && parseInt(nextRow.getAttribute('data-level')) > level) {
                    nextRow.classList.toggle('hidden');
                    nextRow = nextRow.nextElementSibling;
                }
            });
        });
    }

    function highlightMissingInputs() {
        const now = new Date();
        const sessions = [
            { name: 'ASIA', start: 4, end: 10 },
            { name: 'LONDON', start: 10, end: 16 },
            { name: 'NEW YORK', start: 16, end: 22 },
            { name: 'EOD', start: 22, end: 4 }
        ];

        const currentSession = sessions.find(session => {
            const currentHour = now.getUTCHours();
            if (session.start < session.end) {
                return currentHour >= session.start && currentHour < session.end;
            } else {
                return currentHour >= session.start || currentHour < session.end;
            }
        });

        if (currentSession) {
            document.querySelectorAll('.missing').forEach(cell => {
                const cellIndex = Array.from(cell.parentNode.children).indexOf(cell);
                if (sessions.findIndex(s => s.name === currentSession.name) < cellIndex - 1) {
                    cell.classList.add('warning');
                }
            });
        }
    }

    function startSessionCheck() {
        setInterval(highlightMissingInputs, 60000); // Check every minute
    }
});

async function fetchPnLData() {
    const response = await fetch('/get_pnl_data');
    return await response.json();
}

function createCumulativePnlChart(data) {
    const ctx = document.getElementById('cumulativePnlChart').getContext('2d');
    const dates = Object.keys(data);
    const books = Object.keys(data[dates[0]]);
    const datasets = books.map(book => ({
        label: book,
        data: dates.map(date => data[date][book]),
        fill: false
    }));

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            title: {
                display: true,
                text: 'Cumulative PnL Over Time'
            }
        }
    });
}

function createDailySessionPnlChart(data) {
    const ctx = document.getElementById('dailySessionPnlChart').getContext('2d');
    const dates = Object.keys(data);
    const sessions = Object.keys(data[dates[0]]);
    const datasets = sessions.map(session => ({
        label: session,
        data: dates.map(date => data[date][session]),
        stack: 'Stack 0'
    }));

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            title: {
                display: true,
                text: 'Daily PnL Contribution by Session'
            },
            scales: {
                x: {
                    stacked: true,
                },
                y: {
                    stacked: true
                }
            }
        }
    });
}

function createPnlHeatmapChart(data) {
    const ctx = document.getElementById('pnlHeatmapChart').getContext('2d');
    const books = Object.keys(data);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    const heatmapData = [];
    let minValue = Infinity;
    let maxValue = -Infinity;

    books.forEach((book, bookIndex) => {
        days.forEach((day, dayIndex) => {
            const value = data[book][dayIndex] || 0;
            heatmapData.push({
                x: dayIndex,
                y: bookIndex,
                v: value
            });
            minValue = Math.min(minValue, value);
            maxValue = Math.max(maxValue, value);
        });
    });

    const colorScale = chroma.scale(['red', 'white', 'green']).domain([minValue, 0, maxValue]);

    new Chart(ctx, {
        type: 'matrix',
        data: {
            datasets: [{
                label: 'PnL Performance Heatmap',
                data: heatmapData,
                backgroundColor: (context) => {
                    const value = context.dataset.data[context.dataIndex].v;
                    return colorScale(value).hex();
                },
                borderColor: '#ffffff',
                borderWidth: 1,
                width: ({ chart }) => (chart.chartArea || {}).width / 7 - 1,
                height: ({ chart }) => (chart.chartArea || {}).height / books.length - 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'category',
                    labels: days,
                    offset: true,
                    ticks: {
                        stepSize: 1
                    }
                },
                y: {
                    type: 'category',
                    labels: books,
                    offset: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        title: (context) => {
                            const dataIndex = context[0].dataIndex;
                            const book = books[Math.floor(dataIndex / 7)];
                            const day = days[dataIndex % 7];
                            return `${book} - ${day}`;
                        },
                        label: (context) => {
                            return `PnL: $${context.dataset.data[context.dataIndex].v.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

function createPnLHeatmap(data) {
    const ctx = document.getElementById('pnlHeatmap');
    if (!ctx) {
        console.error('Canvas element not found for PnL Heatmap');
        return;
    }

    const dates = Object.keys(data).sort((a, b) => new Date(a) - new Date(b));
    const books = Object.keys(data[dates[0]]);

    const chartData = dates.flatMap(date => 
        books.map(book => ({
            x: date,
            y: book,
            v: data[date][book]
        }))
    );

    const minPnL = Math.min(...chartData.map(d => Number(d.v) || 0));
    const maxPnL = Math.max(...chartData.map(d => Number(d.v) || 0));
    const absMax = Math.max(Math.abs(minPnL), Math.abs(maxPnL));

    // Calculate insights
    const bookPerformance = books.map(book => {
        const pnlValues = dates.map(date => Number(data[date][book]) || 0);
        const totalPnL = pnlValues.reduce((sum, val) => sum + val, 0);
        const avgPnL = totalPnL / dates.length;
        const variance = pnlValues.reduce((sum, val) => sum + Math.pow(val - avgPnL, 2), 0) / dates.length;
        return {
            name: book,
            totalPnL,
            avgPnL,
            volatility: Math.sqrt(variance)
        };
    });

    bookPerformance.sort((a, b) => b.totalPnL - a.totalPnL);

    const bestBook = bookPerformance[0];
    const worstBook = bookPerformance[bookPerformance.length - 1];
    const mostVolatileBook = bookPerformance.reduce((prev, current) => (prev.volatility > current.volatility) ? prev : current);

    // Calculate the height based on the number of books
    const height = Math.max(400, books.length * 20);
    ctx.height = height;

    new Chart(ctx, {
        type: 'scatter',
        data: {
            labels: dates,
            datasets: [{
                label: 'PnL Heatmap',
                data: chartData,
                backgroundColor: (context) => {
                    const value = Number(context.raw.v) || 0;
                    const alpha = Math.abs(value) / absMax;
                    return value > 0
                        ? `rgba(0, 255, 0, ${alpha})`
                        : `rgba(255, 0, 0, ${alpha})`;
                },
                borderColor: 'rgba(0, 0, 0, 0.1)',
                borderWidth: 1,
                pointRadius: 10,
                pointHoverRadius: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        label(context) {
                            const v = context.raw;
                            return [
                                `Date: ${v.x}`,
                                `Book: ${v.y}`,
                                `PnL: ${Number(v.v).toFixed(2)}`
                            ];
                        }
                    }
                },
                legend: {
                    display: false
                },
                title: {
                    display: true,
                    text: 'PnL Heatmap by Book and Date'
                }
            },
            scales: {
                x: {
                    type: 'category',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Date'
                    },
                    ticks: {
                        maxRotation: 90,
                        minRotation: 90,
                        autoSkip: true,
                        maxTicksLimit: 20
                    }
                },
                y: {
                    type: 'category',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Book'
                    },
                    reverse: true,
                    ticks: {
                        autoSkip: true,
                        maxTicksLimit: 20,
                        callback: function(value, index, values) {
                            if (index % 5 === 0 || index === 0 || index === values.length - 1) {
                                return value;
                            }
                            return '';
                        }
                    }
                }
            },
            layout: {
                padding: {
                    top: 30,
                    right: 10,
                    bottom: 50,
                    left: 100
                }
            }
        }
    });

    // Display insights
    const insightsDiv = document.createElement('div');
    insightsDiv.innerHTML = `
        <h3>Key Insights:</h3>
        <ul>
            <li>Best performing book: ${bestBook.name} (Total PnL: ${bestBook.totalPnL.toFixed(2)}, Avg PnL: ${bestBook.avgPnL.toFixed(2)})</li>
            <li>Worst performing book: ${worstBook.name} (Total PnL: ${worstBook.totalPnL.toFixed(2)}, Avg PnL: ${worstBook.avgPnL.toFixed(2)})</li>
            <li>Most volatile book: ${mostVolatileBook.name} (Volatility: ${mostVolatileBook.volatility.toFixed(2)})</li>
        </ul>
        <p>The heatmap shows PnL performance for each book over time. Green cells indicate positive PnL, while red cells indicate negative PnL. The intensity of the color represents the magnitude of the PnL.</p>
    `;
    ctx.parentNode.insertBefore(insightsDiv, ctx.nextSibling);
}

function createMonthlyBookPnlChart(data) {
    const ctx = document.getElementById('monthlyBookPnlChart').getContext('2d');
    const months = Object.keys(data);
    const books = Object.keys(data[months[0]]);
    const datasets = books.map(book => ({
        label: book,
        data: months.map(month => data[month][book]),
        stack: 'Stack 0'
    }));

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: datasets
        },
        options: {
            responsive: true,
            title: {
                display: true,
                text: 'Monthly Performance by Book'
            },
            scales: {
                x: {
                    stacked: true,
                },
                y: {
                    stacked: true
                }
            }
        }
    });
}
function createBookPerformanceChart(data) {
    const ctx = document.getElementById('bookPerformanceChart');
    if (!ctx) {
        console.error('Canvas element not found for Book Performance Chart');
        return;
    }

    const dates = Object.keys(data);
    const books = Object.keys(data[dates[0]]);

    const bookPerformance = books.map(book => {
        const pnlValues = dates.map(date => data[date][book]);
        const totalPnL = pnlValues.reduce((sum, pnl) => sum + pnl, 0);
        const frequency = pnlValues.filter(pnl => pnl !== 0).length;
        const volatility = Math.sqrt(pnlValues.reduce((sum, pnl) => sum + pnl * pnl, 0) / pnlValues.length);

        return {
            x: frequency,
            y: totalPnL,
            r: Math.sqrt(volatility) * 3,
            label: book
        };
    });

    new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Book Performance',
                data: bookPerformance,
                backgroundColor: (context) => {
                    const value = context.raw.y;
                    return value >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)';
                },
                borderColor: (context) => {
                    const value = context.raw.y;
                    return value >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)';
                },
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            return `${context.raw.label}: PnL: $${context.raw.y.toFixed(2)}, Frequency: ${context.raw.x}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'Frequency'
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Total PnL'
                    }
                }
            }
        }
    });
}

function createPnLDistributionChart(data) {
    const ctx = document.getElementById('pnlDistributionChart');
    if (!ctx) {
        console.error('Canvas element not found for PnL Distribution Chart');
        return;
    }

    const dates = Object.keys(data);
    const books = Object.keys(data[dates[0]]);
    const pnlValues = dates.flatMap(date => 
        books.map(book => data[date][book])
    );

    const binSize = 1000; // Adjust this value based on your data range

    const bins = {};
    pnlValues.forEach(pnl => {
        const binIndex = Math.floor(pnl / binSize);
        bins[binIndex] = (bins[binIndex] || 0) + 1;
    });

    const chartData = Object.entries(bins).map(([bin, count]) => ({
        x: parseInt(bin) * binSize + binSize / 2,
        y: count
    })).sort((a, b) => a.x - b.x);

    new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: 'PnL Distribution',
                data: chartData,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: 'PnL'
                    }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Frequency'
                    }
                }
            }
        }
    });
}

function createTopPerformersChart(data) {
    const ctx = document.getElementById('topPerformersChart');
    if (!ctx) {
        console.error('Canvas element not found for Top Performers Chart');
        return;
    }

    const dates = Object.keys(data);
    const books = Object.keys(data[dates[0]]);

    const bookPerformance = books.map(book => ({
        book,
        totalPnL: dates.reduce((sum, date) => sum + data[date][book], 0)
    }));

    const sortedData = bookPerformance.sort((a, b) => b.totalPnL - a.totalPnL);
    const topBooks = sortedData.slice(0, 10); // Top 10 performers

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topBooks.map(book => book.book),
            datasets: [{
                label: 'Total PnL',
                data: topBooks.map(book => book.totalPnL),
                backgroundColor: topBooks.map(book => book.totalPnL >= 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)'),
                borderColor: topBooks.map(book => book.totalPnL >= 0 ? 'rgba(75, 192, 192, 1)' : 'rgba(255, 99, 132, 1)'),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Total PnL'
                    }
                }
            }
        }
    });
}

async function initCharts() {
    const data = await fetchPnLData();
    createCumulativePnlChart(data.cumulative_pnl);
    createDailySessionPnlChart(data.daily_session_pnl);
    // createPnlHeatmapChart(data.heatmap_data);
    createPnLHeatmap(data.heatmap_data);

    createMonthlyBookPnlChart(data.monthly_book_pnl);
    createBookPerformanceChart(data.book_stats);

    createPnLDistributionChart(data.book_stats);
    createTopPerformersChart(data.book_stats);
}

initCharts();