"""
seed_data.py
Run from project root: python seed_data.py
Generates ~6 months of realistic sample data for testing.
WARNING: This ADDS to existing data. Run on a fresh DB for best results.
  del data\\finance_hub.db   (Windows)
  rm data/finance_hub.db    (Mac/Linux)
  python seed_data.py
"""
import sqlite3
import os
import random
from datetime import datetime, timedelta

DB_PATH = os.path.join('data', 'finance_hub.db')

# ── Ensure data dir and DB exist ────────────────────────────────────────────
os.makedirs('data', exist_ok=True)

# Import and run init_db to create schema first
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from backend.models.database import init_db
init_db()

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
c = conn.cursor()

random.seed(42)  # Reproducible

TODAY = datetime.now()
START = TODAY - timedelta(days=180)  # 6 months back

def days_ago(n):
    return (TODAY - timedelta(days=n)).strftime('%Y-%m-%d')

def rand_date_between(start_days_ago, end_days_ago):
    n = random.randint(end_days_ago, start_days_ago)
    return days_ago(n)

print("🌱 Seeding Finance Hub with sample data...")
print(f"   Range: {START.strftime('%Y-%m-%d')} → {TODAY.strftime('%Y-%m-%d')}")
print()

# ─────────────────────────────────────────────────────────────────────────────
#  SETTINGS
# ─────────────────────────────────────────────────────────────────────────────
c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('starting_capital', '350')")
c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('risk_per_trade_pct', '2')")
c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_open_positions', '3')")
c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('max_daily_loss_pct', '5')")
c.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('preferred_trade_duration', 'swing')")
print("✅ Settings seeded")

# ─────────────────────────────────────────────────────────────────────────────
#  CHECKBOOK  (~90 entries, monthly income + varied expenses)
# ─────────────────────────────────────────────────────────────────────────────
income_entries = [
    # Bi-weekly paycheck for 6 months (~13 paychecks)
    *[{'type': 'income', 'amount': round(random.uniform(720, 780), 2),
       'category': 'Income', 'description': 'Paycheck - Part time job',
       'date': days_ago(d)} for d in range(0, 182, 14)],
    # Occasional side gigs
    {'type': 'income', 'amount': 120.00, 'category': 'Income',
     'description': 'Freelance work', 'date': days_ago(145)},
    {'type': 'income', 'amount': 85.00, 'category': 'Income',
     'description': 'Sold old gear', 'date': days_ago(90)},
    {'type': 'income', 'amount': 200.00, 'category': 'Income',
     'description': 'Birthday money', 'date': days_ago(60)},
    {'type': 'income', 'amount': 50.00, 'category': 'Income',
     'description': 'Referral bonus', 'date': days_ago(30)},
]

expense_entries = []
expense_templates = [
    ('Food',          'Groceries',           (40, 95),   7),
    ('Food',          'Fast food',           (8, 22),    5),
    ('Food',          'Coffee shop',         (5, 15),    4),
    ('Transport',     'Gas',                 (35, 60),   14),
    ('Transport',     'Uber',                (12, 28),   10),
    ('Entertainment', 'Netflix',             (15, 15),   30),
    ('Entertainment', 'Going out',           (20, 55),   18),
    ('Entertainment', 'Video games / apps',  (10, 30),   45),
    ('Utilities',     'Phone bill',          (45, 45),   30),
    ('Healthcare',    'Gym membership',      (30, 30),   30),
    ('Trading Capital','Coinbase deposit',   (50, 100),  21),
    ('Clothing',      'Online shopping',     (25, 80),   35),
    ('Other',         'Miscellaneous',       (10, 40),   20),
]

from datetime import datetime as _dt, timedelta as _td
_today = _dt.now()
recurring_seeds = []
recurring_templates = [
    ('Netflix',           'Entertainment', 15.49),
    ('Spotify',           'Entertainment', 10.99),
    ('Phone Bill',        'Utilities',     45.00),
    ('Gym Membership',    'Healthcare',    30.00),
    ('iCloud Storage',    'Subscriptions', 2.99),
    ('Amazon Prime',      'Subscriptions', 14.99),
    ('Internet Bill',     'Utilities',     59.99),
    ('Adobe Creative',    'Subscriptions', 54.99),
]
for desc, cat, amt in recurring_templates:
    # Insert 5 monthly occurrences going back 5 months
    for month_back in range(0, 5):
        pay_date = (_today - _td(days=30 * month_back)).replace(day=min(15, 28))
        recurring_seeds.append({
            'type': 'expense',
            'amount': round(amt + (0 if month_back % 2 == 0 else 0), 2),  # exact amount
            'category': cat,
            'description': desc,
            'date': pay_date.strftime('%Y-%m-%d')
        })

expense_entries.extend(recurring_seeds)

for category, desc, (lo, hi), freq_days in expense_templates:
    d = random.randint(0, freq_days - 1)
    while d <= 180:
        expense_entries.append({
            'type': 'expense',
            'amount': round(random.uniform(lo, hi), 2),
            'category': category,
            'description': desc,
            'date': days_ago(d)
        })
        d += freq_days + random.randint(-2, 4)

all_cb = income_entries + expense_entries
for e in all_cb:
    c.execute(
        'INSERT INTO checkbook (type, amount, category, description, date) VALUES (?,?,?,?,?)',
        (e['type'], e['amount'], e['category'], e['description'], e['date'])
    )
print(f"✅ Checkbook: {len(all_cb)} entries")

# ─────────────────────────────────────────────────────────────────────────────
#  CREDIT ACCOUNT + TRANSACTIONS
# ─────────────────────────────────────────────────────────────────────────────
c.execute(
    'INSERT OR IGNORE INTO credit_accounts (name, last_four, credit_limit) VALUES (?,?,?)',
    ('Discover Student', '4821', 500)
)
credit_id = c.execute('SELECT id FROM credit_accounts WHERE last_four = "4821"').fetchone()[0]

credit_charges = [
    ('Food & Dining',  'Chipotle',           (10, 18),   6),
    ('Shopping',       'Amazon',             (15, 60),   12),
    ('Subscriptions',  'Spotify',            (10, 10),   30),
    ('Gas',            'Shell gas station',  (30, 55),   14),
    ('Entertainment',  'Movie tickets',      (12, 28),   21),
    ('Healthcare',     'CVS Pharmacy',       (8, 35),    25),
    ('Other',          'Miscellaneous',      (5, 25),    18),
]

credit_entries = []
for cat, desc, (lo, hi), freq in credit_charges:
    d = random.randint(0, freq - 1)
    while d <= 180:
        credit_entries.append({
            'account_id': credit_id, 'type': 'charge',
            'amount': round(random.uniform(lo, hi), 2),
            'category': cat, 'description': desc,
            'date': days_ago(d)
        })
        d += freq + random.randint(-2, 3)

# Monthly payments
for month_offset in [170, 140, 110, 80, 50, 20]:
    credit_entries.append({
        'account_id': credit_id, 'type': 'payment',
        'amount': round(random.uniform(80, 150), 2),
        'category': 'Other', 'description': 'Monthly payment',
        'date': days_ago(month_offset)
    })

for e in credit_entries:
    c.execute(
        'INSERT INTO credit_transactions (account_id, type, amount, category, description, date) VALUES (?,?,?,?,?,?)',
        (e['account_id'], e['type'], e['amount'], e['category'], e['description'], e['date'])
    )
print(f"✅ Credit: {len(credit_entries)} transactions on Discover card")

# ─────────────────────────────────────────────────────────────────────────────
#  TRADES  (~40 trades, realistic beginner arc)
#  Early months: more losses, learning. Later months: improving win rate.
# ─────────────────────────────────────────────────────────────────────────────
trade_scenarios = [
    # (coin, direction, entry, exit_pct, size_usd, days_held, entry_days_ago, reason)
    # Month 6 (early — learning the hard way)
    ('BTC',  'long',  42000, -0.048, 80,  2, 178, 'Breakout play, FOMO entry'),
    ('ETH',  'long',  2200,  -0.062, 60,  3, 172, 'Support bounce, stopped out'),
    ('SOL',  'long',  95,     0.082, 50,  4, 168, 'Momentum trade, partial win'),
    ('DOGE', 'long',  0.085, -0.091, 40,  1, 164, 'News pump, got burned'),
    ('BTC',  'long',  43500, -0.035, 70,  2, 160, 'Trend follow, tight stop'),
    ('ADA',  'long',  0.38,   0.054, 45,  5, 155, 'Oversold bounce'),
    ('ETH',  'short', 2350,  -0.072, 55,  2, 150, 'Bad short — trend reversal'),

    # Month 5
    ('SOL',  'long',  102,    0.095, 60,  6, 145, 'Cup and handle breakout'),
    ('BTC',  'long',  44200, -0.028, 85,  2, 140, 'Bull flag — failed'),
    ('AVAX', 'long',  28,     0.118, 50,  7, 135, 'Strong sector rotation'),
    ('ETH',  'long',  2280,   0.072, 70,  4, 130, 'ETH/BTC ratio trade'),
    ('LINK', 'long',  14.5,  -0.055, 40,  3, 126, 'Oracle narrative faded'),
    ('BTC',  'long',  45000,  0.041, 90,  3, 122, 'Weekly support hold'),
    ('DOGE', 'long',  0.092, -0.101, 35,  1, 118, 'Meme run gamble — loss'),

    # Month 4 (starting to improve)
    ('SOL',  'long',  108,    0.134, 65,  8, 115, 'Major breakout confirmed'),
    ('ETH',  'long',  2350,   0.088, 75,  5, 110, 'Higher lows structure'),
    ('BTC',  'short', 46500,  0.052, 80,  2, 106, 'Double top, good R:R'),
    ('AVAX', 'long',  32,    -0.044, 55,  3, 102, 'Failed continuation'),
    ('POL',  'long',  0.55,   0.162, 45,  9, 98,  'Layer 2 narrative trade'),
    ('BTC',  'long',  44800,  0.065, 95,  4, 94,  'Demand zone bounce'),

    # Month 3
    ('ETH',  'long',  2400,   0.091, 80,  5, 90,  'Accumulation breakout'),
    ('SOL',  'long',  115,    0.071, 70,  3, 86,  'Partial — took profits early'),
    ('BTC',  'long',  46000, -0.031, 100, 2, 82,  'News FUD — stopped out'),
    ('LINK', 'long',  15.8,   0.127, 50,  7, 78,  'LINK season momentum'),
    ('AVAX', 'short', 35,     0.088, 60,  4, 74,  'Divergence short worked'),
    ('ETH',  'long',  2450,   0.048, 85,  3, 70,  'Small win, clean exit'),

    # Month 2 (finding edge)
    ('BTC',  'long',  47500,  0.072, 110, 5, 65,  'Weekly trend continuation'),
    ('SOL',  'long',  118,    0.108, 75,  6, 60,  'Alt season momentum'),
    ('ETH',  'long',  2500,  -0.022, 90,  2, 56,  'False breakout, quick cut'),
    ('AVAX', 'long',  36,     0.141, 60,  8, 52,  'Strong fundamentals play'),
    ('BTC',  'short', 48000,  0.063, 95,  3, 48,  'Resistance rejection short'),
    ('INJ',  'long',  28,     0.198, 50,  10, 44, 'Narrative trade — DeFi'),

    # Month 1 / recent (more consistent)
    ('ETH',  'long',  2600,   0.055, 100, 4, 38,  'Support reclaim'),
    ('BTC',  'long',  49000,  0.081, 120, 5, 33,  'All-time high momentum'),
    ('SOL',  'long',  122,    0.094, 80,  6, 28,  'Ecosystem growth trade'),
    ('BTC',  'long',  50500, -0.019, 100, 2, 22,  'Overextended, cut fast'),
    ('ETH',  'long',  2680,   0.112, 95,  7, 16,  'ETH upgrade catalyst'),
    ('AVAX', 'long',  38,     0.076, 65,  4, 10,  'Alt breakout trade'),
    # Open trades
    ('BTC',  'long',  51200,  None,  110, None, 5,  'Trend follow — open'),
    ('SOL',  'long',  128,    None,  75,  None, 3,  'Momentum — open'),
]

for coin, direction, entry, exit_pct, size_usd, days_held, entry_ago, reason in trade_scenarios:
    entry_date = days_ago(entry_ago)
    size = round(size_usd / entry, 6)

    if exit_pct is not None:
        if direction == 'long':
            exit_price = round(entry * (1 + exit_pct), 6)
        else:
            exit_price = round(entry * (1 - exit_pct), 6)
        exit_days = days_held or 3
        exit_date = days_ago(max(0, entry_ago - exit_days))
        status = 'closed'
    else:
        exit_price = None
        exit_date = None
        status = 'open'

    c.execute('''
        INSERT INTO trades (coin, direction, entry_price, exit_price, position_size,
                           entry_date, exit_date, reason, status)
        VALUES (?,?,?,?,?,?,?,?,?)
    ''', (coin, direction, entry, exit_price, size, entry_date, exit_date, reason, status))

print(f"✅ Trades: {len(trade_scenarios)} trades ({len([t for t in trade_scenarios if t[3] is not None])} closed, {len([t for t in trade_scenarios if t[3] is None])} open)")

# ─────────────────────────────────────────────────────────────────────────────
#  GAMBLING SESSIONS
# ─────────────────────────────────────────────────────────────────────────────
gambling_sessions = [
    ('Sports Betting', 'DraftKings',    25,   0,     days_ago(175), 30,   'NFL Sunday — bad picks'),
    ('Poker',          'Home game',     40,   65,    days_ago(162), 180,  'Good session, patient play'),
    ('Sports Betting', 'FanDuel',       20,   48,    days_ago(148), 20,   'NBA parlay hit'),
    ('Blackjack',      'Casino',        100,  60,    days_ago(135), 120,  'Variance night'),
    ('Sports Betting', 'DraftKings',    30,   0,     days_ago(121), 15,   'Pushed too many games'),
    ('Poker',          'Home game',     40,   90,    days_ago(108), 200,  'Won a few big pots'),
    ('Slots',          'Casino',        50,   30,    days_ago(95),  60,   'Just messing around'),
    ('Sports Betting', 'FanDuel',       25,   70,    days_ago(82),  10,   'Big game parlay'),
    ('Poker',          'Home game',     40,   25,    days_ago(70),  180,  'Tough cards all night'),
    ('Blackjack',      'Casino',        80,   120,   days_ago(58),  90,   'Card counting practice'),
    ('Sports Betting', 'DraftKings',    20,   45,    days_ago(45),  15,   'CFB Saturday'),
    ('Poker',          'Home game',     40,   0,     days_ago(32),  150,  'Bad beat on the river'),
    ('Sports Betting', 'FanDuel',       30,   30,    days_ago(20),  20,   'Push on the moneyline'),
    ('Poker',          'Home game',     40,   55,    days_ago(8),   170,  'Stayed disciplined'),
]

for game, venue, buy_in, cash_out, date, duration, notes in gambling_sessions:
    c.execute('''
        INSERT INTO gambling_sessions (game_type, venue, buy_in, cash_out, date, duration_minutes, notes)
        VALUES (?,?,?,?,?,?,?)
    ''', (game, venue, buy_in, cash_out, date, duration, notes))

print(f"✅ Gambling: {len(gambling_sessions)} sessions")

# ─────────────────────────────────────────────────────────────────────────────
#  STOCK WATCHLIST + POSITIONS
# ─────────────────────────────────────────────────────────────────────────────
stock_watchlist = [
    ('SPY',   'S&P 500 ETF',          1),
    ('^GSPC', 'S&P 500 Index',        2),
    ('AAPL',  'Apple Inc.',           3),
    ('NVDA',  'NVIDIA Corporation',   4),
    ('MSFT',  'Microsoft Corporation',5),
]

for ticker, name, order in stock_watchlist:
    c.execute(
        'INSERT OR IGNORE INTO stock_watchlist (ticker, name, sort_order) VALUES (?,?,?)',
        (ticker, name, order)
    )

stock_positions = [
    ('SPY',  'S&P 500 ETF',  1.5,  450.00, days_ago(155), 'First investment — DCA start'),
    ('SPY',  'S&P 500 ETF',  0.5,  470.00, days_ago(90),  'Added to position'),
    ('AAPL', 'Apple Inc.',   2.0,  178.00, days_ago(120), 'Tech exposure'),
    ('NVDA', 'NVIDIA Corp.', 0.25, 480.00, days_ago(75),  'AI trade thesis'),
]

for ticker, name, shares, avg_cost, date, notes in stock_positions:
    c.execute(
        'INSERT INTO stock_positions (ticker, name, shares, avg_cost, purchase_date, notes) VALUES (?,?,?,?,?,?)',
        (ticker, name, shares, avg_cost, date, notes)
    )

print(f"✅ Stocks: {len(stock_watchlist)} watchlist items, {len(stock_positions)} positions")

# ─────────────────────────────────────────────────────────────────────────────
#  CRYPTO WATCHLIST
# ─────────────────────────────────────────────────────────────────────────────
crypto_watchlist = [
    ('bitcoin',  'BTC', 'Bitcoin',  1),
    ('ethereum', 'ETH', 'Ethereum', 2),
    ('solana',   'SOL', 'Solana',   3),
    ('avalanche-2', 'AVAX', 'Avalanche', 4),
    ('chainlink', 'LINK', 'Chainlink', 5),
]

for coin_id, symbol, name, order in crypto_watchlist:
    c.execute(
        'INSERT OR IGNORE INTO watchlist (coin_id, symbol, name, sort_order) VALUES (?,?,?,?)',
        (coin_id, symbol, name, order)
    )

print(f"✅ Crypto watchlist: {len(crypto_watchlist)} coins")

# ─────────────────────────────────────────────────────────────────────────────
#  JOURNAL / NOTES
# ─────────────────────────────────────────────────────────────────────────────
journal_entries = [
    (days_ago(175), 'great',
     '''Started my trading journey today. Put $350 in Coinbase. Nervous but excited.
Read about risk management — going to try to only risk 2% per trade.
First trade was BTC, got FOMO and entered too late. Lesson: wait for the setup.'''),

    (days_ago(155), 'neutral',
     '''Down about $40 total so far. Losing more than winning but the losses are
smaller than my gains when I win. Need to stick to the plan.
Added $50 to Coinbase from paycheck. Bought my first SPY shares today — starting
the boring long term investing habit alongside trading.'''),

    (days_ago(130), 'bad',
     '''Revenge traded after two losses in a row. App flagged me — should have listened.
Took a third loss. Sitting out for 3 days to reset my head.
Rule: if I get the revenge trading alert, I do NOT open a new trade that day.'''),

    (days_ago(108), 'good',
     '''Best week so far. SOL trade worked perfectly — entered on the breakout,
held through the volatility, exited into strength. +12% on position.
Poker game was good too, won $50. Need to separate gambling from trading mentally.'''),

    (days_ago(90), 'neutral',
     '''6 week review:
- Win rate: ~43%. Need to get to 50%+
- Avg win bigger than avg loss — this is good
- Still entering too early sometimes, need more patience
- P&L is slightly positive which feels like a miracle given how much I am learning
Stock positions looking ok. SPY up a bit.'''),

    (days_ago(65), 'great',
     '''Something clicked this week. Waited for proper setups, didn''t chase.
BTC trade hit target exactly. AVAX continuation trade worked.
Starting to see patterns I couldn''t see before. The journal helps a lot.'''),

    (days_ago(40), 'good',
     '''Consistency is building. Still take losses but they don''t shake me anymore.
Biggest lesson: cutting losses fast is a skill, not a failure.
NVDA position up nicely — the AI thesis is playing out.
Going to start studying chart patterns more systematically before Stage 3 backtesting.'''),

    (days_ago(15), 'great',
     '''Best month yet. P&L positive, win rate climbing toward 55%.
Portfolio: crypto trading P&L + stock positions both up.
Goals for next month:
1. Add backtesting (Stage 3)
2. Be more selective — quality over quantity on setups
3. Keep journaling daily, it actually works'''),

    (days_ago(3), 'good',
     '''Two open trades right now — BTC and SOL. Both looking healthy.
Not going to touch them until my target or stop is hit.
Discipline is the edge.'''),
]

for date, mood, content in journal_entries:
    c.execute(
        'INSERT OR IGNORE INTO notes (date, mood, content) VALUES (?,?,?)',
        (date, mood, content.strip())
    )

print(f"✅ Journal: {len(journal_entries)} entries")

# ─────────────────────────────────────────────────────────────────────────────
#  FINALIZE
# ─────────────────────────────────────────────────────────────────────────────
conn.commit()
conn.close()

print()
print("✅ All done! Seed data applied successfully.")
print(f"   Database: {DB_PATH}")
print()
print("   Start the app:  python app.py")
print("   Then open:      http://localhost:5000")