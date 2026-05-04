"""
backend/routes/market_sentiment.py
Fear & Greed Index (Alternative.me) + CoinGecko trending coins.

No API keys required for either endpoint.
Fear & Greed: https://api.alternative.me/fng/
CoinGecko trending: uses existing CoinGecko service
"""
import time
import requests
from flask import Blueprint, jsonify

sentiment_bp = Blueprint('sentiment', __name__)

# Simple in-memory cache — F&G only updates once per day
_fng_cache: dict = {}
_fng_cache_ts: float = 0
FNG_CACHE_TTL = 300  # 5 minutes

_trending_cache: dict = {}
_trending_cache_ts: float = 0
TRENDING_CACHE_TTL = 600  # 10 minutes


# ─────────────────────────────────────────
#  FEAR & GREED INDEX
# ─────────────────────────────────────────

@sentiment_bp.route('/fear-greed', methods=['GET'])
def fear_greed():
    """
    Current + 7-day history of the Crypto Fear & Greed Index.
    Source: Alternative.me (free, no auth)
    Returns: { current, history: [...] }
    """
    global _fng_cache, _fng_cache_ts

    now = time.time()
    if _fng_cache and (now - _fng_cache_ts) < FNG_CACHE_TTL:
        return jsonify(_fng_cache)

    try:
        resp = requests.get(
            'https://api.alternative.me/fng/',
            params={'limit': 8, 'format': 'json'},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json().get('data', [])

        if not data:
            return jsonify({'error': 'No data returned'}), 503

        def _parse(entry: dict) -> dict:
            val   = int(entry.get('value', 0))
            label = entry.get('value_classification', '')
            ts    = int(entry.get('timestamp', 0))
            return {
                'value':     val,
                'label':     label,
                'timestamp': ts,
                'color':     _fng_color(val),
                'emoji':     _fng_emoji(val),
            }

        current = _parse(data[0])
        history = [_parse(d) for d in data[1:]]

        result = {
            'current': current,
            'history': history,
            'source':  'alternative.me',
        }

        _fng_cache    = result
        _fng_cache_ts = now
        return jsonify(result)

    except requests.RequestException as e:
        # Return cached data if available even if stale
        if _fng_cache:
            return jsonify({**_fng_cache, 'stale': True})
        return jsonify({'error': str(e)}), 503


def _fng_color(val: int) -> str:
    if val <= 24:  return '#e03040'   # Extreme Fear — red
    if val <= 44:  return '#ff9f43'   # Fear — orange
    if val <= 55:  return '#ffd32a'   # Neutral — yellow
    if val <= 75:  return '#00a854'   # Greed — green
    return '#00d2ff'                  # Extreme Greed — cyan


def _fng_emoji(val: int) -> str:
    if val <= 24:  return '😱'
    if val <= 44:  return '😰'
    if val <= 55:  return '😐'
    if val <= 75:  return '😏'
    return '🤑'


# ─────────────────────────────────────────
#  TRENDING COINS (CoinGecko)
# ─────────────────────────────────────────

@sentiment_bp.route('/trending', methods=['GET'])
def trending():
    """
    Top trending coins from CoinGecko + Reddit mention counts.
    """
    global _trending_cache, _trending_cache_ts

    now = time.time()
    if _trending_cache and (now - _trending_cache_ts) < TRENDING_CACHE_TTL:
        return jsonify(_trending_cache)

    try:
        from backend.services.coingecko import _get

        data, err = _get('/search/trending')
        if err or not data:
            return jsonify({'error': err or 'No data'}), 503

        coins = []
        for item in data.get('coins', [])[:10]:
            coin = item.get('item', {})
            coins.append({
                'id':       coin.get('id', ''),
                'name':     coin.get('name', ''),
                'symbol':   coin.get('symbol', '').upper(),
                'rank':     coin.get('market_cap_rank'),
                'thumb':    coin.get('thumb', ''),
                'price_btc':coin.get('price_btc', 0),
                'score':    coin.get('score', 0),
                'data':     coin.get('data', {}),
            })

        # Enrich with Reddit mention counts
        mention_map = _get_reddit_mentions([c['symbol'] for c in coins])
        for coin in coins:
            coin['reddit_mentions'] = mention_map.get(coin['symbol'], 0)
            coin['trending_score']  = coin['score'] + (coin['reddit_mentions'] * 0.1)

        coins.sort(key=lambda x: x['trending_score'], reverse=True)

        result = {
            'coins':   coins,
            'source':  'CoinGecko + Reddit',
            'updated': int(now),
        }

        _trending_cache    = result
        _trending_cache_ts = now
        return jsonify(result)

    except Exception as e:
        if _trending_cache:
            return jsonify({**_trending_cache, 'stale': True})
        return jsonify({'error': str(e)}), 503


def _get_reddit_mentions(symbols: list[str]) -> dict[str, int]:
    """
    Count how many times each coin symbol appears in recent Reddit posts.
    Uses the existing news service Reddit fetcher.
    """
    mention_map = {s: 0 for s in symbols}
    try:
        from backend.services.news import fetch_reddit_posts
        posts = fetch_reddit_posts(limit=100)
        for post in posts:
            title = (post.get('title', '') + ' ' + post.get('body', '')).upper()
            for symbol in symbols:
                if symbol in title:
                    mention_map[symbol] += 1
    except Exception:
        pass
    return mention_map
