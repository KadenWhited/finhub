"""
backend/services/ingestion/kraken.py
Kraken REST API — read-only trade history and balance sync.

Auth: HMAC-SHA512 (API Key + API Secret from kraken.com)
  - KRAKEN_API_KEY    (alphanumeric string)
  - KRAKEN_API_SECRET (base64-encoded secret)

Docs: https://docs.kraken.com/api/docs/rest-api/get-trade-history
"""
import os
import time
import hmac
import hashlib
import base64
import urllib.parse
from datetime import datetime, timezone, timedelta

import requests

KRAKEN_BASE = 'https://api.kraken.com'

# Map Kraken asset codes to clean symbols
ASSET_MAP = {
    'XXBT': 'BTC', 'XBT': 'BTC',
    'XETH': 'ETH', 'ETH': 'ETH',
    'XLTC': 'LTC', 'LTC': 'LTC',
    'XXRP': 'XRP', 'XRP': 'XRP',
    'XXLM': 'XLM', 'XLM': 'XLM',
    'XDOT': 'DOT', 'DOT': 'DOT',
    'SOL':  'SOL', 'XSOL': 'SOL',
    'ADA':  'ADA', 'XADA': 'ADA',
    'LINK': 'LINK',
    'AVAX': 'AVAX',
    'MATIC':'MATIC',
    'DOGE': 'DOGE',
    'INJ':  'INJ',
    'ZUSD': 'USD', 'ZEUR': 'EUR',
    'USD':  'USD', 'EUR':  'EUR',
}

STABLE_ASSETS = {'USD', 'EUR', 'GBP', 'USDT', 'USDC', 'DAI', 'ZUSD', 'ZEUR'}


# ─────────────────────────────────────────
#  AUTH
# ─────────────────────────────────────────

def _sign(path: str, data: dict, secret: str) -> str:
    """Generate Kraken API signature."""
    post_data  = urllib.parse.urlencode(data)
    encoded    = (str(data['nonce']) + post_data).encode()
    message    = path.encode() + hashlib.sha256(encoded).digest()
    secret_b   = base64.b64decode(secret)
    signature  = hmac.new(secret_b, message, hashlib.sha512)
    return base64.b64encode(signature.digest()).decode()


def _post(endpoint: str, data: dict | None = None) -> dict:
    """Authenticated POST to Kraken private API."""
    api_key    = os.environ.get('KRAKEN_API_KEY', '')
    api_secret = os.environ.get('KRAKEN_API_SECRET', '')

    if not api_key or not api_secret:
        raise ValueError(
            "KRAKEN_API_KEY and KRAKEN_API_SECRET must be set in .env"
        )

    path   = f'/0/private/{endpoint}'
    data   = data or {}
    data['nonce'] = str(int(time.time() * 1000))

    signature = _sign(path, data, api_secret)

    response = requests.post(
        KRAKEN_BASE + path,
        data=data,
        headers={
            'API-Key':  api_key,
            'API-Sign': signature,
        },
        timeout=15,
    )
    response.raise_for_status()
    result = response.json()

    if result.get('error'):
        errors = result['error']
        if errors:
            raise ValueError(f"Kraken API error: {', '.join(errors)}")

    return result.get('result', {})


def _clean_asset(asset: str) -> str:
    """Convert Kraken asset code to clean symbol."""
    return ASSET_MAP.get(asset, asset.lstrip('XZ'))


# ─────────────────────────────────────────
#  CONNECTION TEST
# ─────────────────────────────────────────

def test_connection() -> dict:
    """Verify Kraken API keys work."""
    try:
        result = _post('Balance')
        balances = {
            _clean_asset(k): float(v)
            for k, v in result.items()
            if float(v) > 0
        }
        non_stable = {k: v for k, v in balances.items() if k not in STABLE_ASSETS}
        return {
            'ok':      True,
            'message': f'Connected — {len(non_stable)} crypto holding(s)',
            'balances': balances,
        }
    except ValueError as e:
        return {'ok': False, 'error': str(e)}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}


# ─────────────────────────────────────────
#  BALANCES
# ─────────────────────────────────────────

def get_balances() -> list:
    """Return non-zero, non-stablecoin balances."""
    result = _post('Balance')
    out    = []
    for asset, value in result.items():
        bal    = float(value)
        symbol = _clean_asset(asset)
        if bal > 0 and symbol not in STABLE_ASSETS:
            out.append({
                'coin':    symbol,
                'balance': bal,
                'source':  'kraken_api',
            })
    return out


# ─────────────────────────────────────────
#  TRADE HISTORY
# ─────────────────────────────────────────

def get_trades_history(lookback_days: int = 90) -> list:
    """
    Fetch full trade history from Kraken.
    Paginates automatically — 50 trades per request.
    """
    start_ts  = int((datetime.now(timezone.utc) - timedelta(days=lookback_days)).timestamp())
    all_trades = []
    offset     = 0

    while True:
        result = _post('TradesHistory', {
            'start': start_ts,
            'ofs':   offset,
        })

        trades = result.get('trades', {})
        if not trades:
            break

        all_trades.extend(trades.values())
        count = result.get('count', 0)

        offset += 50
        if offset >= count:
            break

        # Rate limiting — Kraken allows ~1 req/sec on private endpoints
        time.sleep(1.2)

    return [_normalize_trade(t) for t in all_trades]


def _normalize_trade(trade: dict) -> dict:
    """Convert Kraken trade to FinHub trade format."""
    pair = trade.get('pair', '')

    # Parse coin from pair e.g. 'XXBTZUSD' -> 'BTC'
    coin = 'UNKNOWN'
    for kraken_code, clean in ASSET_MAP.items():
        if pair.startswith(kraken_code) and clean not in STABLE_ASSETS:
            coin = clean
            break
    if coin == 'UNKNOWN' and len(pair) > 3:
        coin = _clean_asset(pair[:4])

    trade_type = trade.get('type', 'buy').lower()
    direction  = 'long' if trade_type == 'buy' else 'short'

    price = float(trade.get('price', 0))
    vol   = float(trade.get('vol',   0))
    cost  = float(trade.get('cost',  0))
    fee   = float(trade.get('fee',   0))

    ts = trade.get('time', 0)
    try:
        dt   = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        date = dt.strftime('%Y-%m-%d')
    except Exception:
        date = datetime.now().strftime('%Y-%m-%d')

    trade_id = trade.get('ordertxid', '') + '_' + trade.get('postxid', '')

    return {
        'external_id':   trade_id,
        'coin':          coin,
        'direction':     direction,
        'entry_price':   price,
        'position_size': vol,
        'fees':          fee,
        'entry_date':    date,
        'status':        'closed' if trade_type == 'sell' else 'open',
        'source':        'kraken_api',
        'reason':        f"Kraken {trade_type}",
        'notes':         f"Pair: {pair} · Cost: ${cost:.2f}",
        'strategy':      'general',
    }


# ─────────────────────────────────────────
#  OPEN POSITIONS
# ─────────────────────────────────────────

def get_positions() -> list:
    """Return open margin positions from Kraken."""
    try:
        result = _post('OpenPositions', {'docalcs': 'true'})
        out    = []
        for pos_id, pos in result.items():
            pair  = pos.get('pair', '')
            coin  = _clean_asset(pair[:4]) if pair else 'UNKNOWN'
            ptype = pos.get('type', 'buy')
            out.append({
                'external_id': pos_id,
                'coin':        coin,
                'direction':   'long' if ptype == 'buy' else 'short',
                'size':        float(pos.get('vol', 0)),
                'cost':        float(pos.get('cost', 0)),
                'pnl':         float(pos.get('net', 0)),
                'source':      'kraken_api',
            })
        return out
    except Exception:
        return []  # No open positions or margin not enabled


# ─────────────────────────────────────────
#  MAIN SYNC
# ─────────────────────────────────────────

def sync_kraken():
    """
    Called by scheduler every 5 minutes.
    Imports new trades into trades table.
    """
    from backend.models.database import get_db
    from backend.services.ingestion.deduplicator import (
        find_duplicate_trade, log_ingestion
    )

    db       = get_db()
    imported = 0
    errors   = 0

    try:
        trades = get_trades_history(lookback_days=90)

        for trade in trades:
            ext_id = trade['external_id']

            existing = find_duplicate_trade(db, external_id=ext_id)
            if existing:
                log_ingestion(db, 'kraken', 'duplicate', 'trade',
                              external_id=ext_id,
                              message=f"Trade {ext_id[:20]} already exists")
                continue

            try:
                db.execute('''
                    INSERT OR IGNORE INTO trades
                        (coin, direction, entry_price, position_size, entry_date,
                         status, reason, notes, strategy, source, external_id, fees)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ''', (
                    trade['coin'],
                    trade['direction'],
                    trade['entry_price'],
                    trade['position_size'],
                    trade['entry_date'],
                    trade['status'],
                    trade['reason'],
                    trade['notes'],
                    trade['strategy'],
                    trade['source'],
                    trade['external_id'],
                    trade['fees'],
                ))
                db.commit()
                imported += 1
                log_ingestion(db, 'kraken', 'success', 'trade',
                              external_id=ext_id,
                              message=f"{trade['coin']} {trade['direction']} "
                                      f"@ ${trade['entry_price']}")
            except Exception as e:
                errors += 1
                log_ingestion(db, 'kraken', 'error', 'trade',
                              external_id=ext_id, message=str(e))

        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, records_imported, updated_at)
            VALUES ('kraken', datetime('now'), 'success', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'success',
                records_imported = records_imported + ?,
                error_message    = NULL,
                updated_at       = datetime('now')
        ''', (imported, imported))
        db.commit()

        if imported > 0:
            print(f"[kraken] Imported {imported} new trades")

    except Exception as e:
        error_msg = str(e)[:500]
        db.execute('''
            INSERT INTO connections
                (service, last_sync_at, last_sync_status, error_message, updated_at)
            VALUES ('kraken', datetime('now'), 'error', ?, datetime('now'))
            ON CONFLICT(service) DO UPDATE SET
                last_sync_at     = datetime('now'),
                last_sync_status = 'error',
                error_message    = ?,
                updated_at       = datetime('now')
        ''', (error_msg, error_msg))
        db.commit()
        print(f"[kraken] Sync error: {error_msg}")
        raise

    finally:
        db.close()

    return {'imported': imported, 'errors': errors}