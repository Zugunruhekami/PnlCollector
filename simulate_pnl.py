import csv
from datetime import datetime, timedelta
import random

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
        "Scandies": ["DKK", "NOK", "SEK"]
    },
    "PM": {
        "Metals": ["XAU", "XAG", "XPT", "XPD"]
    }
}

# Sessions with their time ranges (in UTC)
sessions = {
    "ASIA": (0, 8),
    "LONDON": (8, 16),
    "NEW YORK": (16, 22),
    "EOD": (22, 24)
}

# Date range
start_date = datetime(2024, 5, 1)
end_date = datetime(2024, 9, 2)

# Generate all book names
book_names = []
for top_level, mid_level in book_structure.items():
    for mid, low_level in mid_level.items():
        for ccy in low_level:
            book_names.append(f"{top_level}/{mid}/{ccy}")

# Generate CSV
with open('simulated_pnl_data.csv', 'w', newline='') as file:
    writer = csv.writer(file)
    writer.writerow(['timestamp', 'book', 'pnl', 'session'])

    current_date = start_date
    while current_date <= end_date:
        for book in book_names:
            for session, (start_hour, end_hour) in sessions.items():
                timestamp = current_date.replace(
                    hour=random.randint(start_hour, end_hour - 1),
                    minute=random.randint(0, 59),
                    second=random.randint(0, 59)
                )
                if session == "EOD" and timestamp.hour == 23:
                    timestamp = timestamp.replace(hour=22, minute=random.randint(0, 59))
                pnl = round(random.uniform(-1000, 1000), 2)  # Random PNL between -1000 and 1000
                writer.writerow([timestamp.isoformat(), book, pnl, session])
        current_date += timedelta(days=1)

print("CSV file 'simulated_pnl_data.csv' has been generated.")