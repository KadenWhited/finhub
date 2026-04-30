# ⬡ Finance Hub

A self-hosted personal finance + crypto trading hub built with Python (Flask) + Vanilla JS.
Tracks crypto trades, checkbook, credit cards, gambling, stocks, budgeting, and news in one place.

## Quick Start (Windows)

### Mac / Linux
```bash
chmod +x run.sh
./run.sh
```

### Windows
```
run.bat
```

### Manual
```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000** in your browser.

---

## Project Structure

```
finance-hub/
├── app.py                    # Flask entry point
├── requirements.txt
├── run.sh / run.bat
├── data/
│   └── finance_hub.db        # SQLite database (auto-created)
├── backend/
│   ├── models/
│   │   └── database.py       # Schema + DB helpers
│   └── routes/
│       ├── trades.py         # Trade journal API
│       ├── checkbook.py      # Income/expense API
│       ├── gambling.py       # Gambling sessions API
│       └── dashboard.py      # Summary API
└── frontend/
    ├── index.html
    ├── manifest.json         # PWA manifest
    ├── css/
    │   └── main.css
    └── js/
        ├── api.js            # Fetch helpers
        ├── utils.js          # Format helpers
        ├── app.js            # Router + init
        └── modules/
            ├── dashboard.js
            ├── trades.js
            ├── checkbook.js
            └── gambling.js
```

---

## Stage 1 — Features (Complete)

### Trade Journal
- Log entry/exit price, coin, direction (long/short), position size, date, reason, notes
- Automatic P&L and P&L% calculation
- Win rate, avg win, avg loss, profit factor stats
- Open/closed trade filtering
- **Revenge trading alert**: flags when your last 3 closed trades are all losses

### Checkbook
- Log income and expenses by category
- Running balance calculated per entry
- Category breakdown in stats
- 10 default categories

### Gambling Tracker
- Log sessions: game type, venue, buy-in, cash-out, duration, notes
- Lifetime stats: total wagered, net P&L, ROI, win rate
- Per-game-type breakdown

### Dashboard
- Snapshot of all three modules
- Revenge trading alert surfaced at the top

---

## API Endpoints

### Trades
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/trades/ | All trades |
| POST | /api/trades/ | Create trade |
| PUT | /api/trades/:id | Update trade |
| DELETE | /api/trades/:id | Delete trade |
| GET | /api/trades/stats | Aggregated stats |

### Checkbook
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/checkbook/ | All entries |
| POST | /api/checkbook/ | Create entry |
| PUT | /api/checkbook/:id | Update entry |
| DELETE | /api/checkbook/:id | Delete entry |
| GET | /api/checkbook/stats | Stats + balance |

### Gambling
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/gambling/ | All sessions |
| POST | /api/gambling/ | Create session |
| PUT | /api/gambling/:id | Update session |
| DELETE | /api/gambling/:id | Delete session |
| GET | /api/gambling/stats | Lifetime stats |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/dashboard/summary | All-module snapshot |

---

## Deploying to a VPS

```bash
# Install nginx + certbot for HTTPS
# Run app with gunicorn
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app

# Or use systemd service for auto-restart on reboot
```

---

## Roadmap

- **Stage 2**: Live CoinGecko price dashboard, watchlist, 5%+ movers alert
- **Stage 3**: Backtester (ccxt + OHLCV), news/sentiment feed
- **Stage 4**: Full PWA with offline support + push notifications
