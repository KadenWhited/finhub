"""
backend/services/ingestion/kalshi.py
Kalshi REST API v2 — positions, trade history, order placement.

Auth: RSA-PSS with three headers:
  KALSHI-ACCESS-KEY       — your API key ID
  KALSHI-ACCESS-SIGNATURE — RSA-PSS signature
  KALSHI-ACCESS-TIMESTAMP — Unix ms timestamp

.env:
  KALSHI_API_KEY_ID      — key ID from kalshi.com → Settings → API
  KALSHI_API_PRIVATE_KEY — RSA private key PEM (multiline, use quotes in .env)
  KALSHI_DEMO_MODE       — 'true' to use demo sandbox (default: false)

Docs: https://docs.kalshi.com/
"""
import os
import time
import base64
import hashlib
import json
from datetime import datetime, timezone, timedelta

import requests

PROD_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
DEMO_BASE = 'https://demo-api.kalshi.co/trade-api/v2'

# ─────────────────────────────────────────
#  AUTH — RSA-PSS
# ─────────────────────────────────────────

PROD_BASE = 'https://api.elections.kalshi.com'
DEMO_BASE = 'https://demo-api.kalshi.co'
API_PATH  = '/trade-api/v2'


def _base_url() -> str:
    demo = os.environ.get('KALSHI_DEMO_MODE', 'false').lower()
    return DEMO_BASE if demo == 'true' else PROD_BASE


def _get_private_key():
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey

    pem = os.environ.get('KALSHI_API_PRIVATE_KEY', '')
    if not pem:
        raise ValueError("KALSHI_API_PRIVATE_KEY must be set in .env")

    pem = pem.replace('\\n', '\n').strip()

    raw_key = load_pem_private_key(pem.encode(), password=None)

    # Explicit cast so Pylance knows it's RSA and has .sign()
    if not isinstance(raw_key, RSAPrivateKey):
        raise ValueError("KALSHI_API_PRIVATE_KEY must be an RSA private key")

    return raw_key


def _sign(method: str, full_path: str, timestamp_ms: int) -> str:
    """
    Sign: timestamp_ms_str + METHOD + /trade-api/v2/path (no query string)
    Uses RSA-PSS with SHA256 and MAX_LENGTH salt.
    """
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    private_key = _get_private_key()

    # Strip query parameters before signing
    path_no_query = full_path.split('?')[0]
    message       = f"{timestamp_ms}{method}{path_no_query}".encode('utf-8')

    signature = private_key.sign(  # type: ignore[union-attr]
        message,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH,
        ),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode('utf-8')


def _headers(method: str, path: str) -> dict:
    key_id       = os.environ.get('KALSHI_API_KEY_ID', '')
    if not key_id:
        raise ValueError("KALSHI_API_KEY_ID must be set in .env")

    timestamp_ms = int(time.time() * 1000)
    # Sign the FULL path including /trade-api/v2 prefix
    full_path    = API_PATH + path
    signature    = _sign(method.upper(), full_path, timestamp_ms)

    return {
        'KALSHI-ACCESS-KEY':       key_id,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': str(timestamp_ms),
        'Content-Type':            'application/json',
    }


def _get(path: str, params: dict | None = None) -> dict:
    url      = _base_url() + API_PATH + path
    headers  = _headers('GET', path)
    response = requests.get(url, headers=headers, params=params or {}, timeout=15)
    response.raise_for_status()
    return response.json()


def _post(path: str, body: dict | None = None) -> dict:
    url      = _base_url() + API_PATH + path
    headers  = _headers('POST', path)
    response = requests.post(url, headers=headers, json=body or {}, timeout=15)
    response.raise_for_status()
    return response.json()


def _delete(path: str) -> dict:
    url      = _base_url() + API_PATH + path
    headers  = _headers('DELETE', path)
    response = requests.delete(url, headers=headers, timeout=15)
    response.raise_for_status()
    return response.json()


# ─────────────────────────────────────────
#  CONNECTION TEST
# ─────────────────────────────────────────

def test_connection() -> dict:
    """Verify Kalshi API keys work."""
    try:
        data = _get('/portfolio/balance')
        balance = float(data.get('balance', 0))
        return {
            'ok':      True,
            'message': f'Connected — balance ${balance:.2f}',
            'balance': balance,
            'demo':    os.environ.get('KALSHI_DEMO_MODE', 'false').lower() == 'true',
        }
    except ImportError as e:
        return {'ok': False, 'error': str(e)}
    except ValueError as e:
        return {'ok': False, 'error': str(e)}
    except requests.HTTPError as e:
        return {'ok': False, 'error': f'HTTP {e.response.status_code}: {e.response.text[:200]}'}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}


# ─────────────────────────────────────────
#  PORTFOLIO — POSITIONS
# ─────────────────────────────────────────

def get_positions() -> list:
    """Return all open positions."""
    data      = _get('/portfolio/positions')
    positions = data.get('market_positions', [])
    out       = []
    for p in positions:
        qty = int(p.get('position', 0))
        if qty == 0:
            continue
        out.append({
            'market_ticker':   p.get('market_id', ''),
            'side':            'yes' if qty > 0 else 'no',
            'contracts':       abs(qty),
            'market_exposure': float(p.get('market_exposure', 0)),
            'realized_pnl':    float(p.get('realized_pnl', 0)),
            'unrealized_pnl':  float(p.get('unrealized_pnl', 0)),
            'total_cost':      float(p.get('total_cost_price', 0)),
        })
    return out


# ─────────────────────────────────────────
#  TRADE HISTORY — FILLS
# ─────────────────────────────────────────

def get_fills(lookback_days: int = 90) -> list:
    """Fetch all fills (executed trades) from Kalshi."""
    min_ts    = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp())
    min_dt    = datetime.fromtimestamp(min_ts, tz=timezone.utc).isoformat()

    all_fills = []
    cursor    = None

    while True:
        params: dict = {'min_ts': min_ts, 'limit': 100}
        if cursor:
            params['cursor'] = cursor

        data  = _get('/portfolio/fills', params)
        fills = data.get('fills', [])
        all_fills.extend(fills)

        cursor = data.get('cursor')
        if not cursor or not fills:
            break

    return [_normalize_fill(f) for f in all_fills]


def _normalize_fill(fill: dict) -> dict:
    ticker = fill.get('market_ticker') or fill.get('ticker', '')
    side   = fill.get('side', 'yes').lower()
    action = fill.get('action', 'buy').lower()

    count_str = str(fill.get('count_fp') or fill.get('count') or '0')
    try:
        count = int(float(count_str))
    except (ValueError, TypeError):
        count = 0

    if side == 'yes':
        price_str = str(fill.get('yes_price_dollars') or fill.get('yes_price') or '0')
    else:
        price_str = str(fill.get('no_price_dollars') or fill.get('no_price') or '0')
    try:
        price = float(price_str)
    except (ValueError, TypeError):
        price = 0.0

    price_cents = int(round(price * 100))

    ts = fill.get('created_time') or fill.get('ts', '')
    try:
        if isinstance(ts, (int, float)):
            dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        else:
            dt = datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
        date      = dt.strftime('%Y-%m-%d')
        opened_at = dt.isoformat()
    except Exception:
        date      = datetime.now().strftime('%Y-%m-%d')
        opened_at = date

    ext_id = fill.get('fill_id') or fill.get('trade_id') or ''

    return {
        'external_id':       ext_id,
        'market_ticker':     ticker,
        'market_title':      fill.get('market_title', ticker),
        'category':          _guess_category(ticker),
        'side':              side,
        'action':            action,
        'contracts':         count,
        'entry_price_cents': price_cents,
        'fees_cents':        int(round(float(str(fill.get('fee_cost', '0'))) * 100)),
        'opened_at':         opened_at,
        'status':            'open',
        'exit_type':         None,
        'source':            'kalshi_api',
    }


def _guess_category(ticker: str) -> str:
    """Guess market category from ticker prefix."""
    ticker = ticker.upper()
    if any(x in ticker for x in ('FED', 'INXD', 'CPI', 'GDP', 'JOBS', 'RATE')):
        return 'economics'
    if any(x in ticker for x in ('NFL', 'NBA', 'MLB', 'NHL', 'NCAA', 'SPORT')):
        return 'sports'
    if any(x in ticker for x in ('PRES', 'SENATE', 'HOUSE', 'GOV', 'ELEC')):
        return 'politics'
    if any(x in ticker for x in ('BTC', 'ETH', 'CRYPTO', 'COIN')):
        return 'crypto'
    if any(x in ticker for x in ('TEMP', 'RAIN', 'SNOW', 'HURR', 'WEATHER')):
        return 'weather'
    return 'other'


# ─────────────────────────────────────────
#  MARKET DATA
# ─────────────────────────────────────────

def get_market(ticker: str) -> dict:
    """Get current market data for a ticker."""
    data   = _get(f'/markets/{ticker}')
    market = data.get('market', {})
    return _normalize_market(market)


def search_markets(query: str, limit: int = 20) -> list:
    """Search markets by keyword."""
    data    = _get('/markets', params={'search': query, 'limit': limit, 'status': 'open'})
    markets = data.get('markets', [])
    return [_normalize_market(m) for m in markets]


def get_open_markets(limit: int = 50, category: str | None = None) -> list:
    """Get open markets, optionally filtered by category."""
    params: dict = {'status': 'open', 'limit': limit}
    if category:
        params['series_ticker'] = category
    data    = _get('/markets', params=params)
    markets = data.get('markets', [])
    return [_normalize_market(m) for m in markets]


def _normalize_market(m: dict) -> dict:
    """Normalize Kalshi market data."""
    # Prices are now dollar strings
    def _price(val) -> float:
        try:
            return float(str(val)) if val is not None else 0.0
        except (ValueError, TypeError):
            return 0.0

    yes_price = _price(m.get('yes_ask') or m.get('yes_bid') or m.get('last_price'))
    no_price  = round(1.0 - yes_price, 4) if yes_price else 0.0

    return {
        'ticker':          m.get('ticker', ''),
        'title':           m.get('title', ''),
        'subtitle':        m.get('subtitle', ''),
        'category':        _guess_category(m.get('ticker', '')),
        'status':          m.get('status', ''),
        'yes_price':       yes_price,
        'no_price':        no_price,
        'yes_price_cents': int(yes_price * 100),
        'no_price_cents':  int(no_price * 100),
        'volume':          int(m.get('volume', 0)),
        'open_interest':   int(m.get('open_interest', 0)),
        'close_time':      m.get('expected_expiration_time') or m.get('close_time', ''),
        'result':          m.get('result', ''),
        'can_close_early': m.get('can_close_early', False),
    }


# ─────────────────────────────────────────
#  ORDER PLACEMENT
# ─────────────────────────────────────────

def place_order(ticker: str, side: str, action: str,
                count: int, price: float,
                order_type: str = 'limit') -> dict:
    """
    Place an order on Kalshi.
    price: dollar value e.g. 0.65 for $0.65 (65 cents)
    side: 'yes' or 'no'
    action: 'buy' or 'sell'
    count: number of contracts
    """
    body = {
        'ticker':     ticker,
        'action':     action,
        'side':       side,
        'count':      count,
        'type':       order_type,
    }
    if order_type == 'limit':
        body['yes_price'] = f"{price:.4f}"

    result = _post('/portfolio/orders', body)
    return result.get('order', result)


def cancel_order(order_id: str) -> dict:
    """Cancel an open order."""
    result = _delete(f'/portfolio/orders/{order_id}')
    return result


def get_open_orders() -> list:
    """Return all open (unfilled) orders."""
    data   = _get('/portfolio/orders', params={'status': 'open'})
    return data.get('orders', [])


# ─────────────────────────────────────────
#  SETTLEMENT HISTORY
# ─────────────────────────────────────────

def get_settlements(lookback_days: int = 90) -> list:
    """
    Get settled positions — markets that have resolved.
    These update open predictions to resolved_win or resolved_loss.
    """
    min_ts = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp())
    data   = _get('/portfolio/settlements', params={'min_ts': min_ts, 'limit': 100})
    return data.get('settlements', [])


# ─────────────────────────────────────────
#  MAIN SYNC
# ─────────────────────────────────────────

def sync_kalshi():
    """
    Called by scheduler every 5 minutes.
    1. Import new fills as predictions
    2. Update resolved predictions from settlements
    3. Update open position P&L
    """
    from backend.models.database import get_db
    from backend.services.ingestion.deduplicator import log_ingestion

    db       = get_db()
    imported = 0
    updated  = 0
    errors   = 0

    try:
        # ── Import new fills ──────────────────────────────────────────────────
        fills = get_fills(lookback_days=90)
        for fill in fills:
            ext_id = fill['external_id']
            existing = db.execute(
                'SELECT id FROM predictions WHERE external_id = ?', (ext_id,)
            ).fetchone()

            if existing:
                log_ingestion(db, 'kalshi', 'duplicate', 'prediction',
                              external_id=ext_id, message='Already exists')
                continue

            try:
                db.execute('''
                    INSERT OR IGNORE INTO predictions
                        (external_id, market_ticker, market_title, category,
                         side, action, contracts, entry_price_cents,
                         fees_cents, opened_at, status, source)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ''', (
                    fill['external_id'],
                    fill['market_ticker'],
                    fill['market_title'],
                    fill['category'],
                    fill['side'],
                    fill['action'],
                    fill['contracts'],
                    fill['entry_price_cents'],
                    fill['fees_cents'],
                    fill['opened_at'],
                    'open',
                    'kalshi_api',
                ))
                db.commit()
                imported += 1
                log_ingestion(db, 'kalshi', 'success', 'prediction',
                              external_id=ext_id,
                              message=f"{fill['market_ticker']} {fill['side']} "
                                      f"{fill['contracts']} contracts")
            except Exception as e:
                errors += 1
                log_ingestion(db, 'kalshi', 'error', 'prediction',
                              external_id=ext_id, message=str(e))

        # ── Process settlements (resolve open predictions) ────────────────────
        settlements = get_settlements(lookback_days=90)
        for s in settlements:
            ticker = s.get('market_ticker') or s.get('ticker', '')
            result = s.get('yes_return', '0')  # dollar string e.g. "1.0000" = win
            try:
                payout = float(str(result))
            except (ValueError, TypeError):
                payout = 0.0

            # Find matching open prediction
            rows = db.execute(
                "SELECT * FROM predictions WHERE market_ticker = ? AND status = 'open'",
                (ticker,)
            ).fetchall()

            for row in rows:
                side        = row['side']
                # YES win = payout > 0, NO win = yes_return = 0 but no_return > 0
                no_return   = float(str(s.get('no_return', '0')))
                if side == 'yes':
                    won = payout > 0
                else:
                    won = no_return > 0

                new_status   = 'resolved_win' if won else 'resolved_loss'
                payout_cents = int(payout * 100) if side == 'yes' else int(no_return * 100)

                db.execute('''
                    UPDATE predictions
                    SET status = ?,
                        resolution_result     = ?,
                        resolution_value_cents= ?,
                        closed_at = ?,
                        exit_type = 'resolution'
                    WHERE id = ?
                ''', (
                    new_status,
                    'yes' if payout > 0 else 'no',
                    payout_cents,
                    datetime.now(timezone.utc).isoformat(),
                    row['id'],
                ))
                db.commit()
                updated += 1

        # ── Update connection record ──────────────────────────────────────────
        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, records_imported, updated_at)
            VALUES ('kalshi', datetime('now'), 'success', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'success',
                records_imported = records_imported + ?,
                error_message    = NULL,
                updated_at       = datetime('now')
        ''', (imported, imported))
        db.commit()

        if imported > 0 or updated > 0:
            print(f"[kalshi] Imported {imported} fills, resolved {updated} predictions")

    except Exception as e:
        error_msg = str(e)[:500]
        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, error_message, updated_at)
            VALUES ('kalshi', datetime('now'), 'error', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'error',
                error_message    = ?,
                updated_at       = datetime('now')
        ''', (error_msg, error_msg))
        db.commit()
        print(f"[kalshi] Sync error: {error_msg}")
        raise

    finally:
        db.close()

    return {'imported': imported, 'updated': updated, 'errors': errors}
