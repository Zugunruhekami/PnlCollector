from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import csv
from datetime import datetime, timedelta
import pandas as pd
import os
import json
from fastapi.templating import Jinja2Templates
import math

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Templates
templates = Jinja2Templates(directory="templates")

CSV_FILE = 'simulated_pnl_data.csv'

# Ensure CSV file exists with headers
def init_csv():
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, 'w', newline='') as file:
            writer = csv.writer(file)
            writer.writerow(['timestamp', 'book', 'pnl', 'session'])

# init_csv()

# Book structure
book_structure = {
    "EM": {
        "ASEAN",
        "Greater China",
        "EMEA",
        "LATAM"
    },
    "G10": {
        "Eur Block",
        "G10 Pacific & CAD",
        "Special Exotics",
        "eRisk"
    },
    "PM": {
        "Metals",
        "EFP"
    },
    "Onshore": {
        "China Onshore",
        "India Onshore",
        "Malaysia Onshore"
    },
    "Management": {
        "Desk Inventory",
        "Operational Books"
    }
}


# Helper function to get all books
def get_all_books():
    books = []
    for top_level, sub_levels in book_structure.items():
        books.extend([f"{top_level}/{sub_level}" for sub_level in sub_levels])
    return books

# Pydantic model for PNL data
class PNLData(BaseModel):
    book: str
    pnl: float
    session: str
    explanation: Optional[str] = None

def convert_sets_to_lists(obj):
    if isinstance(obj, set):
        return list(obj)
    elif isinstance(obj, dict):
        return {k: convert_sets_to_lists(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_sets_to_lists(v) for v in obj]
    else:
        return obj

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    serializable_book_structure = convert_sets_to_lists(book_structure)
    return templates.TemplateResponse("index.html", {
        "request": request, 
        "books": get_all_books(),
        "book_structure": book_structure,  # Original structure for server-side rendering
        "book_structure_json": json.dumps(serializable_book_structure)  # JSON for client-side use
    })


@app.post("/submit_pnl")
async def submit_pnl(pnl_data: PNLData):
    if is_unusual_pnl(pnl_data.book, pnl_data.pnl):
        if not pnl_data.explanation:
            raise HTTPException(status_code=400, detail="PNL value seems unusual. Please provide an explanation.")
    
    current_time = datetime.now()
    formatted_datetime = current_time.strftime('%Y-%m-%d %H:%M:%S')

    df = pd.read_csv(CSV_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Filter out the old entry for the same book and session on the same day
    same_day = df['timestamp'].dt.date == current_time.date()
    same_book_session = (df['book'] == pnl_data.book) & (df['session'] == pnl_data.session)
    df = df[~(same_day & same_book_session)]

    # Append the new entry
    new_row = pd.DataFrame({
        'timestamp': [formatted_datetime],
        'book': [pnl_data.book],
        'pnl': [pnl_data.pnl],
        'session': [pnl_data.session],
        'explanation': [pnl_data.explanation]
    })
    df = pd.concat([df, new_row], ignore_index=True)

    # Save the updated DataFrame back to CSV
    df.to_csv(CSV_FILE, index=False)
    
    return {"message": "PNL submitted successfully", "timestamp": formatted_datetime}

@app.get("/check_unusual_pnl")
async def check_unusual_pnl(book: str, pnl: float):
    is_unusual = is_unusual_pnl(book, pnl)
    return {"is_unusual": bool(is_unusual)}  # Convert numpy.bool_ to Python bool


@app.get("/visualization", response_class=HTMLResponse)
async def visualization(request: Request):
    serializable_book_structure = convert_sets_to_lists(book_structure)
    return templates.TemplateResponse("visualization.html", {
        "request": request,
        "book_structure_json": json.dumps(serializable_book_structure)
    })

@app.get("/get_pnl_data")
async def get_pnl_data(date: str = None):
    df = pd.read_csv(CSV_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['date'] = df['timestamp'].dt.date

    if date:
        selected_date = pd.to_datetime(date).date()
    else:
        selected_date = datetime.now().date()

    # Filter data for the selected date and get the latest entry for each book and session
    selected_df = df[df['date'] == selected_date].sort_values('timestamp')
    selected_df = selected_df.groupby(['book', 'session']).last().reset_index()

    # Create PNL data for the selected date
    pnl_dict = {}
    for book in get_all_books():  # Use the get_all_books function to get all possible books
        pnl_dict[book] = {'ASIA': 0, 'LONDON': 0, 'NEW YORK': 0, 'EOD': 0, 'explanations': {}}
    
    for _, row in selected_df.iterrows():
        pnl_dict[row['book']][row['session']] = row['pnl']
        if pd.notna(row['explanation']):
            pnl_dict[row['book']]['explanations'][row['session']] = row['explanation']

    # Function to get the last available PNL value for each day
    def get_last_available_pnl(group):
        for session in ['EOD', 'NEW YORK', 'LONDON', 'ASIA']:
            if session in group['session'].values:
                return group[group['session'] == session]['pnl'].iloc[0]
        return np.nan

    # Calculate cumulative PNL (using EOD or last available session)
    daily_last_pnl = df.sort_values('timestamp').groupby(['date', 'book']).apply(get_last_available_pnl).reset_index(name='pnl')
    
    # Create cumulative_pnl_dict
    cumulative_pnl_dict = {}
    for date, group in daily_last_pnl.groupby('date'):
        date_str = str(date)
        cumulative_pnl_dict[date_str] = {}
        for _, row in group.iterrows():
            book = row['book']
            pnl = row['pnl']
            if date_str not in cumulative_pnl_dict:
                cumulative_pnl_dict[date_str] = {}
            if book not in cumulative_pnl_dict[date_str]:
                cumulative_pnl_dict[date_str][book] = 0
            cumulative_pnl_dict[date_str][book] += float(pnl)

    # Calculate cumulative sum
    for book in get_all_books():
        cumulative_sum = 0
        for date in sorted(cumulative_pnl_dict.keys()):
            if book in cumulative_pnl_dict[date]:
                cumulative_sum += cumulative_pnl_dict[date][book]
                cumulative_pnl_dict[date][book] = cumulative_sum

    # Get daily session PNL (latest observation for each session)
    daily_session_pnl = df.sort_values('timestamp').groupby(['date', 'session']).last()['pnl'].unstack()
    daily_session_pnl_dict = {
        str(date): {session: float(pnl) if pd.notna(pnl) else 0 for session, pnl in row.items()}
        for date, row in daily_session_pnl.iterrows()
    }

    last_updated = df['timestamp'].max()

    # Calculate book performance statistics (using EOD or last available session)
    book_stats = daily_last_pnl.groupby('book').agg({
        'pnl': ['sum', 'count', 'std']
    }).reset_index()
    book_stats.columns = ['book', 'total_pnl', 'frequency', 'volatility']
    book_stats_dict = book_stats.to_dict(orient='records')

    # Calculate top performers (using EOD or last available session)
    top_performers = book_stats.sort_values('total_pnl', ascending=False).head(10)
    top_performers_dict = top_performers.to_dict(orient='records')

    response_data = {
        "daily_pnl": {str(selected_date): pnl_dict},
        "cumulative_pnl": cumulative_pnl_dict,
        "daily_session_pnl": daily_session_pnl_dict,
        "last_updated": last_updated.isoformat() if pd.notna(last_updated) else None,
        "book_stats": book_stats_dict,
        "top_performers": top_performers_dict
    }

    return JSONResponse(content=response_data)

@app.get("/get_previous_day_eod")
async def get_previous_day_eod(date: str = None):
    df = pd.read_csv(CSV_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['date'] = df['timestamp'].dt.date

    if date:
        selected_date = pd.to_datetime(date).date()
    else:
        selected_date = datetime.now().date()

    # Find the most recent previous day with data
    previous_day = selected_date - timedelta(days=1)
    while previous_day not in df['date'].unique() or previous_day.weekday() >= 5:
        previous_day -= timedelta(days=1)

    # Filter previous day's data and get the latest entry for each book
    previous_day_df = df[(df['date'] == previous_day) & (df['session'] == 'EOD')].sort_values('timestamp')
    previous_day_df = previous_day_df.groupby('book').last().reset_index()

    # Create previous day's EOD data
    previous_day_eod_dict = {}
    for _, row in previous_day_df.iterrows():
        previous_day_eod_dict[row['book']] = {
            'EOD': row['pnl'],
            'explanations': {'EOD': row['explanation']} if pd.notna(row['explanation']) else {}
        }

    last_updated = previous_day_df['timestamp'].max()

    return JSONResponse(content={
        "previous_day_eod": previous_day_eod_dict,
        "date": str(previous_day),
        "last_updated": last_updated.isoformat() if pd.notna(last_updated) else None
    })

def is_unusual_pnl(book: str, pnl: float) -> bool:
    df = pd.read_csv(CSV_FILE)
    book_data = df[df['book'] == book]
    
    if len(book_data) < 5:  # Not enough historical data
        return abs(pnl) > 1000000  # Use absolute threshold for new books
    
    mean = book_data['pnl'].mean()
    std = book_data['pnl'].std()
    
    if std == 0:  # Avoid division by zero
        return bool(abs(pnl - mean) > 1000000)
    
    z_score = (pnl - mean) / std
    
    return bool(abs(z_score) > 3 or abs(pnl) > 1000000)  # Combine both conditions

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)