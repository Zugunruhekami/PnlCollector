// Global variables
let pnlData = [];
let showingPreviousEOD = false;
let message;
let loading;

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

    // Initialize UI elements
    initializeUIElements();

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
    const todayData = preprocessPnLData(pnlData.todays_pnl);
    console.log("Today's data:", todayData);

    if (Object.keys(todayData).length === 0) {
        console.log("No data for today, initializing empty table");
        initializeEmptyTable();
    } else {

        // Modify the renderPnLTable function to include the EOD indicator in the header:

        const tableHeader = document.querySelector('.table-header');
        if (tableHeader) {
            const eodHeaderCell = tableHeader.querySelector('.header-cell:last-child');
            if (eodHeaderCell) {
                eodHeaderCell.innerHTML = `EOD <span id="eodIndicator">(Today)</span>`;
            }
        }

        const bookHierarchy = createBookHierarchy(todayData);
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
        const bookOrder = ['G10', 'EM', 'PM', 'Onshore', 'Inventory'];

        // Render books in the specified order
        const renderPromises = bookOrder.map(bookName => {
            if (bookHierarchy[bookName]) {
                return renderBookRow(bookHierarchy[bookName]);
            } else {
                console.warn(`Book "${bookName}" not found in hierarchy`);
                return Promise.resolve();
            }
        });

        // Wait for all book rows to be rendered
        await Promise.all(renderPromises);

        // Fetch and display previous day's EOD data
        console.log("Fetching previous day EOD data");
        const previousDayEOD = await fetchPreviousDayEOD();
        console.log("Previous day EOD data:", previousDayEOD);
        updateEODData(previousDayEOD, todayData);
    }

    addRowGroupToggle();
    highlightMissingInputs();
    applyFilters();
    addTooltips();  // Add this back if you want to add all tooltips at once
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
    toggleButton.textContent = showingPreviousEOD ? 'Show Today\'s EOD' : 'Show Previous Day EOD';
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
        const isTopLevelBook = ['G10', 'PM', 'EM', 'Onshore', 'Inventory'].includes(bookName);
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
    const childRow = Array.from(rows).find(row => {
        const rowBook = row.getAttribute('data-book');
        return rowBook === book;
    });

    if (childRow) {
        console.log('Child row found:', childRow);
        const cell = childRow.querySelectorAll('.cell')[sessionIndex + 1];
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

        // Add tooltips to all updated rows
        updatedRows.forEach(row => addTooltips(row));
    } else {
        console.error('Child row not found for book:', book);
        console.log('Available rows:', Array.from(rows).map(row => ({
            book: row.getAttribute('data-book'),
            level: row.getAttribute('data-level')
        })));
    }
    
    highlightMissingInputs();
}

async function updateCell(cell, value, explanation = '') {
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
    addTooltips(cell.closest('.book-row'));

    setTimeout(() => {
        cell.classList.remove('updated');
    }, 2000);
}

async function updateParentBook(parentRow, sessionIndex, difference) {
    const parentCell = parentRow.querySelectorAll('.cell')[sessionIndex + 1];
    const parentPnl = parseLargeNumber(parentCell.textContent);
    const newParentPnl = parentPnl + difference;
    await updateCell(parentCell, newParentPnl);
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
                    ASIA: bookData.ASIA,
                    LONDON: bookData.LONDON,
                    'NEW YORK': bookData['NEW YORK'],
                    EOD: bookData.EOD
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



function highlightMissingInputs() {
    const now = new Date();
    const sessions = [
        { name: 'ASIA', start: 4, end: 10 },
        { name: 'LONDON', start: 10, end: 16 },
        { name: 'NEW YORK', start: 16, end: 22 },
        { name: 'EOD', start: 22, end: 4 }
    ];

    const currentHour = now.getUTCHours();
    let currentSessionIndex = sessions.findIndex(session =>
        (session.start < session.end && currentHour >= session.start && currentHour < session.end) ||
        (session.start > session.end && (currentHour >= session.start || currentHour < session.end))
    );

    if (currentSessionIndex === -1) currentSessionIndex = 0; // Default to ASIA if no current session

    document.querySelectorAll('.book-row').forEach(row => {
        if (row.getAttribute('data-level') === '0') return; // Skip parent book rows
        const cells = row.querySelectorAll('.cell:not(.book-cell)');
        cells.forEach((cell, index) => {
            if (index <= currentSessionIndex) {
                if (cell.textContent.trim() === '-' || cell.classList.contains('missing')) {
                    cell.classList.add('warning');
                } else {
                    cell.classList.remove('warning');
                }
            } else {
                cell.classList.remove('warning');
            }
        });
    });
}

function startSessionCheck() {
    setInterval(highlightMissingInputs, 60000); // Check every minute
}

function updateLastUpdated(timestamp) {
    const lastUpdatedElement = document.getElementById('lastUpdated');
    const date = new Date(timestamp);
    lastUpdatedElement.textContent = `Last Updated: ${date.toLocaleString()}`;
}




async function fetchPnLData() {
    const response = await fetch('/get_pnl_data');
    return await response.json();
}

async function fetchPreviousDayEOD() {
    const response = await fetch('/get_previous_day_eod');
    const data = await response.json();
    console.log("Previous day EOD data from server:", data);
    return preprocessPnLData(data.previous_day_eod);
}

function toggleEODDisplay() {
    console.log("Toggling EOD display");
    showingPreviousEOD = !showingPreviousEOD;
    const eodCells = document.querySelectorAll('.book-row .cell:last-child');
    const eodHeader = document.querySelector('.table-header .header-cell:last-child');

    eodCells.forEach(cell => {
        const previousEOD = parseFloat(cell.getAttribute('data-previous-eod'));
        const todayEOD = parseFloat(cell.getAttribute('data-today-eod'));

        console.log(`Cell - Previous EOD: ${previousEOD}, Today's EOD: ${todayEOD}`);

        updateEODCell(cell, previousEOD, todayEOD);
    });

    // Update the EOD header
    if (eodHeader) {
        eodHeader.innerHTML = `EOD <span id="eodIndicator">${showingPreviousEOD ? '(T-1)' : '(Today)'}</span>`;
    }

    updateToggleButton();
}

// Helper functions
function initializeUIElements() {
    createFloatingBackgroundElements();
    addPageTransitionEffect();
    checkPageTransition();
}

function createFloatingBackgroundElements() {

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

    if (!(await validateForm())) {
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
        session: document.getElementById('session').value,
        explanation: document.getElementById('explanation').value
    };

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

    // Ensure the book exists in pnlData
    if (!pnlData.todays_pnl[book]) {
        pnlData.todays_pnl[book] = {
            ASIA: 0,
            LONDON: 0,
            'NEW YORK': 0,
            EOD: 0,
            explanations: {}
        };
    }

    // Update the PNL for the book
    pnlData.todays_pnl[book][formData.session] = formData.pnl;

    // Add explanation if provided
    if (formData.explanation) {
        if (!pnlData.todays_pnl[book].explanations) {
            pnlData.todays_pnl[book].explanations = {};
        }
        pnlData.todays_pnl[book].explanations[formData.session] = formData.explanation;
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



document.addEventListener('DOMContentLoaded', initializePNLCollector);



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
                        callback: function (value, index, values) {
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