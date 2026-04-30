"""
backend/services/news.py — Stage 3b
Tuned Reddit noise filters, weight customization support,
meme/comedy blocklist, higher upvote floors for high-volume subs.
"""
import time
import re
import math
from datetime import datetime, timezone, timedelta

_news_cache = {}
CACHE_TTL = 180

# ─────────────────────────────────────────
#  SOURCE REGISTRY
# ─────────────────────────────────────────

RSS_FEEDS = [
    {'name': 'CoinDesk',         'url': 'https://www.coindesk.com/arc/outboundfeeds/rss/',   'color': '#ff7043', 'type': 'news',     'level': 'intermediate'},
    {'name': 'CoinTelegraph',    'url': 'https://cointelegraph.com/rss',                     'color': '#00bcd4', 'type': 'news',     'level': 'intermediate'},
    {'name': 'Decrypt',          'url': 'https://decrypt.co/feed',                           'color': '#7c4dff', 'type': 'news',     'level': 'beginner'},
    {'name': 'Bitcoin Magazine', 'url': 'https://bitcoinmagazine.com/feed',                  'color': '#f7931a', 'type': 'news',     'level': 'intermediate'},
    {'name': 'The Block',        'url': 'https://www.theblock.co/rss.xml',                   'color': '#00e676', 'type': 'news',     'level': 'advanced'},
    {'name': 'Bankless',         'url': 'https://banklesshq.com/rss',                        'color': '#6c63ff', 'type': 'opinion',  'level': 'intermediate'},
    {'name': 'Investing.com',    'url': 'https://www.investing.com/rss/news.rss',            'color': '#ff9800', 'type': 'news',     'level': 'intermediate'},
]

# upvote_floor = minimum score to include
# High-volume subs need higher floors to filter noise
REDDIT_SOURCES = [
    {'name': 'r/CryptoCurrency', 'url': 'https://www.reddit.com/r/CryptoCurrency/hot.json?limit=25', 'color': '#ff4500', 'type': 'social', 'level': 'beginner',      'upvote_floor': 150},
    {'name': 'r/CryptoMarkets',  'url': 'https://www.reddit.com/r/CryptoMarkets/hot.json?limit=15',  'color': '#ff6534', 'type': 'social', 'level': 'intermediate',   'upvote_floor': 50},
    {'name': 'r/Bitcoin',        'url': 'https://www.reddit.com/r/Bitcoin/hot.json?limit=15',        'color': '#f7931a', 'type': 'social', 'level': 'beginner',       'upvote_floor': 100},
    {'name': 'r/ethfinance',     'url': 'https://www.reddit.com/r/ethfinance/hot.json?limit=10',     'color': '#627eea', 'type': 'social', 'level': 'intermediate',   'upvote_floor': 30},
    {'name': 'r/investing',      'url': 'https://www.reddit.com/r/investing/hot.json?limit=15',      'color': '#5f99cf', 'type': 'social', 'level': 'beginner',       'upvote_floor': 75},
    {'name': 'r/stocks',         'url': 'https://www.reddit.com/r/stocks/hot.json?limit=10',         'color': '#46d160', 'type': 'social', 'level': 'beginner',       'upvote_floor': 50},
    {'name': 'r/wallstreetbets', 'url': 'https://www.reddit.com/r/wallstreetbets/hot.json?limit=10', 'color': '#ff0000', 'type': 'social', 'level': 'beginner',       'upvote_floor': 500},  # Very high — only genuine buzz
    {'name': 'r/SecurityAnalysis','url': 'https://www.reddit.com/r/SecurityAnalysis/hot.json?limit=8','color': '#90caf9','type': 'analysis','level': 'intermediate',  'upvote_floor': 20},
]

YOUTUBE_SOURCES = [
    {'name': 'Coin Bureau',    'channel_id': 'UCqK_GSMbpiV8spgD3ZGloSw', 'color': '#ff0000', 'type': 'education', 'level': 'beginner'},
    {'name': 'Benjamin Cowen', 'channel_id': 'UCRvqjQPSeaWn-uEx-w0XOIg', 'color': '#ff0000', 'type': 'analysis',  'level': 'intermediate'},
    {'name': 'InvestAnswers',  'channel_id': 'UCnFHtfMV0SYFDWMlMXyxCpw', 'color': '#ff0000', 'type': 'analysis',  'level': 'beginner'},
    {'name': 'Altcoin Daily',  'channel_id': 'UCbLhGKVY-bJPcawebgtNfbw', 'color': '#ff0000', 'type': 'news',      'level': 'beginner'},
    {'name': 'Real Vision',    'channel_id': 'UCBMH0K3pTa1RNVJK6RMjrgw', 'color': '#1a1a2e', 'type': 'analysis',  'level': 'advanced'},
]

# Meme/noise blocklist — titles containing these are dropped regardless of upvotes
NOISE_TITLE_PATTERNS = [
    r'\bwhen (moon|lambo|rich)\b',
    r'\b(lol|lmao|lmfao|rofl)\b',
    r'\bgm\b',  # "good morning" posts
    r'\b(meme|memes|dank|based|cope|seethe)\b',
    r'\bjust (bought|sold|yolo)\b',
    r'\b(wen|ser|ngmi|wagmi|gm|gn)\b',
    r'daily discussion',
    r'weekly thread',
    r'megathread',
    r'\bshitpost\b',
    r'^[^a-z]*$',  # all caps / no letters
]
_noise_re = re.compile('|'.join(NOISE_TITLE_PATTERNS), re.IGNORECASE)

# ─────────────────────────────────────────
#  SENTIMENT
# ─────────────────────────────────────────

POSITIVE_WORDS = {
    'surge','surges','surging','rally','rallies','bullish','bull','breakout',
    'soar','gain','gains','rise','rises','pump','record','ath','buy','accumulate',
    'upgrade','growth','adoption','profit','recovery','rebound','support',
    'optimism','momentum','strong','launch','approved','institutional','inflow',
    'opportunity','milestone','partnership','integration','outperform','bottom',
    'buy the dip','accumulation',
}

NEGATIVE_WORDS = {
    'crash','crashes','bear','bearish','dump','fall','falls','drop','plunge',
    'loss','losses','sell','selloff','hack','exploit','fraud','scam','ban',
    'regulate','lawsuit','warning','risk','fear','panic','outflow','liquidation',
    'bankruptcy','collapse','investigation','fud','concern','weakness','decline',
    'correction','pullback','resistance','overbought','rejection','failed',
}

BEGINNER_SIGNALS = {
    'what is','how to','beginner','guide','explain','introduction','basics',
    'simple','start','learn','101','primer','understand','getting started',
    'new to','crypto basics','for dummies',
}

SWING_SIGNALS = {
    'swing','weekly','daily','support','resistance','breakout','trend',
    'moving average','rsi','macd','fibonacci','chart pattern','technical analysis',
    'ta','setup','entry','exit','target','stop loss','risk reward',
}

COIN_PATTERNS = {
    'bitcoin':         ['bitcoin','btc','satoshi','sats','lightning network'],
    'ethereum':        ['ethereum','eth','ether','vitalik','defi','erc-20','erc20'],
    'solana':          ['solana','sol'],
    'binancecoin':     ['binance','bnb','bsc'],
    'ripple':          ['ripple','xrp'],
    'cardano':         ['cardano','ada'],
    'avalanche-2':     ['avalanche','avax'],
    'chainlink':       ['chainlink','link'],
    'polkadot':        ['polkadot','dot'],
    'dogecoin':        ['dogecoin','doge'],
    'polygon':         ['polygon','matic','layer 2','l2'],
    'injective-protocol': ['injective','inj'],
    'SPY':             ['s&p 500','sp500','spy','index fund','voo'],
    'AAPL':            ['apple','aapl','tim cook','iphone'],
    'NVDA':            ['nvidia','nvda','jensen huang','gpu','ai chips'],
    'MSFT':            ['microsoft','msft','azure'],
}

# Default scoring weights — overridable by user settings
DEFAULT_WEIGHTS = {
    'recency':        40,
    'coin_relevance': 30,
    'strategy_align': 15,
    'level_match':    10,
    'content_type':    5,
}


def _get_weights(settings: dict) -> dict:
    """Merge user weight overrides with defaults. Total capped at 100."""
    weights = dict(DEFAULT_WEIGHTS)
    for key in DEFAULT_WEIGHTS:
        setting_key = f'news_weight_{key}'
        if setting_key in settings:
            try:
                weights[key] = int(settings[setting_key])
            except (ValueError, TypeError):
                pass
    # Normalize to sum=100
    total = sum(weights.values())
    if total != 100 and total > 0:
        factor = 100 / total
        weights = {k: round(v * factor, 1) for k, v in weights.items()}
    return weights


# ─────────────────────────────────────────
#  DATE HELPERS
# ─────────────────────────────────────────

def _parse_date(date_str):
    if not date_str:
        return datetime.now(timezone.utc)
    formats = [
        '%a, %d %b %Y %H:%M:%S %z','%a, %d %b %Y %H:%M:%S %Z',
        '%Y-%m-%dT%H:%M:%S%z','%Y-%m-%dT%H:%M:%SZ',
        '%Y-%m-%dT%H:%M:%S+00:00','%Y-%m-%d %H:%M:%S',
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            continue
    return datetime.now(timezone.utc)


def _age_hours(dt):
    now = datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, (now - dt).total_seconds() / 3600)


def _iso(dt):
    return dt.isoformat()


def score_sentiment(text):
    words = set(re.findall(r'\b\w+\b', text.lower()))
    pos = len(words & POSITIVE_WORDS)
    neg = len(words & NEGATIVE_WORDS)
    if pos > neg + 1: return 'positive'
    if neg > pos + 1: return 'negative'
    return 'neutral'


def extract_coins(text):
    lower = text.lower()
    return [cid for cid, pats in COIN_PATTERNS.items() if any(p in lower for p in pats)]


def _is_beginner_friendly(text):
    return any(s in text.lower() for s in BEGINNER_SIGNALS)


def _is_swing_relevant(text):
    return any(s in text.lower() for s in SWING_SIGNALS)


def _is_noise(title):
    return bool(_noise_re.search(title))


# ─────────────────────────────────────────
#  SCORING
# ─────────────────────────────────────────

def compute_relevance_score(article: dict, profile: dict, weights: dict = None) -> float:
    if weights is None:
        weights = DEFAULT_WEIGHTS

    text = (article.get('title','') + ' ' + article.get('summary','')).lower()
    score = 0.0
    age   = article.get('age_hours', 99)
    W     = weights

    # ── Recency ──────────────────────────────────────────────────────────────
    if age <= 1:       r = 1.0
    elif age <= 3:     r = 0.88
    elif age <= 6:     r = 0.70
    elif age <= 12:    r = 0.50
    elif age <= 24:    r = 0.30
    elif age <= 48:    r = 0.12
    else:              r = 0.0
    score += W['recency'] * r

    # ── Coin relevance ───────────────────────────────────────────────────────
    article_coins = set(article.get('coins', []))
    watched = set(profile.get('watched_coins', []))
    traded  = set(profile.get('traded_coins', []))
    traded_m  = len(article_coins & traded)
    watched_m = len(article_coins & (watched - traded))
    if traded_m:
        cr = min(1.0, 0.67 + traded_m * 0.17)
    elif watched_m:
        cr = min(0.83, 0.50 + watched_m * 0.17)
    elif article_coins:
        cr = 0.27
    else:
        cr = 0.0
    score += W['coin_relevance'] * cr

    # ── Strategy alignment ───────────────────────────────────────────────────
    style = profile.get('trade_style','swing')
    if style == 'swing' and _is_swing_relevant(text):                          sa = 1.0
    elif style == 'scalp' and any(w in text for w in ['scalp','intraday','1h','4h']): sa = 1.0
    elif style == 'position' and any(w in text for w in ['long term','hodl','macro']): sa = 1.0
    elif _is_swing_relevant(text):                                              sa = 0.33
    else:                                                                       sa = 0.0
    score += W['strategy_align'] * sa

    # ── Level match ──────────────────────────────────────────────────────────
    user_level = profile.get('prefer_level','beginner')
    art_level  = article.get('source_level','intermediate')
    order      = ['beginner','intermediate','advanced']
    u_idx = order.index(user_level) if user_level in order else 0
    a_idx = order.index(art_level)  if art_level  in order else 1
    if _is_beginner_friendly(text) and user_level == 'beginner': lm = 1.0
    elif abs(u_idx - a_idx) == 0:  lm = 0.8
    elif abs(u_idx - a_idx) == 1:  lm = 0.4
    else:                           lm = 0.0
    score += W['level_match'] * lm

    # ── Content type ─────────────────────────────────────────────────────────
    art_type = article.get('source_type','news')
    capital  = profile.get('capital', 350)
    if art_type == 'education':                                       ct = 1.0
    elif art_type == 'social' and user_level == 'beginner':           ct = 0.8
    elif art_type == 'analysis' and user_level in ('intermediate','advanced'): ct = 0.8
    elif art_type in ('news','opinion'):                               ct = 0.4
    else:                                                              ct = 0.2
    if capital < 500 and any(w in text for w in ['institutional','hedge fund','derivatives']): ct -= 0.3
    score += W['content_type'] * max(0, ct)

    return round(min(100, max(0, score)), 1)


# ─────────────────────────────────────────
#  PROFILE BUILDER
# ─────────────────────────────────────────

def build_user_profile(db) -> dict:
    settings_rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}

    capital  = float(settings.get('starting_capital', 350))
    risk_pct = float(settings.get('risk_per_trade_pct', 2))
    style    = settings.get('preferred_trade_duration','swing')

    risk_level = 'low' if risk_pct <= 1 else 'high' if risk_pct > 3 else 'medium'

    trade_count = db.execute(
        "SELECT COUNT(*) as c FROM trades WHERE status='closed'"
    ).fetchone()['c']

    prefer_level = ('beginner'     if trade_count < 10 or capital < 500 else
                    'intermediate' if trade_count < 50 or capital < 2000 else
                    'advanced')

    watched = [r['coin_id'] for r in db.execute('SELECT coin_id FROM watchlist').fetchall()]
    stock_tickers = [r['ticker'] for r in db.execute('SELECT ticker FROM stock_watchlist').fetchall()]

    traded_rows = db.execute(
        "SELECT DISTINCT coin FROM trades WHERE entry_date >= date('now', '-90 days')"
    ).fetchall()
    symbol_map = {
        'btc':'bitcoin','eth':'ethereum','sol':'solana','avax':'avalanche-2',
        'link':'chainlink','ada':'cardano','dot':'polkadot','doge':'dogecoin',
        'matic':'polygon','inj':'injective-protocol','bnb':'binancecoin','xrp':'ripple',
    }
    traded_coins = [symbol_map.get(r['coin'].lower(), r['coin'].lower()) for r in traded_rows]

    weights = _get_weights(settings)

    return {
        'watched_coins': list(set(watched + stock_tickers)),
        'traded_coins':  list(set(traded_coins)),
        'trade_style':   style,
        'risk_level':    risk_level,
        'risk_pct':      risk_pct,
        'capital':       capital,
        'prefer_level':  prefer_level,
        'trade_count':   trade_count,
        'weights':       weights,
        'settings':      settings,
    }


# ─────────────────────────────────────────
#  FETCHERS
# ─────────────────────────────────────────

def _fetch_rss(feed_meta):
    try:
        import feedparser
        feed = feedparser.parse(feed_meta['url'], request_headers={'User-Agent': 'FinHub/3.0'})
        if getattr(feed, 'bozo', False) and not feed.entries:
            return []

        out  = []
        for entry in feed.entries[:25]:
            title   = getattr(entry, 'title',   '') or ''
            summary = getattr(entry, 'summary', '') or ''
            link    = getattr(entry, 'link',    '') or ''
            dt      = _parse_date(getattr(entry, 'published', ''))
            text    = f"{title} {summary}"
            out.append({
                'id':           f"rss_{feed_meta['name']}_{hash(link)&0xFFFFFF}",
                'title':        title[:200],
                'summary':      re.sub(r'<[^>]+>','',summary)[:300],
                'link':         link,
                'source':       feed_meta['name'],
                'source_type':  feed_meta['type'],
                'source_level': feed_meta['level'],
                'color':        feed_meta['color'],
                'date':         _iso(dt),
                'age_hours':    _age_hours(dt),
                'sentiment':    score_sentiment(text),
                'coins':        extract_coins(text),
                'media_type':   'article',
                'upvotes':      None,
            })
        return out
    except Exception:
        return []


def _fetch_reddit(source):
    try:
        import requests
        floor   = source.get('upvote_floor', 50)
        headers = {'User-Agent': 'FinHub/3.0 (personal finance app; contact via github)'}
        resp    = requests.get(source['url'], headers=headers, timeout=(5, 10))
        if resp.status_code != 200:
            return []
        posts = resp.json().get('data',{}).get('children',[])
        out   = []
        for post in posts:
            p       = post.get('data',{})
            title   = p.get('title','')
            selftext= p.get('selftext','')[:300]
            score   = p.get('score', 0)
            created = p.get('created_utc', 0)
            flair   = (p.get('link_flair_text','') or '').lower()

            if not title or title in ('[removed]','[deleted]'):
                continue
            if score < floor:
                continue
            if flair in ('meme','comedy','humour','satire','shitpost','daily','weekly'):
                continue
            if _is_noise(title):
                continue

            dt   = datetime.fromtimestamp(created, tz=timezone.utc) if created else datetime.now(timezone.utc)
            text = f"{title} {selftext}"
            out.append({
                'id':           f"reddit_{p.get('id','')}",
                'title':        title[:200],
                'summary':      selftext or f"Trending on {source['name']} ({score:,} upvotes)",
                'link':         'https://reddit.com' + p.get('permalink',''),
                'source':       source['name'],
                'source_type':  source['type'],
                'source_level': source['level'],
                'color':        source['color'],
                'date':         _iso(dt),
                'age_hours':    _age_hours(dt),
                'sentiment':    score_sentiment(text),
                'coins':        extract_coins(text),
                'media_type':   'reddit',
                'upvotes':      score,
                'num_comments': p.get('num_comments',0),
                'flair':        p.get('link_flair_text',''),
            })
        return out
    except Exception:
        return []


def _fetch_youtube(source):
    try:
        import feedparser
        url  = f"https://www.youtube.com/feeds/videos.xml?channel_id={source['channel_id']}"
        feed = feedparser.parse(url)
        out  = []
        for entry in feed.entries[:8]:
            title   = getattr(entry,'title','') or ''
            link    = getattr(entry,'link', '') or ''
            summary = getattr(entry,'summary','') or ''
            dt      = _parse_date(getattr(entry,'published',''))
            if _age_hours(dt) > 168:
                continue
            text = f"{title} {summary}"
            out.append({
                'id':           f"yt_{source['channel_id']}_{hash(link)&0xFFFFFF}",
                'title':        title[:200],
                'summary':      re.sub(r'<[^>]+>','',summary)[:200] or f"New video from {source['name']}",
                'link':         link,
                'source':       source['name'],
                'source_type':  source['type'],
                'source_level': source['level'],
                'color':        '#ff0000',
                'date':         _iso(dt),
                'age_hours':    _age_hours(dt),
                'sentiment':    score_sentiment(text),
                'coins':        extract_coins(text),
                'media_type':   'video',
                'upvotes':      None,
            })
        return out
    except Exception:
        return []


# ─────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────

def fetch_news(coin_filter=None, limit=60, profile=None, source_types=None):
    cache_key = f"news_{coin_filter}_{limit}_{str(source_types)}_{hash(str((profile or {}).get('weights',{})))}"
    now = time.time()
    if cache_key in _news_cache:
        data, ts = _news_cache[cache_key]
        if now - ts < CACHE_TTL:
            return data, None

    profile = profile or {}
    weights = profile.get('weights', DEFAULT_WEIGHTS)
    all_articles = []

    for feed in RSS_FEEDS:
        if source_types and feed['type'] not in source_types:
            continue
        all_articles.extend(_fetch_rss(feed))

    for source in REDDIT_SOURCES:
        if source_types and source['type'] not in source_types:
            continue
        all_articles.extend(_fetch_reddit(source))

    if not source_types or any(t in source_types for t in ('education','analysis')):
        for source in YOUTUBE_SOURCES:
            if source_types and source['type'] not in source_types:
                continue
            all_articles.extend(_fetch_youtube(source))

    if coin_filter:
        all_articles = [a for a in all_articles if coin_filter in a.get('coins',[])]

    all_articles = _deduplicate(all_articles)
    all_articles = [a for a in all_articles if a.get('age_hours',0) <= 72]

    for article in all_articles:
        article['relevance_score'] = compute_relevance_score(article, profile, weights)

    all_articles.sort(key=lambda x: (-x.get('relevance_score',0), x.get('age_hours',99)))

    result = all_articles[:limit]
    _news_cache[cache_key] = (result, now)
    return result, None


def _deduplicate(articles):
    seen_titles, seen_ids, unique = [], set(), []
    for a in articles:
        aid = a.get('id','')
        if aid and aid in seen_ids:
            continue
        title = re.sub(r'[^a-z0-9 ]','', a.get('title','').lower())
        words = set(title.split())
        is_dup = any(
            len(words & s) / max(len(words | s), 1) > 0.6
            for s in seen_titles
        )
        if not is_dup:
            unique.append(a)
            seen_titles.append(words)
            if aid:
                seen_ids.add(aid)
    return unique


def get_sentiment_summary(articles):
    counts = {'positive':0,'negative':0,'neutral':0}
    for a in articles:
        counts[a.get('sentiment','neutral')] += 1
    counts['total'] = len(articles)
    counts['score'] = round(
        (counts['positive'] - counts['negative']) / counts['total'] * 100, 1
    ) if counts['total'] else 0
    return counts