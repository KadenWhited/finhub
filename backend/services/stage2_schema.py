"""
Stage 2 database additions.
Add this content to backend/models/database.py inside init_db(), before conn.commit().
"""

STAGE2_TABLES = '''
    -- Watchlist table
    CREATE TABLE IF NOT EXISTS watchlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        coin_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        added_at TEXT DEFAULT (datetime('now'))
    );
'''

STAGE2_MIGRATION = '''
    -- Add source column to trades, checkbook, credit_transactions if missing
    -- (safe to run multiple times due to try/except in Python)
'''
