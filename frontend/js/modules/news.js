let _newsRefreshTimer = null;
let _newsCoinFilter   = null;
let _newsTypeFilter   = null; // null = all, or comma-separated types
let _newsData         = null;
let _userProfile      = null;

const SOURCE_TYPE_FILTERS = [
  { id: null,        label: 'All' },
  { id: 'news',      label: '📰 News' },
  { id: 'social',    label: '💬 Reddit' },
  { id: 'education', label: '🎓 Education' },
  { id: 'analysis',  label: '📊 Analysis' },
  { id: 'opinion',   label: '🎙 Opinion' },
];

async function renderNews() {
  const el = document.getElementById('page-news');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">News & Sentiment</div>
        <div class="page-subtitle">Personalized feed — news, Reddit, YouTube, analysis</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span id="news-refresh-time" style="font-size:0.68rem;color:var(--text-3)"></span>
        <button class="btn btn-ghost btn-sm" onclick="refreshNews()">↻ Refresh</button>
      </div>
    </div>

    <!-- Sentiment bar -->
    <div id="news-sentiment-bar" style="margin-bottom:16px"></div>

    <!-- Personalization badge -->
    <div id="news-profile-badge" style="margin-bottom:14px"></div>

    <!-- Source type filter -->
    <div class="news-type-filters" style="margin-bottom:12px">
      ${SOURCE_TYPE_FILTERS.map(f => `
        <button class="news-filter-pill ${_newsTypeFilter === f.id ? 'active' : ''}"
          onclick="setNewsTypeFilter(${f.id === null ? 'null' : `'${f.id}'`})">${f.label}</button>
      `).join('')}
    </div>

    <!-- Coin filter pills -->
    <div id="news-coin-filters" style="margin-bottom:16px"></div>

    <!-- Feed -->
    <div id="news-feed">${loadingHtml('Fetching personalized feed')}</div>
  `;

  await loadNews();
  _startNewsRefresh();
}

async function loadNews() {
  const feed = document.getElementById('news-feed');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15s timeout
    let url = '/news/?limit=80';
    if (_newsCoinFilter) url += `&coin=${_newsCoinFilter}`;
    if (_newsTypeFilter) url += `&types=${_newsTypeFilter}`;
    _newsData = await api.get(url);
    clearTimeout(timeout);
    _userProfile = _newsData.profile || null;
    _renderNewsFeed(_newsData);
  } catch (e) {
    if (feed) feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon" style="font-size:28px">≋</div>
        <div class="empty-state-text">News feeds unavailable</div>
        <div style="font-size:0.75rem;color:var(--text-3);margin-top:8px">
          ${e.name === 'AbortError' ? 'Request timed out.' : e.message}
          <br>Check your internet connection or try again in a moment.
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-top:14px" onclick="loadNews()">↻ Retry</button>
      </div>`;
  }
}

function _renderNewsFeed(data) {
  _renderSentimentBar(data.sentiment);
  _renderProfileBadge(data.profile);
  _renderCoinFilters(data.articles);

  const feed = document.getElementById('news-feed');
  if (!feed) return;

  if (!data.articles?.length) {
    feed.innerHTML = emptyStateHtml('≋', 'No articles found — feeds may be temporarily unavailable');
    return;
  }

  feed.innerHTML = data.articles.map(a => _articleCard(a)).join('');

  const rt = document.getElementById('news-refresh-time');
  if (rt) rt.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function _articleCard(a) {
  const mediaIcon = a.media_type === 'video'  ? '▶'
                  : a.media_type === 'reddit' ? '↑'
                  : '◈';

  const upvoteHtml = a.upvotes !== null
    ? `<span style="color:var(--text-3);font-size:0.65rem">
        ${mediaIcon} ${a.upvotes >= 1000 ? (a.upvotes/1000).toFixed(1)+'k' : a.upvotes}
        ${a.num_comments ? ` · ${a.num_comments} comments` : ''}
       </span>`
    : '';

  const flairHtml = a.flair
    ? `<span class="badge badge-gray" style="font-size:0.6rem">${a.flair}</span>`
    : '';

  const scoreBar = a.relevance_score >= 70
    ? `<div class="news-relevance-bar high" title="Highly relevant to you"></div>`
    : a.relevance_score >= 40
    ? `<div class="news-relevance-bar medium" title="Relevant to you"></div>`
    : '';

  const mediaTypeBadge = a.media_type === 'video'
    ? `<span class="badge" style="background:rgba(255,0,0,0.12);color:#ff4040;border:1px solid rgba(255,0,0,0.25);font-size:0.6rem">▶ VIDEO</span>`
    : a.media_type === 'reddit'
    ? `<span class="badge badge-gray" style="font-size:0.6rem">Reddit</span>`
    : '';

  return `
    <a href="${a.link}" target="_blank" rel="noopener noreferrer"
      class="news-card news-${a.sentiment}">
      ${scoreBar}
      <div class="news-card-top">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="news-source" style="color:${a.color}">${a.source}</span>
          ${mediaTypeBadge}
          ${flairHtml}
        </div>
        <div class="news-badges">
          ${_sentimentBadge(a.sentiment)}
          ${(a.coins || []).slice(0,3).map(c =>
            `<span class="badge badge-gray" style="font-size:0.6rem">${_shortCoin(c)}</span>`
          ).join('')}
        </div>
      </div>
      <div class="news-title">${a.title}</div>
      ${a.summary
        ? `<div class="news-summary">${a.summary.substring(0,160)}${a.summary.length>160?'…':''}</div>`
        : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
        <div class="news-date">${_fmtNewsDate(a.age_hours)}</div>
        ${upvoteHtml}
      </div>
    </a>
  `;
}

function _renderSentimentBar(s) {
  const bar = document.getElementById('news-sentiment-bar');
  if (!bar || !s?.total) return;

  const posW = Math.round((s.positive / s.total) * 100);
  const negW = Math.round((s.negative / s.total) * 100);
  const neuW = 100 - posW - negW;

  const mood      = s.score > 20 ? 'Bullish' : s.score > 5 ? 'Slightly Bullish'
                  : s.score < -20 ? 'Bearish' : s.score < -5 ? 'Slightly Bearish'
                  : 'Neutral';
  const moodColor = s.score > 10 ? 'var(--green)' : s.score < -10 ? 'var(--red)' : 'var(--text-2)';

  bar.innerHTML = `
    <div class="sentiment-overview">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div>
          <span style="font-family:var(--font-display);font-size:1rem;font-weight:700;color:${moodColor}">${mood}</span>
          <span style="font-size:0.72rem;color:var(--text-3);margin-left:8px">Market Sentiment · ${s.total} sources</span>
        </div>
        <div style="display:flex;gap:12px;font-size:0.72rem;flex-wrap:wrap">
          <span class="pos">▲ ${s.positive} bullish</span>
          <span style="color:var(--text-3)">→ ${s.neutral} neutral</span>
          <span class="neg">▼ ${s.negative} bearish</span>
        </div>
      </div>
      <div class="sentiment-bar">
        <div class="sentiment-seg seg-pos" style="width:${posW}%"></div>
        <div class="sentiment-seg seg-neu" style="width:${neuW}%"></div>
        <div class="sentiment-seg seg-neg" style="width:${negW}%"></div>
      </div>
      <div style="font-size:0.68rem;color:var(--text-3);margin-top:6px">
        Score: <span style="color:${moodColor};font-weight:600">${s.score > 0 ? '+' : ''}${s.score}</span>
      </div>
    </div>
  `;
}

function _renderProfileBadge(profile) {
  const el = document.getElementById('news-profile-badge');
  if (!el || !profile) return;

  const coins = [...new Set([...(profile.traded_coins||[]), ...(profile.watched_coins||[])])]
    .slice(0, 5)
    .map(c => _shortCoin(c))
    .join(', ');

  el.innerHTML = `
    <div class="news-profile-strip">
      <span style="font-size:0.68rem;color:var(--text-3);margin-right:10px">Personalized for:</span>
      <span class="badge badge-cyan" style="font-size:0.65rem">${profile.prefer_level || 'beginner'}</span>
      <span class="badge badge-green" style="font-size:0.65rem">${profile.trade_style || 'swing'} trader</span>
      <span class="badge badge-gray" style="font-size:0.65rem">${profile.risk_level || 'medium'} risk</span>
      ${coins ? `<span style="font-size:0.68rem;color:var(--text-3)">· tracking ${coins}</span>` : ''}
    </div>
  `;
}

function _renderCoinFilters(articles) {
  const el = document.getElementById('news-coin-filters');
  if (!el) return;
  const counts = {};
  for (const a of articles) {
    for (const c of (a.coins || [])) counts[c] = (counts[c]||0) + 1;
  }
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  if (!sorted.length) { el.innerHTML=''; return; }
  el.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <span style="font-size:0.65rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Coin:</span>
      <button class="news-filter-pill ${!_newsCoinFilter?'active':''}" onclick="setNewsFilter(null)">All</button>
      ${sorted.map(([coin, count]) =>
        `<button class="news-filter-pill ${_newsCoinFilter===coin?'active':''}"
          onclick="setNewsFilter('${coin}')">
          ${_shortCoin(coin)}
          <span style="opacity:0.6;font-size:0.62rem;margin-left:2px">${count}</span>
        </button>`
      ).join('')}
    </div>
  `;
}

// ── Filters ──────────────────────────────────────────────────────────────────

async function setNewsFilter(coin) {
  _newsCoinFilter = coin;
  const feed = document.getElementById('news-feed');
  if (feed) feed.innerHTML = loadingHtml('Filtering');
  await loadNews();
}

async function setNewsTypeFilter(type) {
  _newsTypeFilter = type;
  // Update type filter buttons
  document.querySelectorAll('.news-type-filters .news-filter-pill').forEach(b => {
    const btnType = b.getAttribute('onclick').includes('null') ? null
      : b.getAttribute('onclick').match(/'([^']+)'/)?.[1] || null;
    b.classList.toggle('active', btnType === type);
  });
  const feed = document.getElementById('news-feed');
  if (feed) feed.innerHTML = loadingHtml('Filtering');
  await loadNews();
}

async function refreshNews() {
  const feed = document.getElementById('news-feed');
  if (feed) feed.innerHTML = loadingHtml('Refreshing');
  await loadNews();
  showToast('Feed refreshed ✓', 'success');
}

function _startNewsRefresh() {
  if (_newsRefreshTimer) clearInterval(_newsRefreshTimer);
  _newsRefreshTimer = setInterval(() => {
    if (document.getElementById('page-news')?.classList.contains('active')) loadNews();
  }, 300000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _sentimentBadge(s) {
  if (s === 'positive') return '<span class="badge badge-green" style="font-size:0.6rem">▲</span>';
  if (s === 'negative') return '<span class="badge badge-red"   style="font-size:0.6rem">▼</span>';
  return '<span class="badge badge-gray" style="font-size:0.6rem">→</span>';
}

function _fmtNewsDate(ageHours) {
  if (ageHours === undefined || ageHours === null) return '';
  const h = parseFloat(ageHours);
  if (h < 1)  return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function _shortCoin(coinId) {
  const map = {
    'bitcoin':'BTC','ethereum':'ETH','solana':'SOL','avalanche-2':'AVAX',
    'chainlink':'LINK','cardano':'ADA','polkadot':'DOT','dogecoin':'DOGE',
    'polygon':'MATIC','ripple':'XRP','binancecoin':'BNB','injective-protocol':'INJ',
  };
  return map[coinId] || coinId.toUpperCase().substring(0,6);
}