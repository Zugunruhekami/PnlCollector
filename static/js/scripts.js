// Global variables
let pnlData = [];
let showingPreviousEOD = true;
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
        bookOrder.forEach(bookName => {
            if (bookHierarchy[bookName]) {
                renderBookRow(bookHierarchy[bookName]);
            } else {
                console.warn(`Book "${bookName}" not found in hierarchy`);
            }
        });

        // Fetch and display previous day's EOD data
        console.log("Fetching previous day EOD data");
        const previousDayEOD = await fetchPreviousDayEOD();
        console.log("Previous day EOD data:", previousDayEOD);
        updateEODData(previousDayEOD, todayData);
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
        
        if (!book) {
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

        console.log(`Book: ${book}, Previous EOD: ${previousEOD}, Today's EOD: ${todayEOD}`);

        eodCell.setAttribute('data-previous-eod', previousEOD !== null ? previousEOD.toString() : '');
        eodCell.setAttribute('data-today-eod', todayEOD !== null ? todayEOD.toString() : '');

        updateEODCell(eodCell, previousEOD, todayEOD);
    });

    updateToggleButton();
}


function updateEODCell(cell, previousEOD, todayEOD) {
    if (showingPreviousEOD) {
        if (previousEOD !== undefined && previousEOD !== null) {
            cell.textContent = formatLargeNumber(previousEOD);
            cell.classList.add('previous-eod');
        } else {
            cell.textContent = '-';
            cell.classList.remove('previous-eod');
        }
    } else {
        if (todayEOD !== null && todayEOD !== undefined) {
            cell.textContent = formatLargeNumber(todayEOD);
            cell.classList.remove('previous-eod');
        } else {
            cell.textContent = '-';
            cell.classList.remove('previous-eod');
        }
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
    row.innerHTML = `
        <div class="cell book-cell">${indentation}${displayName}</div>
        ${renderPnLCells(book)}
    `;

    tableBody.appendChild(row);
    if (book.children) {
        Object.values(book.children).forEach(child => 
            renderBookRow(child, level + 1, book.name)
        );
    }
}

function renderPnLCells(book) {
    return ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].map(session => {
        const pnl = calculateSessionPnl(book, session);
        let cellClass = '';
        if (pnl !== null) {
            cellClass += Math.abs(pnl) > getStandardDeviation(book) ? 'highlight ' : '';
            cellClass += pnl > 0 ? 'positive ' : pnl < 0 ? 'negative ' : '';
        } else {
            cellClass = 'missing ';
        }
        const explanation = book.explanations && book.explanations[session] ? book.explanations[session] : '';
        if (explanation) {
            cellClass += 'has-explanation ';
        }
        return `<div class="cell ${cellClass.trim()}" data-explanation="${explanation}">${pnl !== null ? formatLargeNumber(pnl) : '-'}</div>`;
    }).join('');
}

function addTooltips() {
    document.querySelectorAll('.cell[data-explanation]').forEach(cell => {
        const explanation = cell.getAttribute('data-explanation');
        if (explanation) {
            cell.classList.add('has-explanation');
            tippy(cell, {
                content: explanation,
                arrow: true,
                placement: 'top',
                theme: 'light',
                allowHTML: true,
            });
        }
    });
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

function updateTableWithNewData(formData) {
    const { book, session, pnl, explanation } = formData;
    const bookParts = book.split('/');
    const rows = document.querySelectorAll('.book-row');
    
    const sessionIndex = ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].indexOf(session);
    
    if (sessionIndex === -1) {
        console.error('Invalid session:', session);
        return;
    }

    // Update the child book
    const childRow = Array.from(rows).find(row => {
        const rowBook = row.getAttribute('data-book');
        return rowBook === bookParts[bookParts.length - 1] && 
                parseInt(row.getAttribute('data-level')) === bookParts.length - 1;
    });

    if (childRow) {
        const cell = childRow.querySelectorAll('.cell')[sessionIndex + 1];
        const oldPnl = parseLargeNumber(cell.textContent);
        const newPnl = parseFloat(pnl);
        const difference = newPnl - oldPnl;
        
        updateCell(cell, newPnl, explanation);

        // Update parent book
        const parentRow = Array.from(rows).find(row => {
            return row.getAttribute('data-book') === bookParts[0] && 
                    parseInt(row.getAttribute('data-level')) === 0;
        });

        if (parentRow) {
            updateParentBook(parentRow, sessionIndex, difference);
        } else {
            console.error('Parent row not found for book:', bookParts[0]);
        }

        updateGlobalTotal();
    } else {
        console.error('Child row not found for book:', bookParts[bookParts.length - 1]);
    }
    
    highlightMissingInputs();
    addTooltips();
}

function updateCell(cell, value, explanation = '') {
    cell.textContent = formatLargeNumber(value);
    cell.classList.remove('missing', 'warning', 'positive', 'negative');
    cell.classList.add('updated');
    
    if (value > 0) {
        cell.classList.add('positive');
    } else if (value < 0) {
        cell.classList.add('negative');
    }
    
    if (explanation) {
        cell.setAttribute('data-explanation', explanation);
        cell.classList.add('has-explanation');
    }
    
    setTimeout(() => {
        cell.classList.remove('updated');
    }, 2000);
}

function updateParentBook(parentRow, sessionIndex, difference) {
    const parentCell = parentRow.querySelectorAll('.cell')[sessionIndex + 1];
    const parentPnl = parseLargeNumber(parentCell.textContent);
    const newParentPnl = parentPnl + difference;
    updateCell(parentCell, newParentPnl);
}

function updateGlobalTotal() {
    const globalTotalRow = document.querySelector('.global-total');
    if (globalTotalRow) {
        const cells = globalTotalRow.querySelectorAll('.cell');
        ['ASIA', 'LONDON', 'NEW YORK', 'EOD'].forEach((session, index) => {
            let total = 0;
            document.querySelectorAll('.book-row[data-level="0"]').forEach(row => {
                const cell = row.querySelectorAll('.cell')[index + 1];
                const cellValue = parseLargeNumber(cell.textContent);
                total += cellValue;
            });
            updateCell(cells[index + 1], total);
        });
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
    Object.entries(data).forEach(([book, pnlData]) => {
        const parts = book.split('/');
        let current = hierarchy;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = { name: part, children: {}, pnl: {} };
            }
            if (index === parts.length - 1) {
                current[part].pnl = pnlData;
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
    const eodCells = document.querySelectorAll('.book-row:not(.global-total) .cell:last-child');

    eodCells.forEach(cell => {
        const previousEOD = cell.getAttribute('data-previous-eod');
        const todayEOD = cell.getAttribute('data-today-eod');

        console.log(`Cell - Previous EOD: ${previousEOD}, Today's EOD: ${todayEOD}`);

        if (showingPreviousEOD) {
            if (previousEOD && previousEOD !== '') {
                cell.textContent = formatLargeNumber(parseFloat(previousEOD));
                cell.classList.add('previous-eod');
            } else {
                cell.textContent = '-';
                cell.classList.remove('previous-eod');
            }
        } else {
            if (todayEOD && todayEOD !== '') {
                cell.textContent = formatLargeNumber(parseFloat(todayEOD));
                cell.classList.remove('previous-eod');
            } else {
                cell.textContent = '-';
                cell.classList.remove('previous-eod');
            }
        }
    });

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
        handleSuccessfulSubmission(data, formData);
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

function handleSuccessfulSubmission(data, formData) {
    showMessage('success', data.message);
    
    const bookParts = formData.book.split('/');
    const parentBook = bookParts[0];
    const childBook = bookParts[bookParts.length - 1];

    // Ensure the parent book exists in pnlData
    if (!pnlData.todays_pnl[parentBook]) {
        pnlData.todays_pnl[parentBook] = {};
    }

    // Ensure the child book exists under the parent
    if (!pnlData.todays_pnl[parentBook][childBook]) {
        pnlData.todays_pnl[parentBook][childBook] = {};
    }

    // Update the PNL for the child book
    pnlData.todays_pnl[parentBook][childBook][formData.session] = formData.pnl;
    
    // Add explanation if provided
    if (formData.explanation) {
        if (!pnlData.todays_pnl[parentBook][childBook].explanations) {
            pnlData.todays_pnl[parentBook][childBook].explanations = {};
        }
        pnlData.todays_pnl[parentBook][childBook].explanations[formData.session] = formData.explanation;
    }
    
    // Update the table with new data
    updateTableWithNewData(formData);
    
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

function setUpEODToggle () {
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