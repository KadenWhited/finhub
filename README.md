# ⬡ FinHub

**A self-hosted personal finance and crypto trading hub.**
Replaces Coinbase, Reddit, news apps, bank apps, credit card apps, notes, and more — aggregated into one dark terminal interface built for active traders and budget-conscious investors.

Built with **Python (Flask)** + **Vanilla JS** + **SQLite**. No build step. No framework. Runs locally on Windows, accessible from any device via Tailscale or a VPS.

---

## Feature Overview

| Module | What it does |
|---|---|
| **Trade Journal** | Log crypto trades, auto-calculate P&L, track win rate, profit factor, strategy tags |
| **Checkbook** | Income and expense ledger with running balance and category breakdown |
| **Credit Cards** | Track balances, charges, payments, and utilization per card |
| **Gambling Tracker** | Sessions, buy-ins, cash-outs, ROI, per-game breakdown, streak tracking |
| **Budget** | Monthly income vs expense comparison, fixed vs variable split, recurring payment detection |
| **Market** | Live CoinGecko prices, watchlist, 5%+ movers, top 50 coins, coin search |
| **Stocks** | Yahoo Finance price data, stock watchlist, positions, portfolio P&L |
| **Charts & Analytics** | Full-page charts for net worth, P&L, cash flow, spending by category, gambling trends |
| **Backtester** | Simulate 5 strategies (SMA/EMA crossover, RSI, Donchian, Bollinger) on live Kraken OHLCV data |
| **News & Sentiment** | Personalized feed from CoinDesk, CoinTelegraph, Decrypt, Reddit, YouTube — scored and ranked by relevance |
| **Notifications** | Priority-tiered alerts (HIGH/MEDIUM/LOW) across Desktop, Telegram, ntfy.sh, and Web Push |
| **PWA** | Installable to phone home screen, works offline, background sync |
| **Daily Summary** | Morning digest pushed to all channels at a configurable time |

---

## Quick Start

### Windows (recommended)
```
run.bat
```

### Mac / Linux
```bash
chmod +x run.sh
./run.sh
```

### Manual
```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Full Setup Guide

### 1. Prerequisites

- **Python 3.11+** — [python.org/downloads](https://python.org/downloads)
- **Git** — [git-scm.com](https://git-scm.com)

### 2. Clone the repository

```bash
git clone https://github.com/KadenWhited/finhub.git
cd finhub
```

### 3. Create and activate a virtual environment

```bash
python -m venv venv

# Windows:
venv\Scripts\activate

# Mac/Linux:
source venv/bin/activate
```

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

### 5. Configure environment variables

Copy the example and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and set:

```bash
# Required
SECRET_KEY=your-long-random-string-here

# Optional — enables password gate on the app
APP_PASSWORD=your-chosen-password

# CoinGecko API (free tier works)
# Get at: https://www.coingecko.com/en/api
COINGECKO_API_KEY=CG-xxxxxxxxxxxxxxxxxxxx

# Telegram bot alerts (optional)
# 1. Message @BotFather on Telegram → /newbot
# 2. Get token, start a chat with your bot, then visit:
#    https://api.telegram.org/bot<TOKEN>/getUpdates
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ntfy.sh push notifications (optional)
# Install ntfy app → subscribe to your topic
NTFY_TOPIC=finhub-yourname-abc123

# VAPID keys for Web Push (optional)
# Generate: python generate_vapid.py
VAPID_PRIVATE_KEY=
VAPID_PUBLIC_KEY=
VAPID_EMAIL=mailto:you@example.com
```

### 6. Generate VAPID keys (for Web Push notifications)

```bash
python -c "
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
import base64
v = Vapid()
v.generate_keys()
priv = base64.urlsafe_b64encode(v.private_key.private_bytes_raw()).decode().rstrip('=')
pub  = base64.urlsafe_b64encode(
    v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
).decode().rstrip('=')
print('VAPID_PRIVATE_KEY=' + priv)
print('VAPID_PUBLIC_KEY='  + pub)
"
```

Copy both lines into `.env`. Then add the public key to `frontend/index.html` before the `pwa.js` script tag:

```html
<script>window.FINHUB_VAPID_PUBLIC_KEY = 'YOUR_PUBLIC_KEY_HERE';</script>
```

### 7. Generate PWA icons

```bash
python generate_icons.py
```

Creates `frontend/assets/icon-96.png`, `icon-192.png`, `icon-512.png`.

### 8. Start the app

```bash
python app.py
```

The database (`data/finance_hub.db`) is created automatically on first run.

### 9. Seed sample data (optional)

```bash
python seed_data.py
```

Populates 6 months of realistic trades, checkbook entries, gambling sessions, watchlist, and recurring payments so you can explore all features immediately.

---

## Mobile Access

### Option A — Tailscale (free, local network)

1. Install [Tailscale](https://tailscale.com/download) on your PC and phone
2. Sign into the same account on both devices
3. Your PC gets a permanent Tailscale IP (e.g. `100.x.x.x`)
4. Access FinHub from your phone at `http://100.x.x.x:5000`

### Option B — VPS Deployment (~$4-6/month)

See [DEPLOYMENT.md](DEPLOYMENT.md) for full Nginx + Gunicorn + Let's Encrypt setup on Ubuntu 22.04.

### Installing to Phone Home Screen (PWA)

**Android (Chrome):** Visit the app → three-dot menu → "Add to Home Screen"

**iOS (Safari):** Visit the app → Share button → "Add to Home Screen"
> iOS 16.4+ required for push notifications. Must be opened from the home screen icon, not the Safari browser tab.

---

## Windows Auto-Start (Run on Boot)

Install as a Windows service so FinHub starts silently on login with no terminal:

```bash
# Run PowerShell as Administrator:
python windows_service.py --startup=auto install
python windows_service.py start
```

To stop or uninstall:
```bash
python windows_service.py stop
python windows_service.py remove
```

---

## Notification Setup

### Desktop (Windows Toast)
Works automatically. Requires `win10toast`:
```bash
pip install win10toast
```

### Telegram
1. Message `@BotFather` on Telegram → `/newbot` → copy your token
2. Start a chat with your new bot (send it any message)
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `"id"` inside `"chat"`
4. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env`

### ntfy.sh
1. Install the [ntfy app](https://ntfy.sh) on your phone
2. Subscribe to a unique topic (e.g. `finhub-kaden-abc123`)
3. Add `NTFY_TOPIC=your-topic` to `.env`

### Web Push
Requires VAPID keys (see Step 6 above) and the app installed as a PWA. Enable in Settings → Mobile & Notifications.

### Alert Priority Tiers

| Tier | Default Channels | Examples |
|---|---|---|
| 🔴 HIGH | Desktop + Telegram + ntfy + Web Push | RSI < 25, price > 10% move, balance at $0, credit > 95% |
| 🟡 MEDIUM | Desktop + Telegram + ntfy | Price 5-10% move, volume spike, large transaction |
| 🔵 LOW | Desktop only | Price 2-5% move, news sentiment shift, recurring payment due |

All tiers and channels are configurable per alert type in Settings → Alert System.

---

## Project Structure

```
finhub/
│
├── app.py                          # Flask entry point — registers all blueprints
├── requirements.txt                # Python dependencies
├── .env.example                    # Environment variable template
├── run.bat                         # Windows quick-start script
├── run.sh                          # Mac/Linux quick-start script
├── seed_data.py                    # Populates DB with 6 months of sample data
├── generate_icons.py               # Creates PWA icon PNGs (no Pillow needed)
├── windows_service.py              # Installs app as Windows background service
│
├── data/
│   └── finance_hub.db              # SQLite database (auto-created on first run)
│
├── deploy/
│   ├── finhub.nginx                # Nginx reverse proxy config (VPS)
│   ├── finhub.service              # systemd service file (VPS auto-restart)
│   └── vps_setup.sh                # Automated Ubuntu 22.04 VPS setup script
│
├── backend/
│   ├── models/
│   │   └── database.py             # SQLite schema, init_db(), get_db() helper
│   │
│   ├── routes/                     # Flask blueprints — one file per module
│   │   ├── auth.py                 # Login, logout, session check, rate limiting
│   │   ├── trades.py               # Trade CRUD, realized/unrealized P&L stats
│   │   ├── checkbook.py            # Income/expense CRUD, running balance
│   │   ├── credit.py               # Credit accounts, transactions, utilization
│   │   ├── gambling.py             # Session CRUD, lifetime stats, gross winnings
│   │   ├── dashboard.py            # Cross-module summary for dashboard cards
│   │   ├── market.py               # Watchlist, live prices, movers, coin search
│   │   ├── charts.py               # OHLCV and time-series chart data endpoints
│   │   ├── stocks.py               # Stock watchlist, positions, Yahoo Finance data
│   │   ├── backtester.py           # Strategy simulation endpoints
│   │   ├── news.py                 # Personalized news feed with sentiment scoring
│   │   ├── budget.py               # Monthly stats, recurring payment detection
│   │   ├── safeguards.py           # Revenge trading detection and cooldown
│   │   ├── alerts.py               # Alert status, test, settings, cooldown reset
│   │   ├── push.py                 # Web Push VAPID subscription management
│   │   ├── settings.py             # Key-value settings store
│   │   ├── notes.py                # Daily journal with mood tracking
│   │   ├── tools.py                # Position size calculator
│   │   └── export.py               # JSON/CSV export and import
│   │
│   └── services/                   # Business logic — called by routes
│       ├── coingecko.py            # CoinGecko API wrapper with caching
│       ├── charts.py               # Chart data builders (crypto, stock, spending)
│       ├── backtester.py           # OHLCV fetch (Kraken), 5 strategy simulators
│       ├── news.py                 # RSS + Reddit + YouTube fetch, relevance scoring
│       ├── notifications.py        # Priority-tiered alert dispatch (all channels)
│       ├── recurring.py            # Recurring payment detection algorithm
│       └── safeguards.py           # Consecutive loss detection logic
│
└── frontend/
    ├── index.html                  # App shell — all script/CSS tags, SPA container
    ├── sw.js                       # Service worker — offline cache, sync queue, push
    ├── manifest.json               # PWA manifest — icons, shortcuts, display mode
    │
    ├── assets/
    │   ├── icon-96.png             # PWA icon (generated by generate_icons.py)
    │   ├── icon-192.png            # PWA icon
    │   └── icon-512.png            # PWA icon
    │
    ├── css/
    │   ├── main.css                # Core dark terminal theme, layout, components
    │   ├── market.css              # Coin cards, movers ticker, price badges
    │   ├── charts.css              # Chart cards, range bar, canvas wrappers
    │   ├── stage2c.css             # Sparklines, risk preview panel
    │   ├── stage2d.css             # Net worth hero, dashboard card tinting
    │   ├── stage3.css              # Backtester layout, news feed, sentiment bar
    │   ├── stage3b.css             # Weight sliders, sentiment dots
    │   ├── budget.css              # Month rows, recurring cards, category bars
    │   ├── news-enhanced.css       # Relevance bars, profile strip, media badges
    │   ├── alerts.css              # Toggle switches, alert matrix table
    │   └── stage4.css              # Offline banner, PWA standalone padding
    │
    └── js/
        ├── api.js                  # Fetch helpers: get/post/put/del with error handling
        ├── utils.js                # Shared: formatters, modals, rangeBar, chart helpers
        ├── chart-engine.js         # Custom LineChart + BarChart canvas classes
        ├── pwa.js                  # SW registration, push subscription, install prompt
        ├── app.js                  # SPA router, nav, page switching, initPWA()
        │
        └── modules/                # One JS file per page/feature
            ├── dashboard.js        # Net worth hero, sparklines, news strip, stat cards
            ├── trades.js           # Trade journal, P&L split, strategy tags, safeguard
            ├── checkbook.js        # Ledger UI, income/expense CRUD
            ├── credit.js           # Credit cards, transactions, utilization bars
            ├── gambling.js         # Sessions, per-game stats, streak badge
            ├── stocks.js           # Stock watchlist, positions, portfolio
            ├── market.js           # Live prices, watchlist cards, top 50, movers
            ├── charts-view.js      # Analytics page, all chart modals, net worth hero
            ├── backtester.js       # Strategy config UI, results, equity curve, grader
            ├── news.js             # Personalized feed, source filters, coin pills
            ├── budget.js           # Monthly view, month detail modal, recurring tab
            ├── settings.js         # All settings including alert matrix, PWA controls
            ├── notes.js            # Daily journal, mood tracking
            └── tools.js            # Position size calculator
```

---

## API Reference

All endpoints are prefixed with `/api/`.

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Authenticate with APP_PASSWORD (rate limited: 10/5min) |
| POST | `/auth/logout` | Clear session |
| GET | `/auth/check` | Check authentication status |

### Trades
| Method | Endpoint | Description |
|---|---|---|
| GET | `/trades/` | All trades |
| POST | `/trades/` | Create trade |
| PUT | `/trades/:id` | Update trade |
| DELETE | `/trades/:id` | Delete trade |
| GET | `/trades/stats` | Realized/unrealized P&L, win rate, strategy breakdown |

### Checkbook
| Method | Endpoint | Description |
|---|---|---|
| GET | `/checkbook/` | All entries |
| POST | `/checkbook/` | Create entry |
| PUT | `/checkbook/:id` | Update entry |
| DELETE | `/checkbook/:id` | Delete entry |
| GET | `/checkbook/stats` | Balance, income, expenses, categories |

### Credit
| Method | Endpoint | Description |
|---|---|---|
| GET | `/credit/accounts` | All credit accounts |
| POST | `/credit/accounts` | Create account |
| GET | `/credit/transactions` | All transactions |
| POST | `/credit/transactions` | Create transaction |
| GET | `/credit/stats` | Utilization, total balance |

### Gambling
| Method | Endpoint | Description |
|---|---|---|
| GET | `/gambling/` | All sessions |
| POST | `/gambling/` | Log session |
| PUT | `/gambling/:id` | Update session |
| DELETE | `/gambling/:id` | Delete session |
| GET | `/gambling/stats` | Lifetime stats, gross winnings, by-game breakdown |

### Market
| Method | Endpoint | Description |
|---|---|---|
| GET | `/market/watchlist` | Watchlist with live prices |
| POST | `/market/watchlist` | Add coin to watchlist |
| DELETE | `/market/watchlist/:id` | Remove from watchlist |
| GET | `/market/prices` | Live prices for coin IDs |
| GET | `/market/movers` | Coins moving 5%+ in 24h |
| GET | `/market/top50` | Top 50 coins by market cap |
| GET | `/market/search?q=` | Search coins |

### Charts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/charts/networth` | Net worth over time |
| GET | `/charts/trades?range=` | Cumulative trade P&L |
| GET | `/charts/spending?range=` | Cash balance, income, expenses, by category |
| GET | `/charts/gambling?range=` | Cumulative gambling P&L |
| GET | `/charts/crypto/:coin_id?range=` | Coin price chart |
| GET | `/charts/stock/:ticker?range=` | Stock price chart |

Valid range values: `6h` `1d` `1w` `1m` `3m` `6m` `1y` `all`

### Budget
| Method | Endpoint | Description |
|---|---|---|
| GET | `/budget/summary` | Current month + 3-month averages |
| GET | `/budget/monthly` | All months breakdown |
| GET | `/budget/monthly/:YYYY-MM` | Single month transaction detail |
| GET | `/budget/recurring` | Detected recurring payments |
| POST | `/budget/recurring/:id/confirm` | Confirm a recurring detection |
| POST | `/budget/recurring/:id/dismiss` | Dismiss a recurring detection |

### Backtester
| Method | Endpoint | Description |
|---|---|---|
| GET | `/backtester/strategies` | Available strategies |
| GET | `/backtester/symbols` | Supported coin symbols |
| POST | `/backtester/run` | Run a strategy simulation |
| POST | `/backtester/compare` | Compare all strategies on same symbol |

### News
| Method | Endpoint | Description |
|---|---|---|
| GET | `/news/?limit=&coin=&types=` | Personalized news feed |
| GET | `/news/summary` | Sentiment summary only |
| GET | `/news/profile` | Current personalization profile |

### Alerts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/alerts/status` | Alert thread status and recent alerts |
| POST | `/alerts/test` | Send test notification (body: `{channels, priority}`) |
| POST | `/alerts/clear` | Reset all cooldowns |
| GET | `/alerts/settings` | All alert configuration |
| PUT | `/alerts/settings` | Update alert configuration |

### Push (Web Push)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/push/subscribe` | Register a push subscription |
| POST | `/push/unsubscribe` | Remove a push subscription |
| GET | `/push/status` | VAPID config status, subscription count |
| POST | `/push/test` | Send test push to all subscriptions |

### Safeguards
| Method | Endpoint | Description |
|---|---|---|
| GET | `/safeguards/state` | Current revenge trading safeguard state |
| PUT | `/safeguards/config` | Update threshold and cooldown |
| POST | `/safeguards/override` | Override active cooldown with acknowledgment |

### Misc
| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard/summary` | Cross-module snapshot for dashboard |
| GET | `/settings/` | All settings as key-value dict |
| PUT | `/settings/` | Bulk update settings |
| GET | `/notes/` | All journal entries |
| GET | `/notes/:date` | Journal entry for a specific date |
| PUT | `/notes/:date` | Save journal entry |
| GET | `/tools/position-size` | Calculate position size from risk % |
| GET | `/export/json` | Export all data as JSON |
| GET | `/export/csv/:table` | Export table as CSV |
| POST | `/export/import` | Import from JSON backup |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes (production) | Flask session signing key — use a long random string |
| `APP_PASSWORD` | No | Password gate for the app. Leave unset for open local access |
| `COINGECKO_API_KEY` | Recommended | Free Demo API key from coingecko.com/en/api |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | No | Your Telegram chat ID |
| `NTFY_TOPIC` | No | ntfy.sh topic for push notifications |
| `VAPID_PRIVATE_KEY` | No | VAPID private key for Web Push |
| `VAPID_PUBLIC_KEY` | No | VAPID public key for Web Push |
| `VAPID_EMAIL` | No | Contact email for VAPID (`mailto:you@example.com`) |
| `FLASK_ENV` | No | Set to `development` to enable debug mode |

---

## Database Schema

All data is stored in a single SQLite file at `data/finance_hub.db`.

| Table | Description |
|---|---|
| `trades` | Crypto trade journal entries |
| `checkbook` | Income and expense ledger |
| `credit_accounts` | Credit card accounts |
| `credit_transactions` | Credit card charges and payments |
| `gambling_sessions` | Gambling session records |
| `watchlist` | Crypto coin watchlist |
| `stock_watchlist` | Stock ticker watchlist |
| `stock_positions` | Stock position holdings |
| `notes` | Daily journal entries |
| `settings` | Key-value store for all app configuration |

---

## Backtester Strategies

| Strategy | Description |
|---|---|
| **SMA Crossover (20/50)** | Buy when 20-period SMA crosses above 50-period SMA |
| **EMA Crossover (9/21)** | Buy when 9 EMA crosses above 21 EMA, sell on cross below |
| **RSI Oversold Bounce** | Buy when RSI drops below 30, sell when it exceeds 70 |
| **Donchian Breakout (20)** | Buy on 20-period high breakout, exit on 10-period low |
| **Bollinger Mean Reversion** | Buy at lower band, sell at middle band |

Data sourced from Kraken via ccxt. Falls back to Bybit → KuCoin → OKX → MEXC if Kraken is unavailable. Binance is blocked on US IPs (HTTP 451).

---

## News Feed Sources

**RSS:** CoinDesk, CoinTelegraph, Decrypt, Bitcoin Magazine, The Block, Bankless, Investing.com

**Reddit:** r/CryptoCurrency (150+ upvotes), r/Bitcoin (100+), r/investing (75+), r/stocks (50+), r/wallstreetbets (500+), r/ethfinance (30+), r/CryptoMarkets (50+), r/SecurityAnalysis (20+)

**YouTube RSS:** Coin Bureau, Benjamin Cowen, InvestAnswers, Altcoin Daily, Real Vision

Personalization algorithm scores each article on: recency (40%), coin relevance (30%), strategy alignment (15%), experience level match (10%), content type (5%). Weights are user-adjustable in Settings.

---

## Roadmap

- ✅ **Stage 1** — Core (trade journal, checkbook, gambling, dashboard)
- ✅ **Stage 2** — Market data (CoinGecko, watchlist, stocks, charts, sparklines)
- ✅ **Stage 3** — Intelligence (backtester, news/sentiment, safeguards, budget, recurring detection)
- ✅ **Stage 4** — Deployment (PWA, service worker, push notifications, Windows service, VPS setup, tiered alerts)
- 🔜 **Stage 5** — Ingestion (Coinbase Advanced Trade API, Kalshi API, bank email parsing)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11+, Flask 3.0, SQLite |
| Frontend | Vanilla JS (ES2020), Canvas API (custom chart engine) |
| Data | CoinGecko API, Yahoo Finance (yfinance), ccxt (Kraken) |
| News | feedparser (RSS), Reddit JSON API, YouTube RSS |
| Notifications | win10toast, plyer, pywebpush, Telegram Bot API, ntfy.sh |
| PWA | Service Worker, IndexedDB, Web Push API |
| Deployment | Gunicorn, Nginx, Let's Encrypt, systemd, pywin32 |

---

## Security Notes

- `SECRET_KEY` must be set in `.env` before any production or network-accessible deployment
- `APP_PASSWORD` is optional but strongly recommended for Tailscale or VPS deployment
- Login is rate-limited to 10 attempts per 5-minute window per IP
- Debug mode is disabled when `FLASK_ENV` is not set to `development`
- All API endpoints check session authentication when `APP_PASSWORD` is configured
- SQLite data is local-only — nothing leaves your machine except to configured notification channels

---

## License

MIT — use freely, modify freely, no warranty.