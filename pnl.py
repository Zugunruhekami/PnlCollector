from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List
import csv
from datetime import datetime
import pandas as pd
import os
from fastapi.templating import Jinja2Templates

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
        "Greater China": ["CNH", "TWD", "HKD"],
        "ASEAN": ["SGD", "THB", "INR", "IDR", "KRW"],
        "C3": ["CZK", "HUF", "PLN"],
        "CEEMEA": ["ILS", "TRY", "ZAR"],
        "LATAM": ["BRL", "CLP", "COP", "MXN"]
    },
    "G10": {
        "EURO": ["EUR", "GBP", "CHF"],
        "Pacific G10": ["JPY", "AUD", "NZD", "CAD"],
        "Scandies": ["DKK", "NOK", "SEK"],
#         "Special Exotics": [],
#         "CME": []
    },
    "PM": {
        "Metals": ["XAU", "XAG", "XPT", "XPD"]
    }
}

# Helper function to get all books
def get_all_books():
    books = []
    for top_level, mid_level in book_structure.items():
        for mid, low_level in mid_level.items():
            if low_level:
                books.extend([f"{top_level}/{mid}/{book}" for book in low_level])
            else:
                books.append(f"{top_level}/{mid}")
    return books

# Pydantic model for PNL data
class PNLData(BaseModel):
    book: str
    pnl: float
    session: str

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request, "books": get_all_books()})

@app.post("/submit_pnl")
async def submit_pnl(pnl_data: PNLData):
    if not is_valid_pnl(pnl_data.book, pnl_data.pnl):
        raise HTTPException(status_code=400, detail="PNL value seems unusual. Please double-check.")

    with open(CSV_FILE, 'a', newline='') as file:
        writer = csv.writer(file)
        writer.writerow([datetime.now().isoformat(), pnl_data.book, pnl_data.pnl, pnl_data.session])
    
    return {"message": "PNL submitted successfully"}

@app.get("/visualization", response_class=HTMLResponse)
async def visualization(request: Request):
    return templates.TemplateResponse("visualization.html", {"request": request})


@app.get("/get_pnl_data")
async def get_pnl_data():
    df = pd.read_csv(CSV_FILE)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df['date'] = df['timestamp'].dt.date
    df['day_of_week'] = df['timestamp'].dt.dayofweek
    df['month'] = df['timestamp'].dt.to_period('M').astype(str)

    # Get today's date
    today = pd.Timestamp.now().date()

    # Filter today's data
    today_df = df[df['date'] == today]

    # Create today's PNL data
    todays_pnl = today_df.groupby(['book', 'session'])['pnl'].sum().unstack(fill_value=0).reset_index()
    todays_pnl_dict = todays_pnl.set_index('book').to_dict(orient='index')
    
    # Cumulative PnL for each book
    cumulative_pnl = df.groupby(['date', 'book'])['pnl'].sum().unstack().cumsum()
    cumulative_pnl_dict = {
        str(date): {book: float(pnl) for book, pnl in row.items()}
        for date, row in cumulative_pnl.iterrows()
    }

    # Daily PnL contribution from each session
    daily_session_pnl = df.groupby(['date', 'session'])['pnl'].sum().unstack()
    daily_session_pnl_dict = {
        str(date): {session: float(pnl) for session, pnl in row.items()}
        for date, row in daily_session_pnl.iterrows()
    }

    # PnL performance across books and days of the week
    heatmap_data = df.groupby(['book', 'day_of_week'])['pnl'].mean().unstack()
    heatmap_data_dict = {
        book: [float(pnl) for pnl in row]
        for book, row in heatmap_data.iterrows()
    }

    # Monthly performance of different books
    monthly_book_pnl = df.groupby(['month', 'book'])['pnl'].sum().unstack()
    monthly_book_pnl_dict = {
        str(month): {book: float(pnl) for book, pnl in row.items()}
        for month, row in monthly_book_pnl.iterrows()
    }

    # PnL, frequency, and volatility for each book
    book_stats = df.groupby('book').agg({
        'pnl': ['sum', 'count', 'std']
    }).reset_index()
    book_stats.columns = ['book', 'total_pnl', 'frequency', 'volatility']
    book_stats_dict = book_stats.to_dict(orient='records')

    # Calculate overall statistics
    overall_stats = {
        'total_pnl': float(df['pnl'].sum()),
        'average_daily_pnl': float(df.groupby('date')['pnl'].sum().mean()),
        'best_performing_book': book_stats.loc[book_stats['total_pnl'].idxmax(), 'book'],
        'worst_performing_book': book_stats.loc[book_stats['total_pnl'].idxmin(), 'book'],
        'best_performing_session': df.groupby('session')['pnl'].sum().idxmax(),
        'worst_performing_session': df.groupby('session')['pnl'].sum().idxmin(),
    }

    return JSONResponse(content={
        "cumulative_pnl": cumulative_pnl_dict,
        "daily_session_pnl": daily_session_pnl_dict,
        "heatmap_data": heatmap_data_dict,
        "monthly_book_pnl": monthly_book_pnl_dict,
        "book_stats": book_stats_dict,
        "overall_stats": overall_stats,
            "todays_pnl": todays_pnl_dict  # Add this new key-value pair
})

def is_valid_pnl(book: str, pnl: float) -> bool:
    df = pd.read_csv(CSV_FILE)
    book_data = df[df['book'] == book]
    
    if len(book_data) < 5:  # Not enough historical data
        return True
    
    mean = book_data['pnl'].mean()
    std = book_data['pnl'].std()
    z_score = (pnl - mean) / std
    
    return abs(z_score) <= 3  # Allow values within 3 standard deviations

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)