import sqlite3
import os
import sys

def _get_base_dir():
    """Returns the correct base directory whether running normally or as .exe"""
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle
        return os.path.dirname(sys.executable)
    else:
        # Running normally
        return os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    
def _get_db_path() -> str:
    data_dir = os.environ.get('MONEYRIGHT_DATA_DIR')
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
        return os.path.join(data_dir, 'finance_hub.db')

    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))

    data_dir = os.path.join(base, 'data')
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, 'finance_hub.db')

DB_PATH = _get_db_path()

def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db()
    c = conn.cursor()

    # Trades table
    c.execute('''
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'long',
            entry_price REAL NOT NULL,
            exit_price REAL,
            position_size REAL NOT NULL,
            entry_date TEXT NOT NULL,
            exit_date TEXT,
            reason TEXT,
            notes TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT DEFAULT (datetime('now')),
            source TEXT DEFAULT 'manual'
        )
    ''')

    # Checkbook table
    c.execute('''
        CREATE TABLE IF NOT EXISTS checkbook (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            date TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Credit accounts table
    c.execute('''
        CREATE TABLE IF NOT EXISTS credit_accounts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              last_four TEXT,
              credit_limit REAL,
              balance REAL NOT NULL DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Credit transactions table
    c.execute('''
        CREATE TABLE IF NOT EXISTS credit_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            date TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Gambling sessions table
    c.execute('''
        CREATE TABLE IF NOT EXISTS gambling_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_type TEXT NOT NULL,
            venue TEXT,
            buy_in REAL NOT NULL,
            cash_out REAL NOT NULL,
            date TEXT NOT NULL,
            duration_minutes INTEGER,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Daily notes / trading journal
    c.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL UNIQUE,
            content TEXT NOT NULL,
            mood TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Settings table (single-row key-value store)
    c.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    ''')

    # Future-proof: add source column if it doesn't exist yet
    for table in ('checkbook', 'credit_transactions', 'trades'):
        try:
            c.execute(f"ALTER TABLE {table} ADD COLUMN source TEXT DEFAULT 'manual'")
        except Exception:
            pass  # Column already exists

    defaults = [
        ('starting_capital', '350'),
        ('currency', 'USD'),
        ('risk_per_trade_pct', '2'),
    ]
    for key, val in defaults:
        c.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (key, val))

    # Stage 2 — Watchlist
    c.execute('''
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            coin_id TEXT NOT NULL UNIQUE,
            symbol TEXT NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Stock watchlist
    c.execute('''
        CREATE TABLE IF NOT EXISTS stock_watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            added_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Stock positions
    c.execute('''
        CREATE TABLE IF NOT EXISTS stock_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            shares REAL NOT NULL,
            avg_cost REAL NOT NULL,
            purchase_date TEXT NOT NULL,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Strategy/tags/source columns — safe on existing DB
    for col, default in [
        ('strategy', 'general'),
        ('tags', ''),
        ('source', 'manual'),
    ]:
        try:
            c.execute(f"ALTER TABLE trades ADD COLUMN {col} TEXT DEFAULT '{default}'")
        except Exception:
            pass

    for table in ('checkbook', 'credit_transactions'):
        try:
            c.execute(f"ALTER TABLE {table} ADD COLUMN source TEXT DEFAULT 'manual'")
        except Exception:
            pass

    for key, val in [
        ('max_open_positions', '3'),
        ('max_daily_loss_pct', '5'),
        ('preferred_trade_duration', 'swing'),
        ('alert_threshold_pct', '5'),
    ]:
        c.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (key, val))

    for key, val in [
        ('revenge_trade_threshold', '3'),
        ('revenge_cooldown_hours',  '24'),
    ]:
        c.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (key, val))

    alert_defaults = {
        # Channel routing matrix
        'alert_channel_high_desktop':    '1',
        'alert_channel_high_telegram':   '1',
        'alert_channel_high_ntfy':       '1',
        'alert_channel_high_push':       '1',
        'alert_channel_medium_desktop':  '1',
        'alert_channel_medium_telegram': '1',
        'alert_channel_medium_ntfy':     '1',
        'alert_channel_medium_push':     '0',
        'alert_channel_low_desktop':     '1',
        'alert_channel_low_telegram':    '0',
        'alert_channel_low_ntfy':        '0',
        'alert_channel_low_push':        '0',
        # Alert type toggles and min priority
        'alert_type_price_move_enabled':           '1',
        'alert_type_price_move_min_priority':      'low',
        'alert_type_volume_spike_enabled':         '1',
        'alert_type_volume_spike_min_priority':    'medium',
        'alert_type_rsi_extreme_enabled':          '1',
        'alert_type_rsi_extreme_min_priority':     'medium',
        'alert_type_news_sentiment_enabled':       '1',
        'alert_type_news_sentiment_min_priority':  'low',
        'alert_type_strategy_signal_enabled':      '1',
        'alert_type_strategy_signal_min_priority': 'high',
        'alert_type_balance_low_enabled':          '1',
        'alert_type_balance_low_min_priority':     'high',
        'alert_type_large_transaction_enabled':    '1',
        'alert_type_large_transaction_min_priority': 'medium',
        'alert_type_credit_utilization_enabled':   '1',
        'alert_type_credit_utilization_min_priority': 'medium',
        'alert_type_credit_charge_enabled':        '1',
        'alert_type_credit_charge_min_priority':   'low',
        'alert_type_daily_summary_enabled':        '1',
        'alert_type_daily_summary_min_priority':   'low',
        # Thresholds
        'alert_threshold_pct':           '5',
        'alert_checkbook_min_balance':   '100',
        'alert_large_tx_threshold':      '100',
        'alert_credit_utilization_pct':  '80',
        'alert_credit_charge_threshold': '200',
        'alert_daily_summary_time':      '08:00',
    }
    for key, val in alert_defaults.items():
        c.execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', (key, val))

    c.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_checkbook_dedup
        ON checkbook(date, amount, description, type)
    ''')
    c.execute('''
        CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_dedup
        ON credit_transactions(date, amount, description, account_id)
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS ingestion_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            source      TEXT NOT NULL,
            status      TEXT NOT NULL,
            record_type TEXT,
            external_id TEXT,
            raw_data    TEXT,
            message     TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS connections (
            service           TEXT PRIMARY KEY,
            enabled           INTEGER DEFAULT 1,
            last_sync_at      TEXT,
            last_sync_status  TEXT,
            records_imported  INTEGER DEFAULT 0,
            error_message     TEXT,
            updated_at        TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS predictions (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            external_id            TEXT UNIQUE,
            market_ticker          TEXT NOT NULL,
            market_title           TEXT NOT NULL,
            category               TEXT,
            side                   TEXT NOT NULL,
            action                 TEXT NOT NULL,
            contracts              INTEGER NOT NULL,
            entry_price_cents      INTEGER,
            exit_price_cents       INTEGER,
            fees_cents             INTEGER DEFAULT 0,
            status                 TEXT DEFAULT 'open',
            resolution_result      TEXT,
            resolution_value_cents INTEGER,
            opened_at              TEXT,
            closed_at              TEXT,
            exit_type              TEXT,
            notes                  TEXT,
            source                 TEXT DEFAULT 'kalshi_api',
            created_at             TEXT DEFAULT (datetime('now'))
        )
    ''')

    c.execute('''
        CREATE TABLE IF NOT EXISTS prediction_watchlist (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            market_ticker         TEXT NOT NULL UNIQUE,
            market_title          TEXT NOT NULL,
            category              TEXT,
            yes_price_cents       INTEGER,
            no_price_cents        INTEGER,
            volume                INTEGER,
            close_time            TEXT,
            alert_threshold_cents INTEGER DEFAULT 10,
            added_at              TEXT DEFAULT (datetime('now'))
        )
    ''')

    # Add external_id and fees to trades if not present
    for col_def in ['external_id TEXT', 'fees REAL DEFAULT 0']:
        try:
            c.execute(f"ALTER TABLE trades ADD COLUMN {col_def}")
        except Exception:
            pass

    # Add external_id to checkbook and credit_transactions
    for table in ('checkbook', 'credit_transactions'):
        try:
            c.execute(f"ALTER TABLE {table} ADD COLUMN external_id TEXT")
        except Exception:
            pass

    # Add source to gambling_sessions
    try:
        c.execute("ALTER TABLE gambling_sessions ADD COLUMN source TEXT DEFAULT 'manual'")
    except Exception:
        pass

    # Indexes for fast external_id lookups
    c.execute('''CREATE INDEX IF NOT EXISTS idx_trades_external_id
                 ON trades(external_id) WHERE external_id IS NOT NULL''')
    c.execute('''CREATE INDEX IF NOT EXISTS idx_checkbook_external_id
                 ON checkbook(external_id) WHERE external_id IS NOT NULL''')
    c.execute('''CREATE INDEX IF NOT EXISTS idx_credit_external_id
                 ON credit_transactions(external_id) WHERE external_id IS NOT NULL''')

    # Seed connections table
    for svc in ('kraken', 'kalshi', 'gmail'):
        c.execute("INSERT OR IGNORE INTO connections (service) VALUES (?)", (svc,))

    try:
        c.execute("ALTER TABLE checkbook ADD COLUMN income_stream TEXT")
    except Exception:
        pass
    c.execute("INSERT OR IGNORE INTO connections (service) VALUES ('gmail')")

    conn.commit()
    conn.close()
    print(f"✅ Database initialized at {DB_PATH}")
