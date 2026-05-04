"""
backend/services/coingecko.py
Handles all CoinGecko API interactions with in-memory caching
to avoid rate limits on the free tier (30 calls/min).
"""
import requests
import time
import os

COINGECKO_BASE = 'https://api.coingecko.com/api/v3'
CACHE_TTL = 60  # seconds — free tier allows ~30 req/min, so cache aggressively

_cache = {}

def _get(endpoint, params=None):
    """Cached GET against CoinGecko. Returns (data, error_string)."""
    cache_key = endpoint + str(sorted((params or {}).items()))
    now = time.time()

    if cache_key in _cache:
        data, ts = _cache[cache_key]
        if now - ts < CACHE_TTL:
            return data, None

    headers = {}
    api_key = os.environ.get('COINGECKO_API_KEY')
    if api_key:
        headers['x-cg-demo-api-key'] = api_key

    try:
        url = COINGECKO_BASE + endpoint
        resp = requests.get(url, params=params, headers=headers, timeout=10)

        if resp.status_code == 429:
            # Rate limited — return stale cache if available
            if cache_key in _cache:
                return _cache[cache_key][0], None
            return None, 'Rate limited by CoinGecko. Try again in a moment.'

        resp.raise_for_status()
        data = resp.json()
        _cache[cache_key] = (data, now)
        return data, None

    except requests.exceptions.Timeout:
        return None, 'CoinGecko request timed out.'
    except requests.exceptions.ConnectionError:
        return None, 'Cannot reach CoinGecko. Check your internet connection.'
    except Exception as e:
        # Return stale cache on any error rather than failing hard
        if cache_key in _cache:
            return _cache[cache_key][0], None
        return None, str(e)


def get_prices(coin_ids: list, vs_currency='usd'):
    """
    Fetch current price, 24h change, 7d change, market cap, volume.
    coin_ids: list of CoinGecko IDs e.g. ['bitcoin', 'ethereum']
    """
    if not coin_ids:
        return {}, None

    data, err = _get('/coins/markets', params={
        'vs_currency': vs_currency,
        'ids': ','.join(coin_ids),
        'order': 'market_cap_desc',
        'per_page': 250,
        'page': 1,
        'sparkline': False,
        'price_change_percentage': '24h,7d'
    })

    if err:
        return {}, err

    result = {}
    for coin in (data or []):
        cid = coin['id']
        pct_24h = coin.get('price_change_percentage_24h') or 0
        pct_7d = coin.get('price_change_percentage_7d_in_currency') or 0

        result[cid] = {
            'id': cid,
            'symbol': (coin.get('symbol') or '').upper(),
            'name': coin.get('name', ''),
            'image': coin.get('image', ''),
            'price': coin.get('current_price') or 0,
            'market_cap': coin.get('market_cap') or 0,
            'volume_24h': coin.get('total_volume') or 0,
            'change_24h': round(pct_24h, 2),
            'change_7d': round(pct_7d, 2),
            'high_24h': coin.get('high_24h') or 0,
            'low_24h': coin.get('low_24h') or 0,
            # Momentum: based on 7d trend direction
            'momentum': 'up' if pct_7d > 1 else 'down' if pct_7d < -1 else 'neutral',
            # Alert flags
            'alert_24h': abs(pct_24h) >= 5,
            'alert_direction': 'up' if pct_24h >= 5 else 'down' if pct_24h <= -5 else None,
        }

    return result, None


def search_coins(query: str):
    """Search CoinGecko for coin IDs matching a query string."""
    data, err = _get('/search', params={'query': query})
    if err:
        return [], err

    coins = (data or {}).get('coins', [])[:20]
    return [
        {
            'id': c['id'],
            'symbol': c['symbol'].upper(),
            'name': c['name'],
            'market_cap_rank': c.get('market_cap_rank'),
            'thumb': c.get('thumb', '')
        }
        for c in coins
    ], None


def get_top_coins(limit=50):
    """Fetch top N coins by market cap."""
    data, err = _get('/coins/markets', params={
        'vs_currency': 'usd',
        'order': 'market_cap_desc',
        'per_page': limit,
        'page': 1,
        'sparkline': False,
        'price_change_percentage': '24h,7d'
    })

    if err:
        return [], err

    result = []
    for coin in (data or []):
        pct_24h = coin.get('price_change_percentage_24h') or 0
        pct_7d = coin.get('price_change_percentage_7d_in_currency') or 0
        result.append({
            'id': coin['id'],
            'symbol': (coin.get('symbol') or '').upper(),
            'name': coin.get('name', ''),
            'image': coin.get('image', ''),
            'price': coin.get('current_price') or 0,
            'market_cap': coin.get('market_cap') or 0,
            'market_cap_rank': coin.get('market_cap_rank') or 0,
            'volume_24h': coin.get('total_volume') or 0,
            'change_24h': round(pct_24h, 2),
            'change_7d': round(pct_7d, 2),
            'high_24h': coin.get('high_24h') or 0,
            'low_24h': coin.get('low_24h') or 0,
            'momentum': 'up' if pct_7d > 1 else 'down' if pct_7d < -1 else 'neutral',
            'alert_24h': abs(pct_24h) >= 5,
            'alert_direction': 'up' if pct_24h >= 5 else 'down' if pct_24h <= -5 else None,
        })

    return result, None


def clear_cache():
    """Manually bust the price cache (called from settings)."""
    global _cache
    _cache = {}