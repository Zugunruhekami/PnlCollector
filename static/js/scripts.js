// Global variables
let pnlData = [];
let showingPreviousEOD = false;
let message;
let loading;
let highlightInterval;
let selectedDate = new Date().toISOString().split('T')[0];
let charts = {
    cumulativePnl: null,
    dailySessionPnl: null,
    pnlHeatmap: null,
    bookPerformance: null,
    pnlDistributionScatter: null,
    pnlDistributionBar: null,
    topPerformers: null
};

// modifications to make terminal compatible
const pageType = (new URL(location.href)).searchParams.get('type');
const hide = (selector) => {
    document.querySelector(selector).style.display = 'none';
    document.querySelector(selector).classList.add('hidden')
}

if (pageType) {
    hide('.theme-toggle')
    hide('.fancy-link-container')

    if (pageType === 'form') {
        hide('.visualization-container')
        hide('filters')
        hide('.last-updated')
        hide('.container header h1')
    } else {
        hide ('.container')
    }
}


// Main initialization function
function initializePNLCollector() {
    const form = document.getElementById('pnlForm');
    message = document.getElementById('message');
    loading = document.getElementById('loading');
    const pnlTable = document.getElementById('pnlTable');

    if (typeof book_structure === 'undefined') {
        console.error('book_structure is not defined');
        return;
    }

    // Only initialize UI elements if we're on the main page
    if (form) {
        initializeUIElements();
    }

 
    const datePickerInput = document.getElementById('datePicker');
    const datePickerButton = document.getElementById('datePickerButton');

    // Set up date picker
    const picker = new Pikaday({
        field: datePickerInput,
        format: 'YYYY-MM-DD',
        onSelect: async function(date) {
            selectedDate = formatDate(date);
            datePickerInput.value = selectedDate;
            console.log("Selected date:", selectedDate);
            showingPreviousEOD = false; // Reset to current day view
            await fetchPnLData().then(data => {
                pnlData = data;
                renderPnLTable();
                applyFilters();
            });
            updateToggleButton();
        }
    });

    // Set initial date
    const initialDate = new Date();
    selectedDate = formatDate(initialDate);
    picker.setDate(initialDate);
    datePickerInput.value = selectedDate;
    console.log("Initial date:", selectedDate);  // Debug log

    // Open date picker when button is clicked
    datePickerButton.addEventListener('click', function(e) {
        e.preventDefault();
        picker.show();
    });

    // Fetch initial PNL data
    fetchPnLData().then(data => {
        pnlData = data;
        renderPnLTable();
        startSessionCheck();
        updateLastUpdated(data.last_updated);
    }).catch(error => {
        console.error('Error fetching PNL data:', error);
        showMessage('error', 'Failed to load PNL data. Please refresh the page.');
        initializeEmptyTable();
    });

    // Set up form submission
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }

    // Set up filters
    setupFilters();

    // Set up dark mode toggle
    setupDarkModeToggle();

    setUpEODToggle();
}



async function isUnusualPNL(pnl, book) {
    try {
        const response = await fetch(`/check_unusual_pnl?book=${encodeURIComponent(book)}&pnl=${pnl}`);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data.is_unusual;
    } catch (error) {
        console.error('Error checking unusual PNL:', error);
        // Fallback to client-side check if server request fails
        return Math.abs(pnl) > 1000000;
    }
}


function showExplanationField() {
    document.getElementById('explanationGroup').style.display = 'block';
}

function hideExplanationField() {
    document.getElementById('explanationGroup').style.display = 'none';
}

function showMessage(type, text) {
    if (message) {
        message.innerHTML = `<p class="${type}">${text}</p>`;
        message.classList.add('show');
        setTimeout(() => {
            message.classList.remove('show');
        }, 5000);
    } else {
        console.warn('Message element not found');
    }
}


function preprocessPnLData(data) {
    const processedData = {};
    for (const [book, sessions] of Object.entries(data)) {
        if (typeof sessions === 'object' && sessions !== null) {
            if ('EOD' in sessions) {
                processedData[book] = sessions;
            } else {
                processedData[book] = { EOD: sessions };
            }
        } else {
            processedData[book] = { EOD: sessions };
        }
    }
    return processedData;
}

async function renderPnLTable() {
    const data = await fetchPnLData();
    pnlData = data; // Store the entire data object
    const selectedData = data.daily_pnl[selectedDate] || {};
    console.log("Selected data:", selectedData);

    if (Object.keys(selectedData).length === 0) {
        console.log("No data for selected date, initializing empty table");
        initializeEmptyTable();
    } else {
        const tableHeader = document.querySelector('.table-header');
        if (tableHeader) {
            const eodHeaderCell = tableHeader.querySelector('.header-cell:last-child');
            if (eodHeaderCell) {
                eodHeaderCell.innerHTML = `EOD <span id="eodIndicator">(${selectedDate})</span>`;
            }
        }

        const bookHierarchy = createBookHierarchy(selectedData);
        const tableBody = document.getElementById('tableBody');

        if (!tableBody) {
            console.error('Table body element not found');
            return;
        }

        tableBody.innerHTML = '';

        // Add Global Total row
        const globalTotal = calculateGlobalTotal(bookHierarchy);
        const globalTotalRow = createGlobalTotalRow(globalTotal);
        tableBody.appendChild(globalTotalRow);

        // Define the desired order of top-level books
        const bookOrder = ['G10', 'EM', 'PM', 'Onshore', 'Management'];

        // Render books in the specified order
        for (const bookName of bookOrder) {
            if (bookHierarchy[bookName]) {
                await renderBookRow(bookHierarchy[bookName]);
            } else {
                console.warn(`Book "${bookName}" not found in hierarchy`);
            }
        }
    }

    addRowGroupToggle();
    highlightMissingInputs();
    applyFilters();
    addTooltips();
}

function updateEODData(previousDayEOD, todayData) {
    console.log("Updating EOD data");
    console.log("Previous day EOD:", previousDayEOD);
    console.log("Today's data:", todayData);

    const rows = document.querySelectorAll('.book-row');

    rows.forEach(row => {
        const level = parseInt(row.getAttribute('data-level') || '0');
        const book = row.getAttribute('data-book');

        if (!book && !row.classList.contains('global-total')) {
            console.warn('Book attribute is missing for row:', row);
            return;
        }

        const cells = row.querySelectorAll('.cell');
        const eodCell = cells[cells.length - 1];

        let previousEOD, todayEOD;

        if (row.classList.contains('global-total')) {
            // Handle Global Total row
            previousEOD = Object.values(previousDayEOD).reduce((sum, value) => sum + (value.EOD || 0), 0);
            todayEOD = Object.values(todayData).reduce((sum, value) => sum + (value.EOD || 0), 0);
        } else if (level === 0) {
            // Parent book
            previousEOD = Object.entries(previousDayEOD)
                .filter(([key]) => key.startsWith(book + '/'))
                .reduce((sum, [, value]) => sum + (value.EOD || 0), 0);
            todayEOD = Object.entries(todayData)
                .filter(([key]) => key.startsWith(book + '/'))
                .reduce((sum, [, value]) => sum + (value.EOD || 0), 0);
        } else {
            // Sub-book
            const fullBookName = book;
            previousEOD = previousDayEOD[fullBookName] && previousDayEOD[fullBookName].EOD !== undefined ? previousDayEOD[fullBookName].EOD : null;
            todayEOD = todayData[fullBookName] && todayData[fullBookName].EOD !== undefined ? todayData[fullBookName].EOD : null;
        }

        console.log(`Book: ${book || 'Global Total'}, Previous EOD: ${previousEOD}, Today's EOD: ${todayEOD}`);

        eodCell.setAttribute('data-previous-eod', previousEOD !== null ? previousEOD.toString() : '');
        eodCell.setAttribute('data-today-eod', todayEOD !== null ? todayEOD.toString() : '');

        updateEODCell(eodCell, previousEOD, todayEOD);
    });

    updateToggleButton();
}


async function updateEODCell(cell, previousEOD, todayEOD) {
    cell.classList.remove('positive', 'negative', 'missing', 'previous-eod', 'unusual-pnl', 'has-explanation');

    let valueToShow = showingPreviousEOD ? previousEOD : todayEOD;
    let explanation = cell.getAttribute('data-explanation') || '';

    if (valueToShow !== undefined && valueToShow !== null) {
        cell.textContent = formatLargeNumber(valueToShow);
        if (valueToShow > 0) {
            cell.classList.add('positive');
        } else if (valueToShow < 0) {
            cell.classList.add('negative');
        }

        if (showingPreviousEOD) {
            cell.classList.add('previous-eod');
        }

        const book = cell.closest('.book-row').getAttribute('data-book');
        const isUnusual = await isUnusualPNL(valueToShow, book);
        if (isUnusual) {
            cell.classList.add('unusual-pnl');
        }

        if (explanation) {
            cell.classList.add('has-explanation');
        }
    } else {
        cell.textContent = '-';
        cell.classList.add('missing');
    }

    // Update data attributes
    cell.setAttribute('data-pnl', valueToShow);
    cell.setAttribute('data-explanation', explanation);

    // Re-add tooltip
    if (explanation || cell.classList.contains('unusual-pnl')) {
        addTooltipToCell(cell);
    }
}

function updateToggleButton() {
    const toggleButton = document.getElementById('toggleEOD');
    if (!toggleButton) {
        console.error("Toggle button not found");
        return;
    }
    const buttonText = showingPreviousEOD ? 'Current EOD' : 'Previous EOD';
    const iconClass = showingPreviousEOD ? 'fa-forward' : 'fa-backward';
    toggleButton.innerHTML = `<i class="fas ${iconClass}"></i> <span>${buttonText}</span>`;
    toggleButton.classList.toggle('showing-previous', showingPreviousEOD);
}



function calculateGlobalTotal(bookHierarchy) {
    return ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(session => {
        return Object.values(bookHierarchy).reduce((total, book) => {
            return total + calculateSessionPnl(book, session);
        }, 0);
    });
}

function createGlobalTotalRow(globalTotal) {
    const row = document.createElement('div');
    row.className = 'table-row book-row global-total';
    row.innerHTML = `
        <div class="cell book-cell">Global Total</div>
        ${globalTotal.map(pnl => `
            <div class="cell ${pnl > 0 ? 'positive' : pnl < 0 ? 'negative' : ''}">
                ${formatLargeNumber(pnl)}
            </div>
        `).join('')}
    `;
    return row;
}


function renderBookRow(book, level = 0, parentName = '') {
    if (!book) {
        console.error('Attempted to render undefined book');
        return;
    }

    const tableBody = document.getElementById('tableBody');
    if (!tableBody) {
        console.error('Table body not found');
        return;
    }

    const row = document.createElement('div');
    row.className = 'table-row book-row';
    row.setAttribute('data-level', level);
    row.setAttribute('data-book', level === 0 ? book.name : `${parentName}/${book.name}`);

    const indentation = '&nbsp;'.repeat(level * 4);
    const displayName = level === 0 ? book.name : book.name.split('/').pop();

    // Render book cell immediately
    row.innerHTML = `<div class="cell book-cell">${indentation}${displayName}</div>`;
    tableBody.appendChild(row);

    // Render PNL cells asynchronously
    renderPnLCells(book, level).then(cellsHtml => {
        row.innerHTML += cellsHtml;
        addTooltips(row);
    });

    if (book.children) {
        Object.values(book.children).forEach(child =>
            renderBookRow(child, level + 1, book.name)
        );
    }
}


async function renderPnLCells(book, level) {
    const cells = await Promise.all(['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(async (session) => {
        const pnl = level === 0 ? calculateSessionPnl(book, session) : book.pnl[session];
        let cellClass = '';
        if (pnl !== null && pnl !== undefined) {
            const isUnusual = await isUnusualPNL(pnl, book.name);
            cellClass += isUnusual ? 'unusual-pnl ' : '';
            cellClass += pnl > 0 ? 'positive ' : pnl < 0 ? 'negative ' : '';
        } else {
            cellClass = 'missing ';
        }
        const explanation = level === 0 ? '' : (book.explanations[session] || '');
        if (explanation) {
            cellClass += 'has-explanation ';
        }
        return `<div class="cell ${cellClass.trim()}" data-explanation="${explanation}" data-pnl="${pnl}" data-session="${session}">${pnl !== null && pnl !== undefined ? formatLargeNumber(pnl) : '-'}</div>`;
    }));

    return cells.join('');
}

function addTooltips(element) {
    const applyTooltip = (cell) => {
        const level = parseInt(cell.closest('.book-row').getAttribute('data-level') || '0');
        const bookName = cell.closest('.book-row').getAttribute('data-book');
        const isTopLevelBook = ['G10', 'PM', 'EM', 'Onshore', 'Management'].includes(bookName);
        const explanation = cell.getAttribute('data-explanation');
        const isUnusual = cell.classList.contains('unusual-pnl');
        let content = '';

        if (level === 0 && isTopLevelBook) {
            content = 'Aggregated PNL for sub-books';
        } else if (level !== 0) {
            if (isUnusual) {
                content += '<strong>Unusual PNL detected!</strong><br>';
            }

            if (explanation) {
                content += `<strong>Explanation:</strong> ${explanation}`;
            } else if (isUnusual) {
                content += 'No explanation provided for this unusual PNL.';
            }
        }

        if (content) {
            if (cell._tippy) {
                cell._tippy.setContent(content);
            } else {
                tippy(cell, {
                    content: content,
                    arrow: true,
                    placement: 'top',
                    theme: level === 0 ? 'light-border' : 'light',
                    allowHTML: true,
                });
            }
        } else if (cell._tippy) {
            cell._tippy.destroy();
        }
    };

    if (element instanceof Element) {
        element.querySelectorAll('.cell[data-explanation], .cell.unusual-pnl').forEach(applyTooltip);
    } else {
        document.querySelectorAll('.book-row').forEach(row => {
            row.querySelectorAll('.cell[data-explanation], .cell.unusual-pnl').forEach(applyTooltip);
        });
    }
}

function addTooltipToCell(cell) {
    const explanation = cell.getAttribute('data-explanation');
    const pnl = cell.getAttribute('data-pnl');
    let content = '';

    if (cell.classList.contains('unusual-pnl')) {
        content += '<strong>Unusual PNL detected!</strong><br>';
    }

    if (explanation) {
        content += `<strong>Explanation:</strong> ${explanation}`;
    } else if (cell.classList.contains('unusual-pnl')) {
        content += 'No explanation provided for this unusual PNL.';
    }

    if (content) {
        tippy(cell, {
            content: content,
            arrow: true,
            placement: 'top',
            theme: 'light',
            allowHTML: true,
        });
    } else {
        // Remove tooltip if there's no content
        const tippyInstance = cell._tippy;
        if (tippyInstance) {
            tippyInstance.destroy();
        }
    }
}

function calculateSessionPnl(book, session) {
    if (!book) return null;
    if (book.children && Object.keys(book.children).length > 0) {
        return Object.values(book.children).reduce((total, child) => {
            const childPnl = calculateSessionPnl(child, session);
            return total + (childPnl !== null ? childPnl : 0);
        }, 0);
    } else {
        return book.pnl && book.pnl[session] !== undefined ? book.pnl[session] : null;
    }
}

async function updateTableWithNewData(formData) {
    const { book, session, pnl, explanation } = formData;
    const rows = document.querySelectorAll('.book-row');
    
    console.log('Updating table with new data:', formData);
    
    const sessionIndex = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].indexOf(session);
    
    if (sessionIndex === -1) {
        console.error('Invalid session:', session);
        return;
    }

    // Update the child book
    const childRow = Array.from(rows).find(row => row.getAttribute('data-book') === book);

    if (childRow) {
        console.log('Child row found:', childRow);
        const cells = childRow.querySelectorAll('.cell');
        if (cells.length > sessionIndex + 1) {
            const cell = cells[sessionIndex + 1];
            const oldPnl = parseLargeNumber(cell.textContent);
            const newPnl = parseFloat(pnl);
            const difference = newPnl - oldPnl;
            
            await updateCell(cell, newPnl, explanation);

            // Update parent books
            let currentRow = childRow;
            let updatedRows = [childRow];
            while (currentRow) {
                const parentRow = Array.from(rows).find(row => {
                    return row.getAttribute('data-book') === currentRow.getAttribute('data-book').split('/').slice(0, -1).join('/');
                });
                if (parentRow) {
                    await updateParentBook(parentRow, sessionIndex, difference);
                    currentRow = parentRow;
                    updatedRows.push(parentRow);
                } else {
                    break;
                }
            }

            await updateGlobalTotal();

            // Add tooltips and highlight all updated rows
            updatedRows.forEach(row => {
                addTooltips(row);
                const updatedCell = row.querySelectorAll('.cell')[sessionIndex + 1];
                updatedCell.classList.add('updated');
                setTimeout(() => {
                    updatedCell.classList.remove('updated');
                }, 2000);
            });
        } else {
            console.error('Not enough cells in the row:', childRow);
        }
    } else {
        console.error('Child row not found for book:', book);
    }
    
    highlightMissingInputs();
}

async function updateCell(cell, value, explanation = '') {
    if (cell.classList.contains('book-cell')) {
        console.error('Attempted to update book cell instead of PNL cell');
        return;
    }

    cell.textContent = formatLargeNumber(value);
    cell.classList.remove('missing', 'warning', 'positive', 'negative', 'unusual-pnl', 'has-explanation');
    cell.classList.add('updated');

    if (value > 0) {
        cell.classList.add('positive');
    } else if (value < 0) {
        cell.classList.add('negative');
    }

    // Check if the new PNL is unusual
    const book = cell.closest('.book-row').getAttribute('data-book');
    const isUnusual = await isUnusualPNL(value, book);

    if (isUnusual) {
        cell.classList.add('unusual-pnl');
    }

    if (explanation) {
        cell.setAttribute('data-explanation', explanation);
        cell.classList.add('has-explanation');
    } else {
        cell.removeAttribute('data-explanation');
    }

    cell.setAttribute('data-pnl', value);

    // Re-add tooltip
    addTooltipToCell(cell);

    // Highlight the cell
    cell.classList.add('highlight');
    setTimeout(() => {
        cell.classList.remove('highlight', 'updated');
    }, 2000);
}

async function updateParentBook(parentRow, sessionIndex, difference) {
    const cells = parentRow.querySelectorAll('.cell');
    if (cells.length > sessionIndex + 1) {
        const parentCell = cells[sessionIndex + 1];
        const parentPnl = parseLargeNumber(parentCell.textContent);
        const newParentPnl = parentPnl + difference;
        await updateCell(parentCell, newParentPnl);
    } else {
        console.error('Not enough cells in parent row:', parentRow);
    }
}

async function updateGlobalTotal() {
    const globalTotalRow = document.querySelector('.global-total');
    if (globalTotalRow) {
        const cells = globalTotalRow.querySelectorAll('.cell');
        for (let index = 0; index < 4; index++) { // ASIA, LONDON, NEW YORK, EOD
            let total = 0;
            document.querySelectorAll('.book-row[data-level="0"]').forEach(row => {
                const cell = row.querySelectorAll('.cell')[index + 1];
                const cellValue = parseLargeNumber(cell.textContent);
                total += cellValue;
            });
            await updateCell(cells[index + 1], total);
        }
    }
}

function formatLargeNumber(num) {
    if (typeof num === 'string') {
        num = parseLargeNumber(num);
    }
    if (isNaN(num)) return '0.00';
    if (Math.abs(num) >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    } else if (Math.abs(num) >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (Math.abs(num) >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toFixed(2);
}

function parseLargeNumber(str) {
    if (typeof str === 'number') return str;
    if (!str || str === '-') return 0;
    str = str.replace(/,/g, '');
    let multiplier = 1;
    if (str.endsWith('K')) {
        multiplier = 1e3;
        str = str.slice(0, -1);
    } else if (str.endsWith('M')) {
        multiplier = 1e6;
        str = str.slice(0, -1);
    } else if (str.endsWith('B')) {
        multiplier = 1e9;
        str = str.slice(0, -1);
    }
    return parseFloat(str) * multiplier;
}

function initializeEmptyTable() {
    if (typeof book_structure === 'undefined') {
        console.error('book_structure is not defined');
        return;
    }

    // Update the initializeEmptyTable function to include the EOD indicator:

    const tableHeader = document.querySelector('.table-header');
    if (tableHeader) {
        const eodHeaderCell = tableHeader.querySelector('.header-cell:last-child');
        if (eodHeaderCell) {
            eodHeaderCell.innerHTML = `EOD <span id="eodIndicator">(Today)</span>`;
        }
    }
    const tableBody = document.getElementById('tableBody');
    tableBody.innerHTML = '';

    function renderEmptyBookRow(bookName, level = 0) {
        const row = document.createElement('div');
        row.className = 'table-row book-row';
        row.setAttribute('data-level', level);
        row.setAttribute('data-book', bookName);

        const indentation = '&nbsp;'.repeat(level * 4);
        const displayName = level === 0 ? bookName : bookName.split('/').pop();
        row.innerHTML = `
            <div class="cell book-cell">${indentation}${displayName}</div>
            ${['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(() => `
                <div class="cell missing">-</div>
            `).join('')}
        `;

        tableBody.appendChild(row);
    }

    // Render empty rows for all books in the hierarchy
    function renderEmptyHierarchy(hierarchy, level = 0) {
        Object.entries(hierarchy).forEach(([bookName, subBooks]) => {
            renderEmptyBookRow(bookName, level);
            if (Array.isArray(subBooks)) {
                subBooks.forEach(subBook => {
                    renderEmptyBookRow(`${bookName}/${subBook}`, level + 1);
                });
            }
        });
    }

    renderEmptyHierarchy(book_structure);

    // Add Global Total row
    const globalTotalRow = document.createElement('div');
    globalTotalRow.className = 'table-row book-row global-total';
    globalTotalRow.innerHTML = `
        <div class="cell book-cell">Global Total</div>
        ${['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(() => `
            <div class="cell">0.00</div>
        `).join('')}
    `;
    tableBody.insertBefore(globalTotalRow, tableBody.firstChild);

    addRowGroupToggle();
    highlightMissingInputs();
}

function createBookHierarchy(data) {
    const hierarchy = {};
    Object.entries(data).forEach(([book, bookData]) => {
        const parts = book.split('/');
        let current = hierarchy;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = { name: part, children: {}, pnl: {}, explanations: {} };
            }
            if (index === parts.length - 1) {
                current[part].pnl = {
                    ASIA: bookData.ASIA || 0,
                    LONDON: bookData.LONDON || 0,
                    'NEW YORK': bookData['NEW YORK'] || 0,
                    EOD: bookData.EOD || 0
                };
                current[part].explanations = bookData.explanations || {};
            } else {
                current = current[part].children;
            }
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


function isWeekend(date) {
    const day = date.getUTCDay();
    return day === 0 || day === 6; // 0 is Sunday, 6 is Saturday
}

function highlightMissingInputs() {
    console.log("Starting highlightMissingInputs function");

    const now = new Date();
    console.log(`Current time: ${now.toUTCString()}`);

    const sessions = [
        { name: 'ASIA', start: 1, end: 9, lunchTime: 5 },  // 9:00 AM - 5:00 PM HKT, lunch at 1:00 PM
        { name: 'LONDON', start: 9, end: 17, lunchTime: 13 },  // 5:00 PM - 1:00 AM HKT, lunch at 9:00 PM
        { name: 'NEW YORK', start: 17, end: 1, lunchTime: 21 },  // 1:00 AM - 9:00 AM HKT, lunch at 5:00 AM
        { name: 'EOD', start: 23, end: 1 }  // 7:00 AM - 9:00 AM HKT
    ];

    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();
    console.log(`Current time (HKT): ${currentHour}:${currentMinute}`);

    let currentSessionIndex = sessions.findIndex(session =>
        (session.start < session.end && currentHour >= session.start && currentHour < session.end) ||
        (session.start > session.end && (currentHour >= session.start || currentHour < session.end))
    );

    if (currentSessionIndex === -1) currentSessionIndex = 0;  // Default to ASIA if no current session
    console.log(`Current session index: ${currentSessionIndex}, Session: ${sessions[currentSessionIndex].name}`);

    const parentBooks = ['PM', 'Onshore', 'G10', 'Management', 'EM'];

    document.querySelectorAll('.book-row').forEach(row => {
        const level = parseInt(row.getAttribute('data-level') || '0');
        const bookName = row.querySelector('.book-cell').textContent.trim();
        
        // console.log(`Processing row: ${bookName}, Level: ${level}`);

        if (parentBooks.includes(bookName)) {
            // console.log(`Skipping parent book: ${bookName}`);
            return;
        }

        const cells = row.querySelectorAll('.cell:not(.book-cell)');
        cells.forEach((cell, index) => {
            const session = sessions[index];
            // console.log(`  Checking cell for session: ${session.name}`);

            const sessionHasPassed = (index < currentSessionIndex) || 
                (index === currentSessionIndex && currentHour >= session.lunchTime);
            const isCurrentSession = index === currentSessionIndex;
            const isEOD = session.name === 'EOD';
            const isPastLunchTime = isCurrentSession && (currentHour > session.lunchTime || (currentHour === session.lunchTime && currentMinute > 0));
            
            const shouldHighlight = sessionHasPassed && !isEOD && 
                (cell.textContent.trim() === '-' || cell.classList.contains('missing'));

            // console.log(`    Session passed: ${sessionHasPassed}, Current session: ${isCurrentSession}, Past lunch time: ${isPastLunchTime}`);
            // console.log(`    Should highlight: ${shouldHighlight}`);

            if (shouldHighlight) {
                console.log(`    Highlighting cell for ${session.name}`);
                cell.classList.add('warning');
            } else {
                // console.log(`    Removing highlight for ${session.name}`);
                cell.classList.remove('warning');
            }
        });
    });

    console.log("Finished highlightMissingInputs function");
}


function startSessionCheck() {
    console.log("Starting session check");
    highlightMissingInputs(); // Call immediately on start
    
    // Clear any existing interval
    if (highlightInterval) {
        clearInterval(highlightInterval);
    }
    
    // Set up a new interval
    highlightInterval = setInterval(() => {
        console.log("Interval triggered");
        highlightMissingInputs();
    }, 300000); // Call every 5 minutes
}

function updateLastUpdated(timestamp) {
    const lastUpdatedElement = document.getElementById('lastUpdated');
    const date = new Date(timestamp);
    lastUpdatedElement.textContent = `Last Updated: ${date.toLocaleString()}`;
}


// Helper function to format date as YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Add this new function to handle date changes
async function handleDateChange(event) {
    selectedDate = formatDate(event.target.value);
    await fetchPnLData();
    renderPnLTable();
}

async function fetchPnLData() {
    const response = await fetch(`/get_pnl_data?date=${selectedDate}`);
    const data = await response.json();
    console.log("Fetched PNL data:", data);
    return data;
}

async function fetchPreviousDayEOD() {
    const response = await fetch(`/get_previous_day_eod?date=${selectedDate}`);
    const data = await response.json();
    console.log("Previous day EOD data from server:", data);
    return {
        data: preprocessPnLData(data.previous_day_eod),
        date: data.date
    };
}

function getPreviousWorkingDay(date) {
    const d = new Date(date);
    do {
        d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return formatDate(d);
}

async function toggleEODDisplay() {
    showingPreviousEOD = !showingPreviousEOD;
    await updateEODView();
    updateToggleButton();
}

async function updateEODView() {
    if (showingPreviousEOD) {
        const { data: previousDayEOD, date: previousDate } = await fetchPreviousDayEOD();
        updateEODData(previousDayEOD, pnlData.daily_pnl[selectedDate]);
        updateEODHeader(previousDate);
    } else {
        updateEODData(pnlData.daily_pnl[selectedDate], pnlData.daily_pnl[selectedDate]);
        updateEODHeader(selectedDate);
    }
}

function updateEODHeader(date) {
    const eodHeader = document.querySelector('.table-header .header-cell:last-child');
    if (eodHeader) {
        eodHeader.innerHTML = `EOD <span id="eodIndicator">(${date})</span>`;
    }
}

// Helper functions
function initializeUIElements() {
    createFloatingBackgroundElements();
    addPageTransitionEffect();
    checkPageTransition();
}

function createFloatingBackgroundElements() {
    const background = document.querySelector('.background');
    if (!background) {
        console.warn('Background element not found');
        return;
    }

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
}


function addPageTransitionEffect() {

    // Add page transition effect
    const fancyLinks = document.querySelectorAll('.fancy-link');
    fancyLinks.forEach(link => {
        link.addEventListener('click', function (e) {
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
}

function checkPageTransition() {

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
}

async function handleFormSubmit(e) {
    e.preventDefault();
    console.log('Form submit event triggered');

    const book = document.getElementById('book').value;
    const pnlInput = document.getElementById('pnl').value;
    const pnl = parsePNLInput(pnlInput);
    const session = document.getElementById('session').value;
    let explanation = document.getElementById('explanation').value;

    if (!book || book.trim() === '' || isNaN(pnl) || !session || session.trim() === '') {
        showMessage('error', 'Please fill in all required fields.');
        return;
    }

    const isUnusual = await isUnusualPNL(pnl, book);
    if (isUnusual && !explanation) {
        showMessage('warning', 'This PNL value is unusual. Please provide an explanation.');
        showExplanationField();
        return; // Stop here and don't submit the form
    }

    // Show loading spinner
    if (loading) {
        loading.style.display = 'flex';
    } else {
        console.warn('Loading element not found');
    }

    const formData = { book, pnl, session, explanation };

    console.log('Sending form data:', formData);

    try {
        const response = await fetch('/submit_pnl', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw errorData;
        }

        const data = await response.json();

        // Hide loading spinner
        if (loading) {
            loading.style.display = 'none';
        }

        console.log('Response received:', data);
        await handleSuccessfulSubmission(data, formData);
        e.target.reset();
        hideExplanationField();
    } catch (error) {
        // Hide loading spinner
        if (loading) {
            loading.style.display = 'none';
        }
        console.error('Error:', error);
        if (error.detail) {
            showMessage('error', error.detail);
            showExplanationField();
        } else {
            showMessage('error', `An error occurred: ${error.message}`);
        }
    }
}

function parsePNLInput(input) {
    input = input.trim().toLowerCase();
    if (input.endsWith('k')) {
        return parseFloat(input.slice(0, -1)) * 1000;
    }
    return parseFloat(input);
}

async function validateForm() {
    const book = document.getElementById('book').value;
    const pnl = parseFloat(document.getElementById('pnl').value);
    const session = document.getElementById('session').value;
    const explanation = document.getElementById('explanation').value;

    if (!book || book.trim() === '') {
        showMessage('error', 'Please select a book.');
        return false;
    }

    if (isNaN(pnl)) {
        showMessage('error', 'Please enter a valid number for PNL.');
        return false;
    }

    if (!session || session.trim() === '') {
        showMessage('error', 'Please select a session.');
        return false;
    }

    const unusual = await isUnusualPNL(pnl, book);
    if (unusual && !explanation) {
        showMessage('error', 'Please provide an explanation for this unusual PNL value.');
        showExplanationField();
        return false;
    }

    return true;
}

async function handleSuccessfulSubmission(data, formData) {
    showMessage('success', data.message);

    const book = formData.book;

    // Initialize pnlData if it doesn't exist
    if (!pnlData) {
        pnlData = {
            daily_pnl: {}
        };
    }

    // Initialize daily_pnl for the current date if it doesn't exist
    if (!pnlData.daily_pnl[selectedDate]) {
        pnlData.daily_pnl[selectedDate] = {};
    }

    // Ensure the book exists in pnlData
    if (!pnlData.daily_pnl[selectedDate][book]) {
        pnlData.daily_pnl[selectedDate][book] = {
            ASIA: 0,
            LONDON: 0,
            'NEW YORK': 0,
            EOD: 0,
            explanations: {}
        };
    }

    // Update the PNL for the book
    pnlData.daily_pnl[selectedDate][book][formData.session] = formData.pnl;

    // Add explanation if provided
    if (formData.explanation) {
        if (!pnlData.daily_pnl[selectedDate][book].explanations) {
            pnlData.daily_pnl[selectedDate][book].explanations = {};
        }
        pnlData.daily_pnl[selectedDate][book].explanations[formData.session] = formData.explanation;
    }

    // Update the table with new data
    await updateTableWithNewData(formData);

    updateLastUpdated(data.timestamp);
}


function setupFilters() {
    document.getElementById('bookFilter').addEventListener('change', applyFilters);
    document.getElementById('sessionFilter').addEventListener('change', applyFilters);
}

function setupDarkModeToggle() {
    const themeSwitch = document.getElementById('theme-switch');
    themeSwitch.addEventListener('change', () => {
        document.body.classList.toggle('dark-mode');
    });
}

function setUpEODToggle() {
    const toggleButton = document.getElementById('toggleEOD');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleEODDisplay);
        updateToggleButton(); // Initialize the button text
    } else {
        console.error("Toggle button not found in the DOM");
    }
}


function applyFilters() {
    const bookFilter = document.getElementById('bookFilter').value;
    const sessionFilter = document.getElementById('sessionFilter').value;

    const sessions = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'];
    const sessionIndex = sessions.indexOf(sessionFilter);

    document.querySelectorAll('.book-row').forEach(row => {
        const bookCell = row.querySelector('.book-cell');
        const bookName = bookCell.textContent.trim();
        const level = parseInt(row.getAttribute('data-level'));

        // Book filter logic
        let shouldShowBook = bookFilter === 'all';
        if (bookFilter !== 'all') {
            if (level === 0) {
                shouldShowBook = bookName === bookFilter;
            } else {
                let parent = row.previousElementSibling;
                while (parent && parseInt(parent.getAttribute('data-level')) > 0) {
                    parent = parent.previousElementSibling;
                }
                shouldShowBook = parent && parent.querySelector('.book-cell').textContent.trim() === bookFilter;
            }
        }

        // Session filter logic
        let shouldShowSession = sessionFilter === 'all';
        if (sessionFilter !== 'all') {
            const cells = row.querySelectorAll('.cell');
            shouldShowSession = cells[sessionIndex + 1].textContent.trim() !== '-';
        }

        // Apply visibility
        row.style.display = shouldShowBook && shouldShowSession ? '' : 'none';

        // Highlight selected session
        row.querySelectorAll('.cell').forEach((cell, index) => {
            if (index === 0) return; // Skip book cell
            cell.style.display = sessionFilter === 'all' || index === sessionIndex + 1 ? '' : 'none';
            if (sessionFilter !== 'all' && index === sessionIndex + 1) {
                cell.classList.add('highlight-session');
            } else {
                cell.classList.remove('highlight-session');
            }
        });
    });

    // Update header to show/hide columns based on session filter
    const headerCells = document.querySelectorAll('.table-header .header-cell');
    headerCells.forEach((cell, index) => {
        if (index === 0) return; // Skip book header
        cell.style.display = sessionFilter === 'all' || index === sessionIndex + 1 ? '' : 'none';
    });
}




// charts start here

let dailySessionChartType = 'line';
let aggregatedCumulativeData, aggregatedDailySessionData, originalCumulativeData, originalDailySessionData;

function getWeekStart(date) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().split('T')[0];
}

function aggregateData(data, aggregationType) {
    const aggregatedData = {};
    const dates = Object.keys(data).sort();

    dates.forEach(date => {
        const dateObj = new Date(date);
        let key;
        
        switch(aggregationType) {
            case 'week':
                key = getWeekStart(dateObj);
                break;
            case 'month':
                key = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1).toString().padStart(2, '0')}-01`;
                break;
            default: // 'day'
                key = date;
        }

        if (!aggregatedData[key]) {
            aggregatedData[key] = {...data[date]};
        } else {
            Object.keys(data[date]).forEach(subKey => {
                if (typeof data[date][subKey] === 'number') {
                    aggregatedData[key][subKey] = (aggregatedData[key][subKey] || 0) + data[date][subKey];
                }
            });
        }
    });

    return aggregatedData;
}

function createHistoricalCharts(cumulativeData, dailySessionData) {
    const chartIds = ['cumulativePnlChart', 'dailySessionPnlChart'];
    const dates = Object.keys(cumulativeData).sort();
    const books = Object.keys(cumulativeData[dates[0]] || {});
    const sessions = Object.keys(dailySessionData[dates[0]] || {});

    // Store the original data
    originalCumulativeData = cumulativeData;
    originalDailySessionData = dailySessionData;

    // Initialize aggregated data
    aggregatedCumulativeData = cumulativeData;
    aggregatedDailySessionData = dailySessionData;

    chartIds.forEach((chartId, index) => {
        if (!charts[chartId]) {
            const canvas = document.getElementById(chartId);
            const ctx = canvas.getContext('2d');
            
            charts[chartId] = new Chart(ctx, {
                type: index === 1 ? dailySessionChartType : 'line',
                data: { datasets: [] },
                options: getChartOptions(index === 0 ? 'Cumulative PnL Over Time' : 'Daily Session PnL Comparison')
            });
        }
    });

    updateHistoricalCharts(aggregatedCumulativeData, aggregatedDailySessionData);
    setupChartControls(dates);
}

function updateHistoricalCharts(cumulativeData, dailySessionData) {
    const dates = Object.keys(cumulativeData).sort();
    const books = Object.keys(cumulativeData[dates[0]] || {});
    const sessions = Object.keys(dailySessionData[dates[0]] || {});

    charts['cumulativePnlChart'].data.datasets = createDatasets(cumulativeData, books, false);
    charts['dailySessionPnlChart'].data.datasets = createDatasets(dailySessionData, sessions, true);
    charts['dailySessionPnlChart'].options.plugins.title.text = `Daily Session PnL Comparison (${dailySessionChartType.charAt(0).toUpperCase() + dailySessionChartType.slice(1)} Chart)`;

    charts['cumulativePnlChart'].update();
    charts['dailySessionPnlChart'].update();
}

function createDatasets(data, labels, isDaily = false) {
    console.log('Creating datasets. Chart type:', dailySessionChartType);
    return labels.map((label, index) => ({
        label,
        data: Object.entries(data).map(([date, values]) => ({ 
            x: new Date(date), 
            y: values[label] 
        })),
        fill: false,
        borderWidth: 1,
        pointRadius: dailySessionChartType === 'line' ? 0 : 3,
        pointHoverRadius: 5,
        backgroundColor: `hsla(${index * 60}, 70%, 60%, 0.6)`,
        borderColor: `hsl(${index * 60}, 70%, 60%)`,
        ...(dailySessionChartType === 'bar' && {
            barPercentage: 0.8,
            categoryPercentage: 0.9
        })
    }));
}

function getChartOptions(titleText) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                type: 'time',
                time: {
                    unit: 'day',
                    displayFormats: { day: 'MMM d, yyyy' }
                },
                title: { display: true, text: 'Date' }
            },
            y: { 
                title: { display: true, text: 'PnL' },
                stacked: false  // Ensure y-axis is not stacked for bar chart
            }
        },
        plugins: {
            zoom: {
                pan: { enabled: true, mode: 'x' },
                zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: 'x'
                }
            },
            legend: { display: true, position: 'top' },
            title: {
                display: true,
                text: titleText
            }
        }
    };
}

function setupChartControls(dates) {
    // Remove existing controls if any
    const existingControls = document.querySelector('#historical .chart-controls');
    if (existingControls) {
        existingControls.remove();
    }

    // Add controls for the charts
    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'chart-controls';
    controlsContainer.innerHTML = `
        <div class="control-group">
            <button id="resetZoom" title="Reset Zoom"><i class="fas fa-undo"></i></button>
            <select id="timeAggregation" title="Time Aggregation">
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
            </select>
        </div>
        <div class="control-group">
            <div class="date-picker-container">
                <input type="text" id="startDate" class="date-picker-input" readonly value="${dates[0]}" title="Start Date">
                <button id="startDatePicker" class="date-picker-button">
                    <i class="fas fa-calendar-alt"></i>
                </button>
            </div>
            <div class="date-picker-container">
                <input type="text" id="endDate" class="date-picker-input" readonly value="${dates[dates.length - 1]}" title="End Date">
                <button id="endDatePicker" class="date-picker-button">
                    <i class="fas fa-calendar-alt"></i>
                </button>
            </div>
        </div>
    `;
    document.querySelector('#historical').insertBefore(controlsContainer, document.querySelector('#historical .chart-row'));

    setupControlEventListeners();
}

function setupControlEventListeners() {
    // Existing event listeners
    document.getElementById('resetZoom').addEventListener('click', () => {
        Object.values(charts).forEach(chart => chart.resetZoom());
    });

    document.getElementById('timeAggregation').addEventListener('change', (e) => {
        const aggregationType = e.target.value;
        aggregatedCumulativeData = aggregateData(originalCumulativeData, aggregationType);
        aggregatedDailySessionData = aggregateData(originalDailySessionData, aggregationType);
        updateHistoricalCharts(aggregatedCumulativeData, aggregatedDailySessionData);
    });

    ['startDate', 'endDate'].forEach(id => {
        const input = document.getElementById(id);
        const picker = new Pikaday({
            field: input,
            format: 'YYYY-MM-DD',
            onSelect: function(date) {
                input.value = formatDate(date);
                applyDateRange();
            }
        });

        document.getElementById(`${id}Picker`).addEventListener('click', function(e) {
            e.preventDefault();
            picker.show();
        });

        // Store the picker instance
        input._picker = picker;
    });

    // Add toggle button functionality
    const toggleButton = document.getElementById('toggleDailySessionChartType');
    if (toggleButton) {
        toggleButton.addEventListener('click', () => {
            console.log('Toggle button clicked. Current type:', dailySessionChartType);
            
            dailySessionChartType = dailySessionChartType === 'line' ? 'bar' : 'line';
            console.log('New chart type:', dailySessionChartType);
            
            const chart = charts['dailySessionPnlChart'];
            if (!chart) {
                console.error('dailySessionPnlChart not found in charts object');
                return;
            }
            
            chart.config.type = dailySessionChartType;
            chart.options.plugins.title.text = `Daily Session PnL Comparison (${dailySessionChartType.charAt(0).toUpperCase() + dailySessionChartType.slice(1)} Chart)`;
            
            // Update the datasets
            chart.data.datasets = createDatasets(aggregatedDailySessionData, Object.keys(aggregatedDailySessionData[Object.keys(aggregatedDailySessionData)[0]] || {}), true);
            
            chart.update();
            
            console.log('Chart updated to:', dailySessionChartType);
        });
    }
}

function applyDateRange() {
    const startDate = new Date(document.getElementById('startDate').value);
    const endDate = new Date(document.getElementById('endDate').value);
    Object.values(charts).forEach(chart => {
        chart.options.scales.x.min = startDate;
        chart.options.scales.x.max = endDate;
        chart.update();
    });
}

function createPnlHeatmap(data) {
    const ctx = document.getElementById('pnlHeatmap').getContext('2d');
    const books = Object.keys(data);
    const sessions = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'];
    
    const heatmapData = books.flatMap((book, i) => 
        sessions.map((session, j) => ({
            x: j,
            y: i,
            v: data[book][session] || 0
        }))
    );

    const minValue = Math.min(...heatmapData.map(d => d.v));
    const maxValue = Math.max(...heatmapData.map(d => d.v));
    const absMax = Math.max(Math.abs(minValue), Math.abs(maxValue));
    const colorScale = chroma.scale(['#ff0000', '#ffffff', '#00ff00']).domain([-absMax, 0, absMax]);

    const chart = new Chart(ctx, {
        type: 'matrix',
        data: {
            datasets: [{
                label: 'PNL Heatmap',
                data: heatmapData,
                backgroundColor: (context) => colorScale(context.raw.v).alpha(0.7).css(),
                borderColor: '#ffffff',
                borderWidth: 1,
                width: ({ chart }) => (chart.chartArea || {}).width / sessions.length - 1,
                height: ({ chart }) => (chart.chartArea || {}).height / books.length - 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (context) => {
                            const d = context[0].raw;
                            return `${books[d.y]} - ${sessions[d.x]}`;
                        },
                        label: (context) => `PNL: ${context.raw.v.toFixed(2)}`,
                    }
                },
                title: {
                    display: true,
                    text: 'PNL Performance Heatmap',
                    font: { size: 18, weight: 'bold' },
                    padding: { top: 10, bottom: 30 }
                }
            },
            scales: {
                x: {
                    ticks: {
                        callback: (value) => sessions[value],
                        autoSkip: false,
                        maxRotation: 0,
                        font: { size: 10 }
                    },
                    title: {
                        display: true,
                        text: 'Sessions',
                        padding: { top: 20 }
                    }
                },
                y: {
                    ticks: {
                        callback: (value) => books[value],
                        autoSkip: false,
                        font: { size: 10 }
                    },
                    title: {
                        display: true,
                        text: 'Books'
                    },
                    reverse: true
                }
            },
            layout: {
                padding: {
                    left: 70,
                    right: 20,
                    top: 50,
                    bottom: 30
                }
            }
        }
    });

    // Create legend
    const legendContainer = document.getElementById('heatmapLegend');
    const gradientSteps = 7;
    const gradient = colorScale.colors(gradientSteps);
    let legendHTML = '<div style="display: flex; justify-content: center; align-items: center;">';
    gradient.forEach((color, index) => {
        const value = -absMax + (2 * absMax / (gradientSteps - 1)) * index;
        legendHTML += `<div style="background: ${color}; width: 40px; height: 20px; border: 1px solid #ffffff;"></div>`;
        if (index === 0 || index === gradient.length - 1 || index === Math.floor(gradient.length / 2)) {
            legendHTML += `<span style="margin: 0 5px; color: var(--text-color);">${value.toFixed(0)}</span>`;
        }
    });
    legendHTML += '</div>';
    legendContainer.innerHTML = legendHTML;

    return chart;
}



function standardDeviation(values) {
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
}

function createBookPerformanceChart(data) {
    const ctx = document.getElementById('bookPerformanceChart').getContext('2d');
    
    const bookPerformance = data.map(book => {
        const { book: bookName, total_pnl, frequency, volatility } = book;
        const avgPnl = total_pnl / frequency;
        // Calculate Sharpe ratio (assuming risk-free rate is 0)
        const sharpeRatio = volatility !== 0 ? avgPnl / volatility : 0;
        
        return {book: bookName, avgPnl, volatility, sharpeRatio, total_pnl};
    });

    const maxAvgPnl = Math.max(...bookPerformance.map(b => Math.abs(b.avgPnl)));
    const maxVolatility = Math.max(...bookPerformance.map(b => b.volatility));

    return new Chart(ctx, {
        type: 'bubble',
        data: {
            datasets: [{
                label: 'Book Performance',
                data: bookPerformance.map(b => ({
                    x: b.sharpeRatio,
                    y: b.avgPnl / maxAvgPnl,
                    r: (b.volatility / maxVolatility) * 20 + 5,
                    book: b.book,
                    avgPnl: b.avgPnl,
                    volatility: b.volatility,
                    total_pnl: b.total_pnl
                })),
                backgroundColor: bookPerformance.map(b => b.total_pnl > 0 ? 'rgba(75, 192, 192, 0.6)' : 'rgba(255, 99, 132, 0.6)')
            }]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Book Performance Overview'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => [
                            `Book: ${context.raw.book}`,
                            `Sharpe Ratio: ${context.raw.x.toFixed(2)}`,
                            `Avg PnL: ${context.raw.avgPnl.toFixed(2)}`,
                            `Volatility: ${context.raw.volatility.toFixed(2)}`,
                            `Total PnL: ${context.raw.total_pnl.toFixed(2)}`
                        ]
                    }
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Sharpe Ratio'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Average PnL (Normalized)'
                    },
                    ticks: {
                        callback: (value) => (value * maxAvgPnl).toFixed(0)
                    }
                }
            }
        }
    });
}

function createPnlDistributionScatterChart(data) {
    const ctx = document.getElementById('pnlDistributionScatterChart').getContext('2d');
    const books = Object.keys(data);
    const sessions = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'];

    const datasets = books.map((book, index) => {
        return {
            label: book,
            data: sessions.map((session, i) => ({ x: i, y: data[book][session] || 0 })),
            backgroundColor: `hsla(${index * 20}, 70%, 60%, 0.6)`,
            pointRadius: 5
        };
    });

    return new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: datasets
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'PnL Distribution by Book and Session'
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                x: {
                    type: 'category',
                    labels: sessions,
                    title: {
                        display: true,
                        text: 'Session'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'PnL'
                    }
                }
            }
        }
    });
}

function createPnlDistributionBarChart(data) {
    const ctx = document.getElementById('pnlDistributionBarChart').getContext('2d');
    const books = Object.keys(data);
    const sessions = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'];

    const datasets = sessions.map((session, index) => ({
        label: session,
        data: books.map(book => data[book][session] || 0),
        backgroundColor: `rgba(${index * 60}, ${255 - index * 60}, ${index * 60}, 0.6)`
    }));

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: books,
            datasets: datasets
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'PnL Distribution by Book and Session'
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Books'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'PnL'
                    }
                }
            }
        }
    });
}

function createTopPerformersChart(data, canvasId, title) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const books = data.map(item => item.book);
    const totalPnl = data.map(item => item.total_pnl);

    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: books,
            datasets: [{
                label: 'Total PnL',
                data: totalPnl,
                backgroundColor: 'rgba(75, 192, 192, 0.6)'
            }]
        },
        options: {
            responsive: true,
            indexAxis: 'y',
            plugins: {
                title: {
                    display: true,
                    text: title
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Total PnL'
                    }
                }
            }
        }
    });
}


function updateChart(chartId, createChartFunction, data) {
    const canvas = document.getElementById(chartId);
    if (!canvas) {
        console.error(`Canvas with id ${chartId} not found`);
        return;
    }

    // Special case for historical charts
    if (chartId === 'cumulativePnlChart' || chartId === 'dailySessionPnlChart') {
        return; // These charts are handled by createHistoricalCharts
    }

    // Destroy existing chart
    if (charts[chartId]) {
        charts[chartId].destroy();
        charts[chartId] = null;
    }

    // Ensure any lingering chart instance is destroyed
    Chart.getChart(canvas)?.destroy();

    // Clear the canvas
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Create new chart
    charts[chartId] = createChartFunction(data);

    // If it's the daily session chart, make sure the toggle button is visible
    if (chartId === 'dailySessionPnlChart') {
        const toggleButton = document.getElementById('toggleDailySessionChartType');
        if (toggleButton) {
            toggleButton.style.display = 'block';
        }
    }
}

function createVisualizations() {
    if (!isChartJsLoaded()) {
        console.error('Chart.js is not loaded. Visualizations cannot be created.');
        return;
    }

    fetch(`/get_pnl_data?date=${selectedDate}`)
        .then(response => response.json())
        .then(data => {
            // Update selected date display if the element exists
            const selectedDateDisplay = document.getElementById('selectedDateDisplay');
            if (selectedDateDisplay) {
                selectedDateDisplay.textContent = `(${selectedDate})`;
            }

            // Daily Analysis
            updateChart('dailyTopPerformersChart', (data) => createTopPerformersChart(data, 'dailyTopPerformersChart', 'Top 10 Performing Books (Selected Date)'), getTopPerformers(data.daily_pnl[selectedDate], 10));
            updateChart('pnlDistributionBarChart', createPnlDistributionBarChart, data.daily_pnl[selectedDate]);
            updateChart('pnlDistributionScatterChart', createPnlDistributionScatterChart, data.daily_pnl[selectedDate]);
            updateChart('pnlHeatmap', createPnlHeatmap, data.daily_pnl[selectedDate]);

            // Historical Analysis
            if (charts['cumulativePnlChart'] && charts['dailySessionPnlChart']) {
                updateHistoricalCharts(data.cumulative_pnl, data.daily_session_pnl);
            } else {
                createHistoricalCharts(data.cumulative_pnl, data.daily_session_pnl);
            }
            updateChart('bookPerformanceChart', createBookPerformanceChart, data.book_stats);
        })
        .catch(error => console.error('Error fetching PNL data:', error));
}

function getTopPerformers(dailyData, count) {
    const bookTotals = Object.entries(dailyData).map(([book, sessions]) => ({
        book,
        total_pnl: sessions.EOD || sessions['NEW YORK'] || sessions.LONDON || sessions.ASIA || 0
    }));
    return bookTotals.sort((a, b) => b.total_pnl - a.total_pnl).slice(0, count);
}

function initializeVisualizationDatePicker() {
    const datePickerInput = document.getElementById('datePicker');
    const datePickerButton = document.getElementById('datePickerButton');

    if (!datePickerInput || !datePickerButton) return;

    const picker = new Pikaday({
        field: datePickerInput,
        format: 'YYYY-MM-DD',
        onSelect: function(date) {
            selectedDate = formatDate(date);
            datePickerInput.value = selectedDate;
            console.log("Selected date:", selectedDate);
            createVisualizations();
        }
    });

    // Set initial date
    const initialDate = new Date();
    selectedDate = formatDate(initialDate);
    picker.setDate(initialDate);
    datePickerInput.value = selectedDate;

    // Open date picker when button is clicked
    datePickerButton.addEventListener('click', function(e) {
        e.preventDefault();
        picker.show();
    });
}

function initializeNavigation() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            
            // Hide all tab contents and deactivate all buttons
            tabContents.forEach(content => {
                content.style.display = 'none';
            });
            tabButtons.forEach(btn => {
                btn.classList.remove('active');
            });

            // Show the selected tab content and activate the button
            document.getElementById(tabName).style.display = 'block';
            this.classList.add('active');

            // Trigger a resize event to make sure charts render correctly
            window.dispatchEvent(new Event('resize'));
        });
    });

    // Show Overview tab by default
    document.getElementById('overview').style.display = 'block';
    document.querySelector('[data-tab="overview"]').classList.add('active');
}

function isChartJsLoaded() {
    return typeof Chart !== 'undefined';
}

function initializeVisualization() {
    if (!isChartJsLoaded()) {
        console.error('Chart.js is not loaded. Visualizations will not be initialized.');
        return;
    }

    // Clear any existing charts
    Object.values(charts).forEach(chart => {
        if (chart) {
            chart.destroy();
        }
    });
    charts = {};

    // Register the matrix controller
    Chart.register(Chart.controllers.matrix);

    initializeVisualizationDatePicker();
    createFloatingBackgroundElements();
    createVisualizations();
    initializeNavigation();
}

document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('pnlForm')) {
        initializePNLCollector();
        if (pageType === 'view') {
            setInterval(() => {
                console.log('!!!re-render PNL Table !!!')
                initializePNLCollector();
            }, 60000)
        }
    } else {
        initializeVisualization();
    }
});