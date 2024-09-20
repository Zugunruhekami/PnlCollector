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
        "Greater China",
        "ASEAN",
        "C3",
        "CEEMEA",
        "LATAM"
    },
    "G10": {
        "EURO",
        "Pacific G10",
        "CAD",
        "Scandies",
        "Special Exotics"
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
    "Inventory": {
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
    for _, row in selected_df.iterrows():
        if row['book'] not in pnl_dict:
            pnl_dict[row['book']] = {'ASIA': 0, 'LONDON': 0, 'NEW YORK': 0, 'EOD': 0, 'explanations': {}}
        pnl_dict[row['book']][row['session']] = float(row['pnl'])  # Ensure it's a Python float
        if pd.notna(row['explanation']):
            pnl_dict[row['book']]['explanations'][row['session']] = str(row['explanation'])  # Ensure it's a string

    # Calculate cumulative PNL (sum across days, not sessions)
    cumulative_pnl = df.groupby(['date', 'book']).last().groupby('book')['pnl'].cumsum().unstack()
    cumulative_pnl_dict = {
        str(date): {book: float(pnl) if pd.notna(pnl) else 0 for book, pnl in row.items()}
        for date, row in cumulative_pnl.iterrows()
    }

    # Get daily session PNL (latest observation for each session)
    daily_session_pnl = df.sort_values('timestamp').groupby(['date', 'session']).last()['pnl'].unstack()
    daily_session_pnl_dict = {
        str(date): {session: float(pnl) if pd.notna(pnl) else 0 for session, pnl in row.items()}
        for date, row in daily_session_pnl.iterrows()
    }

    last_updated = df['timestamp'].max()

    # Calculate book performance statistics
    book_stats = df.groupby('book').agg({
        'pnl': ['sum', 'count', 'std']
    }).reset_index()
    book_stats.columns = ['book', 'total_pnl', 'frequency', 'volatility']
    book_stats_dict = book_stats.to_dict(orient='records')

    # Calculate top performers
    top_performers = book_stats.sort_values('total_pnl', ascending=False).head(10)
    top_performers_dict = top_performers.to_dict(orient='records')

    response_data = {
        "daily_pnl": {str(selected_date): pnl_dict} if pnl_dict else {},
        "cumulative_pnl": cumulative_pnl_dict,
        "daily_session_pnl": daily_session_pnl_dict,
        "last_updated": last_updated.isoformat() if pd.notna(last_updated) else None,
        "book_stats": book_stats_dict,
        "top_performers": top_performers_dict
    }

    # Replace inf and nan values before JSON serialization
    sanitized_data = replace_inf_nan(response_data)

    return JSONResponse(content=sanitized_data)

def replace_inf_nan(obj):
    if isinstance(obj, dict):
        return {k: replace_inf_nan(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [replace_inf_nan(v) for v in obj]
    elif isinstance(obj, float):
        if math.isinf(obj):
            return "Infinity" if obj > 0 else "-Infinity"
        elif math.isnan(obj):
            return None  # or you could use "NaN" if you prefer
    return obj

@app.get("/get_previous_day_eod")
async def get_previous_day_eod():
    df = pd.read_csv(CSV_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['date'] = df['timestamp'].dt.date

    today = datetime.now().date()
    yesterday = today - timedelta(days=1)

    # Filter yesterday's data and get the latest entry for each book
    yesterday_df = df[(df['date'] == yesterday) & (df['session'] == 'EOD')].sort_values('timestamp')
    yesterday_df = yesterday_df.groupby('book').last().reset_index()

    # Create previous day's EOD data
    previous_day_eod_dict = {}
    for _, row in yesterday_df.iterrows():
        previous_day_eod_dict[row['book']] = {
            'EOD': row['pnl'],
            'explanations': {'EOD': row['explanation']} if pd.notna(row['explanation']) else {}
        }

    last_updated = yesterday_df['timestamp'].max()

    return JSONResponse(content={
        "previous_day_eod": previous_day_eod_dict,
        "date": str(yesterday),
        "last_updated": last_updated.isoformat() if last_updated else None
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