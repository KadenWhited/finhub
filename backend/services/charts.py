"""
backend/services/charts.py
Fetches time-series price data for charts.
  - Crypto: CoinGecko market_chart endpoint
  - Stocks: yfinance
"""
import time
import os
import requests

COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
_chart_cache = {}
CACHE_TTL = 120  # 2 min cache for chart data


def _cg_headers():
    h = {}
    key = os.environ.get('COINGECKO_API_KEY')
    if key:
        h['x-cg-demo-api-key'] = key
    return h


def _cached(key, ttl=CACHE_TTL):
    if key in _chart_cache:
        data, ts = _chart_cache[key]
        if time.time() - ts < ttl:
            return data
    return None


def _store(key, data):
    _chart_cache[key] = (data, time.time())
    return data


# ─────────────────────────────────────────
#  CRYPTO CHARTS  (CoinGecko)
# ─────────────────────────────────────────

# Map our UI filter -> CoinGecko (days param, interval hint)
CRYPTO_RANGE_MAP = {
    '6h':   {'days': '1',   'label': '6h'},
    '1d':   {'days': '1',   'label': '1d'},
    '1w':   {'days': '7',   'label': '1w'},
    '1m':   {'days': '30',  'label': '1m'},
    '3m':   {'days': '90',  'label': '3m'},
    '6m':   {'days': '180', 'label': '6m'},
    '1y':   {'days': '365', 'label': '1y'},
    'all':  {'days': '365', 'label': 'All'},  # cap at 365 — 'max' needs paid plan
}


def get_crypto_chart(coin_id: str, range_key: str = '1m'):
    cfg = CRYPTO_RANGE_MAP.get(range_key, CRYPTO_RANGE_MAP['1m'])
    cache_key = f'crypto_chart_{coin_id}_{range_key}'

    cached = _cached(cache_key)
    if cached:
        return cached, None

    try:
        resp = requests.get(
            f'{COINGECKO_BASE}/coins/{coin_id}/market_chart',
            params={'vs_currency': 'usd', 'days': cfg['days']},
            headers=_cg_headers(),
            timeout=12
        )
        if resp.status_code == 429:
            return _cached(cache_key) or None, 'Rate limited — try again shortly'
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        return None, str(e)

    prices = raw.get('prices', [])  # [[timestamp_ms, price], ...]

    # For 6h: slice last 6 hours from the 1d response
    if range_key == '6h' and prices:
        cutoff = (time.time() - 6 * 3600) * 1000
        prices = [p for p in prices if p[0] >= cutoff]

    points = [{'t': p[0], 'v': p[1]} for p in prices]
    result = {'coin_id': coin_id, 'range': range_key, 'points': points, 'currency': 'usd'}
    return _store(cache_key, result), None


# ─────────────────────────────────────────
#  STOCK CHARTS  (yfinance)
# ─────────────────────────────────────────

STOCK_RANGE_MAP = {
    '6h':  {'period': '1d',  'interval': '5m'},
    '1d':  {'period': '1d',  'interval': '5m'},
    '1w':  {'period': '5d',  'interval': '1h'},
    '1m':  {'period': '1mo', 'interval': '1d'},
    '3m':  {'period': '3mo', 'interval': '1d'},
    '6m':  {'period': '6mo', 'interval': '1d'},
    '1y':  {'period': '1y',  'interval': '1wk'},
    'all': {'period': 'max', 'interval': '1mo'},
}


def get_stock_chart(ticker: str, range_key: str = '1m'):
    cache_key = f'stock_chart_{ticker}_{range_key}'
    cached = _cached(cache_key, ttl=300)  # 5 min cache for stocks
    if cached:
        return cached, None

    try:
        import yfinance as yf
        cfg = STOCK_RANGE_MAP.get(range_key, STOCK_RANGE_MAP['1m'])
        hist = yf.Ticker(ticker).history(period=cfg['period'], interval=cfg['interval'])

        if hist.empty:
            return None, f'No data for {ticker}'

        points = []
        for ts, row in hist.iterrows():
            # Convert pandas Timestamp to milliseconds
            t_ms = int(ts.timestamp() * 1000)
            points.append({'t': t_ms, 'v': round(float(row['Close']), 4)})

        # For 6h: slice last 6h
        if range_key == '6h' and points:
            cutoff = (time.time() - 6 * 3600) * 1000
            points = [p for p in points if p['t'] >= cutoff]

        result = {'ticker': ticker.upper(), 'range': range_key, 'points': points, 'currency': 'usd'}
        return _store(cache_key, result), None

    except ImportError:
        return None, 'yfinance not installed. Run: pip install yfinance'
    except Exception as e:
        return None, str(e)


def get_stock_quote(ticker: str):
    """Current price + day change for a stock ticker."""
    cache_key = f'stock_quote_{ticker}'
    cached = _cached(cache_key, ttl=60)
    if cached:
        return cached, None

    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.fast_info

        price = getattr(info, 'last_price', None)
        prev_close = getattr(info, 'previous_close', None)
        market_cap = getattr(info, 'market_cap', None)

        if not price:
            hist = t.history(period='2d', interval='1d')
            if not hist.empty:
                price = float(hist['Close'].iloc[-1])
                prev_close = float(hist['Close'].iloc[-2]) if len(hist) > 1 else price

        change_pct = round(((price - prev_close) / prev_close) * 100, 2) if price and prev_close else 0
        change_amt = round(price - prev_close, 4) if price and prev_close else 0

        result = {
            'ticker': ticker.upper(),
            'price': round(price, 4) if price else None,
            'change_pct': change_pct,
            'change_amt': change_amt,
            'market_cap': market_cap,
            'prev_close': round(prev_close, 4) if prev_close else None,
        }
        return _store(cache_key, result), None

    except ImportError:
        return None, 'yfinance not installed'
    except Exception as e:
        return None, str(e)
