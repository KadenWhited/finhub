// modules/market.js
// Stage 2 — Live crypto market dashboard

let marketRefreshTimer = null;
let marketLastRefresh = null;
let currentMarketTab = 'watchlist';

// ─────────────────────────────────────────
//  ENTRY POINT
// ─────────────────────────────────────────

async function renderMarket() {
  const el = document.getElementById('page-market');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Market</div>
        <div class="page-subtitle">Live crypto prices · CoinGecko</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span id="market-last-refresh" style="font-size:0.68rem;color:var(--text-3)"></span>
        <button class="btn btn-ghost btn-sm" onclick="refreshMarket()">↻ Refresh</button>
        <button class="btn btn-primary" onclick="openAddWatchlistModal()">+ Watch Coin</button>
      </div>
    </div>

    <!-- Movers bar -->
    <div id="movers-bar" style="margin-bottom:20px"></div>

    <!-- Tab nav -->
    <div class="market-tabs" style="margin-bottom:20px">
      <button class="market-tab ${currentMarketTab === 'watchlist' ? 'active' : ''}"
        onclick="switchMarketTab('watchlist')">Watchlist</button>
      <button class="market-tab ${currentMarketTab === 'top50' ? 'active' : ''}"
        onclick="switchMarketTab('top50')">Top 50</button>
      <button class="market-tab ${currentMarketTab === 'movers' ? 'active' : ''}"
        onclick="switchMarketTab('movers')">Movers</button>
    </div>

    <!-- Tab content -->
    <div id="market-tab-content">${loadingHtml('Fetching prices')}</div>
  `;

  await loadMarketTab(currentMarketTab);
  startMarketAutoRefresh();
}

// ─────────────────────────────────────────
//  TAB ROUTING
// ─────────────────────────────────────────

function switchMarketTab(tab) {
  currentMarketTab = tab;
  document.querySelectorAll('.market-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.toLowerCase().replace(' ', '') === tab.toLowerCase().replace(' ', ''));
  });
  // Re-activate correctly by re-rendering tab buttons
  document.querySelectorAll('.market-tab').forEach(t => {
    const tabName = t.getAttribute('onclick').match(/'(\w+)'/)[1];
    t.classList.toggle('active', tabName === tab);
  });
  document.getElementById('market-tab-content').innerHTML = loadingHtml('Fetching prices');
  loadMarketTab(tab);
}

async function loadMarketTab(tab) {
  const el = document.getElementById('market-tab-content');
  try {
    if (tab === 'watchlist') await renderWatchlistTab(el);
    else if (tab === 'top50') await renderTop50Tab(el);
    else if (tab === 'movers') await renderMoversTab(el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">⚠ ${e.message}</div></div>`;
  }
}

// ─────────────────────────────────────────
//  MOVERS BAR (always visible)
// ─────────────────────────────────────────

async function loadMoversBar() {
  try {
    const data = await api.get('/market/movers');
    const bar = document.getElementById('movers-bar');
    if (!bar) return;

    const all = [...(data.gainers || []).slice(0, 4), ...(data.losers || []).slice(0, 4)];
    if (all.length === 0) {
      bar.innerHTML = '';
      return;
    }

    bar.innerHTML = `
      <div class="movers-ticker">
        <span class="movers-label">5%+ MOVERS</span>
        <div class="movers-scroll">
          ${all.map(c => `
            <div class="mover-chip ${c.change_24h >= 0 ? 'mover-up' : 'mover-down'}">
              <span class="mover-sym">${c.symbol}</span>
              <span class="mover-pct">${c.change_24h >= 0 ? '+' : ''}${c.change_24h}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) {
    // Silent fail on movers bar
  }
}

// ─────────────────────────────────────────
//  WATCHLIST TAB
// ─────────────────────────────────────────

async function renderWatchlistTab(el) {
  const data = await api.get('/market/watchlist');

  if (data.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">◇</div>
        <div class="empty-state-text">Your watchlist is empty</div>
        <div style="margin-top:14px">
          <button class="btn btn-primary" onclick="openAddWatchlistModal()">+ Add Your First Coin</button>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="coin-grid">
      ${data.map(item => coinCard(item.market || {}, item, true)).join('')}
    </div>
  `;

  updateRefreshTime();
  loadMoversBar();
}

// ─────────────────────────────────────────
//  TOP 50 TAB
// ─────────────────────────────────────────

async function renderTop50Tab(el) {
  // Fetch both top coins AND current watchlist in parallel
  const [data, wlData] = await Promise.all([
    api.get('/market/top?limit=50'),
    api.get('/market/watchlist')
  ]);
  const coins = data.coins || [];
  const watchedIds = new Set(wlData.map(w => w.coin_id));

  if (coins.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No data available</div></div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Coin</th>
            <th>Price</th>
            <th>24h</th>
            <th>7d</th>
            <th>Trend</th>
            <th>Market Cap</th>
            <th>Volume 24h</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${coins.map(c => `
            <tr>
              <td style="color:var(--text-3)">${c.market_cap_rank}</td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  ${c.image ? `<img src="${c.image}" width="20" height="20" style="border-radius:50%;flex-shrink:0" onerror="this.style.display='none'">` : ''}
                  <div>
                    <div style="font-weight:600;font-size:0.82rem;cursor:pointer;color:var(--text)"
                      onclick="openCoinChart('${c.id}','${c.symbol}','${c.name.replace(/'/g,'')}')">${c.symbol}</div>
                    <div style="font-size:0.68rem;color:var(--text-3)">${c.name}</div>
                  </div>
                </div>
              </td>
              <td style="font-weight:600">${fmtPrice(c.price)}</td>
              <td>${pctBadge(c.change_24h)}${c.alert_24h ? ` <span class="alert-dot ${c.alert_direction}">●</span>` : ''}</td>
              <td>${pctBadge(c.change_7d)}</td>
              <td>${momentumBadge(c.momentum)}</td>
              <td style="color:var(--text-2)">${fmtLargeNum(c.market_cap)}</td>
              <td style="color:var(--text-2)">${fmtLargeNum(c.volume_24h)}</td>
              <td>
                ${watchedIds.has(c.id)
                  ? `<span class="badge badge-green" style="font-size:0.6rem">✓ Watching</span>`
                  : `<button class="btn btn-sm btn-ghost btn-icon"
                      onclick="quickAddToWatchlist('${c.id}','${c.symbol}','${c.name.replace(/'/g,'')}')"
                      title="Add to watchlist">+</button>`
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  updateRefreshTime();
}

// ─────────────────────────────────────────
//  MOVERS TAB
// ─────────────────────────────────────────

async function renderMoversTab(el) {
  const data = await api.get('/market/movers');
  const gainers = data.gainers || [];
  const losers = data.losers || [];

  if (gainers.length === 0 && losers.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-text">No coins moving >5% right now</div></div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

      <div>
        <div style="font-size:0.7rem;color:var(--green);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <span>▲</span> Gainers (+5% or more)
        </div>
        ${gainers.length === 0
          ? `<div style="color:var(--text-3);font-size:0.78rem;padding:16px 0">No major gainers right now</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${gainers.map(c => moverRow(c, 'up')).join('')}</div>`
        }
      </div>

      <div>
        <div style="font-size:0.7rem;color:var(--red);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;display:flex;align-items:center;gap:6px">
          <span>▼</span> Losers (-5% or more)
        </div>
        ${losers.length === 0
          ? `<div style="color:var(--text-3);font-size:0.78rem;padding:16px 0">No major losers right now</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px">${losers.map(c => moverRow(c, 'down')).join('')}</div>`
        }
      </div>

    </div>
  `;

  updateRefreshTime();
}

// ─────────────────────────────────────────
//  ADD TO WATCHLIST
// ─────────────────────────────────────────

let searchTimeout = null;

function openAddWatchlistModal() {
  openModal(`
    <div class="modal-title">Add Coin to Watchlist</div>
    <div class="form-group" style="margin-bottom:16px">
      <label class="form-label">Search by name or symbol</label>
      <input id="wl-search" class="form-input" placeholder="Bitcoin, ETH, Solana…"
        oninput="debounceSearch(this.value)" autocomplete="off">
    </div>
    <div id="wl-results" style="max-height:320px;overflow-y:auto"></div>
  `);
  setTimeout(() => document.getElementById('wl-search')?.focus(), 50);
}

function debounceSearch(val) {
  clearTimeout(searchTimeout);
  const q = val.trim();
  if (q.length < 2) {
    document.getElementById('wl-results').innerHTML = '';
    return;
  }
  document.getElementById('wl-results').innerHTML = `<div class="loading dot-anim">Searching</div>`;
  searchTimeout = setTimeout(() => doSearch(q), 350);
}

async function doSearch(query) {
  try {
    const data = await api.get(`/market/search?q=${encodeURIComponent(query)}`);
    const results = data.results || [];
    const el = document.getElementById('wl-results');
    if (!el) return;

    if (results.length === 0) {
      el.innerHTML = `<div style="color:var(--text-3);font-size:0.78rem;padding:12px 0">No results for "${query}"</div>`;
      return;
    }

    el.innerHTML = results.map(r => `
      <div class="search-result-row" onclick="addToWatchlist('${r.id}','${r.symbol}','${r.name.replace(/'/g, '')}')">
        <div style="display:flex;align-items:center;gap:10px">
          ${r.thumb ? `<img src="${r.thumb}" width="24" height="24" style="border-radius:50%" onerror="this.style.display='none'">` : '<div style="width:24px;height:24px;background:var(--bg-4);border-radius:50%"></div>'}
          <div>
            <div style="font-size:0.84rem;font-weight:600">${r.name}</div>
            <div style="font-size:0.7rem;color:var(--text-3)">${r.symbol}${r.market_cap_rank ? ` · Rank #${r.market_cap_rank}` : ''}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-primary">+ Add</button>
      </div>
    `).join('');
  } catch (e) {
    const el = document.getElementById('wl-results');
    if (el) el.innerHTML = `<div style="color:var(--red);font-size:0.78rem">${e.message}</div>`;
  }
}

async function addToWatchlist(coinId, symbol, name) {
  try {
    await api.post('/market/watchlist', { coin_id: coinId, symbol, name });
    closeModal();
    showToast(`${symbol} added to watchlist ✓`, 'success');
    if (currentMarketTab === 'watchlist') {
      await loadMarketTab('watchlist');
    }
  } catch (e) {
    if (e.message.includes('409') || e.message.toLowerCase().includes('already')) {
      showToast(`${symbol} is already in your watchlist`, 'error');
    } else {
      showToast(e.message, 'error');
    }
  }
}

async function quickAddToWatchlist(coinId, symbol, name) {
  try {
    await api.post('/market/watchlist', { coin_id: coinId, symbol, name });
    showToast(`${symbol} added to watchlist ✓`, 'success');
  } catch (e) {
    if (e.message.includes('409') || e.message.toLowerCase().includes('already')) {
      showToast(`${symbol} already in watchlist`, 'error');
    } else {
      showToast(e.message, 'error');
    }
  }
}

async function removeFromWatchlist(coinId, symbol) {
  try {
    await api.del(`/market/watchlist/${coinId}`);
    showToast(`${symbol} removed`, 'success');
    await loadMarketTab('watchlist');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
//  AUTO REFRESH
// ─────────────────────────────────────────

function startMarketAutoRefresh() {
  stopMarketAutoRefresh();
  marketRefreshTimer = setInterval(() => {
    if (document.getElementById('page-market')?.classList.contains('active')) {
      loadMarketTab(currentMarketTab);
      loadMoversBar();
    }
  }, 60000); // Refresh every 60s — respectful of free tier
}

function stopMarketAutoRefresh() {
  if (marketRefreshTimer) {
    clearInterval(marketRefreshTimer);
    marketRefreshTimer = null;
  }
}

async function refreshMarket() {
  try {
    await api.post('/market/cache/clear');
  } catch (e) { /* ignore */ }
  document.getElementById('market-tab-content').innerHTML = loadingHtml('Refreshing prices');
  await loadMarketTab(currentMarketTab);
  loadMoversBar();
  showToast('Prices refreshed ✓', 'success');
}

function updateRefreshTime() {
  marketLastRefresh = new Date();
  const el = document.getElementById('market-last-refresh');
  if (el) el.textContent = `Updated ${marketLastRefresh.toLocaleTimeString()}`;
}

// ─────────────────────────────────────────
//  RENDER HELPERS
// ─────────────────────────────────────────

function coinCard(coin, watchlistItem, showRemove) {
  if (!coin || !coin.id) {
    return `
      <div class="coin-card coin-card-error">
        <div class="coin-card-header">
          <div class="coin-sym">${watchlistItem?.symbol || '?'}</div>
          <button class="btn btn-sm btn-danger btn-icon"
            onclick="removeFromWatchlist('${watchlistItem.coin_id}','${watchlistItem.symbol}')">✕</button>
        </div>
        <div style="color:var(--text-3);font-size:0.72rem;margin-top:8px">Price unavailable</div>
      </div>
    `;
  }

  const up24 = coin.change_24h >= 0;
  const alertHtml = coin.alert_24h
    ? `<div class="coin-alert ${coin.alert_direction === 'up' ? 'coin-alert-up' : 'coin-alert-down'}">
         ${coin.alert_direction === 'up' ? '▲' : '▼'} ${Math.abs(coin.change_24h)}% in 24h
       </div>`
    : '';

  return `
    <div class="coin-card ${coin.alert_24h ? 'coin-card-alert' : ''}"
      style="cursor:pointer"
      onclick="openCoinChart('${coin.id}','${coin.symbol}','${(coin.name||'').replace(/'/g,'')}')">
      <div class="coin-card-header">
        <div style="display:flex;align-items:center;gap:8px">
          ${coin.image ? `<img src="${coin.image}" width="28" height="28" style="border-radius:50%" onerror="this.style.display='none'">` : ''}
          <div>
            <div class="coin-sym">${coin.symbol}</div>
            <div class="coin-name">${coin.name}</div>
          </div>
        </div>
        ${showRemove ? `<button class="btn btn-sm btn-danger btn-icon"
          onclick="event.stopPropagation();removeFromWatchlist('${watchlistItem.coin_id}','${coin.symbol}')" title="Remove">✕</button>` : ''}
      </div>

      <div class="coin-price">${fmtPrice(coin.price)}</div>

      ${alertHtml}

      <div class="coin-stats">
        <div class="coin-stat">
          <div class="coin-stat-label">24h</div>
          <div class="coin-stat-val ${up24 ? 'pos' : 'neg'}">${up24 ? '+' : ''}${coin.change_24h}%</div>
        </div>
        <div class="coin-stat">
          <div class="coin-stat-label">7d</div>
          <div class="coin-stat-val ${coin.change_7d >= 0 ? 'pos' : 'neg'}">${coin.change_7d >= 0 ? '+' : ''}${coin.change_7d}%</div>
        </div>
        <div class="coin-stat">
          <div class="coin-stat-label">Trend</div>
          <div class="coin-stat-val">${momentumBadge(coin.momentum)}</div>
        </div>
      </div>

      <div class="coin-footer">
        <span style="font-size:0.68rem;color:var(--text-3)">Vol ${fmtLargeNum(coin.volume_24h)}</span>
        <span style="font-size:0.68rem;color:var(--accent);font-size:0.65rem">↗ Chart</span>
      </div>
    </div>
  `;
}


function moverRow(coin, dir) {
  return `
    <div class="mover-row">
      <div style="display:flex;align-items:center;gap:8px">
        ${coin.image ? `<img src="${coin.image}" width="22" height="22" style="border-radius:50%;flex-shrink:0" onerror="this.style.display='none'">` : ''}
        <div>
          <div style="font-size:0.82rem;font-weight:600">${coin.symbol}</div>
          <div style="font-size:0.68rem;color:var(--text-3)">${coin.name}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700;font-size:0.9rem" class="${dir === 'up' ? 'pos' : 'neg'}">${coin.change_24h >= 0 ? '+' : ''}${coin.change_24h}%</div>
        <div style="font-size:0.72rem;color:var(--text-2)">${fmtPrice(coin.price)}</div>
      </div>
    </div>
  `;
}

function pctBadge(val) {
  if (val === null || val === undefined) return '<span class="zero">—</span>';
  const cls = val > 0 ? 'pos' : val < 0 ? 'neg' : 'zero';
  return `<span class="${cls}">${val >= 0 ? '+' : ''}${val}%</span>`;
}

function momentumBadge(momentum) {
  if (momentum === 'up') return '<span class="badge badge-green" style="font-size:0.62rem">▲ BULL</span>';
  if (momentum === 'down') return '<span class="badge badge-red" style="font-size:0.62rem">▼ BEAR</span>';
  return '<span class="badge badge-gray" style="font-size:0.62rem">→ FLAT</span>';
}

function fmtPrice(val) {
  if (!val && val !== 0) return '—';
  const n = parseFloat(val);
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(4);
  if (n >= 0.0001) return '$' + n.toFixed(6);
  return '$' + n.toExponential(4);
}

function fmtLargeNum(val) {
  if (!val) return '—';
  const n = parseFloat(val);
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
}
