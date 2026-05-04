// frontend/js/modules/sentiment.js
// Fear & Greed Index + Trending coins — terminal dark theme
// Matches existing monospace aesthetic with angular, text-forward design

// ── FEAR & GREED ──────────────────────────────────────────────────────────────

async function renderFearGreed(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div style="font-size:0.7rem;color:var(--text-3)">—</div>`;
  try {
    const data = await api.get('/sentiment/fear-greed');
    el.innerHTML = _buildFGWidget(data.current, data.history || []);
    // Wire click to expand history
    el.querySelector('[data-fng-expand]')?.addEventListener('click', () => {
      _toggleFngHistory(el, data.history);
    });
  } catch (e) {
    el.innerHTML = `<div style="font-size:0.7rem;color:var(--text-3)">Unavailable</div>`;
  }
}

function _buildFGWidget(c, history) {
  const val   = c.value;
  const label = c.label.toUpperCase();
  const color = _fngColor(val);
  const bars  = _fngBarChart(val);
  const trend = _fngTrend(history);

  return `
    <div style="display:flex;flex-direction:column;gap:10px">

      <!-- Header row -->
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <div style="font-size:0.65rem;color:var(--text-3);letter-spacing:0.1em;text-transform:uppercase">
          Fear &amp; Greed
        </div>
        <div style="font-size:0.65rem;color:var(--text-3)">${trend}</div>
      </div>

      <!-- Big number + label -->
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="font-family:var(--font-mono);font-size:2.4rem;font-weight:700;
                    line-height:1;color:${color};letter-spacing:-0.02em">${val}</div>
        <div style="font-size:0.72rem;font-weight:600;color:${color};letter-spacing:0.05em">
          ${label}
        </div>
      </div>

      <!-- Segmented bar -->
      <div style="display:flex;gap:2px;height:6px;border-radius:2px;overflow:hidden">
        ${bars}
      </div>

      <!-- Zone labels -->
      <div style="display:flex;justify-content:space-between;font-size:0.55rem;
                  color:var(--text-3);letter-spacing:0.04em;margin-top:-4px">
        <span>FEAR</span>
        <span>NEUTRAL</span>
        <span>GREED</span>
      </div>

      <!-- Interpretation -->
      <div style="font-size:0.68rem;color:var(--text-3);line-height:1.5;
                  padding:8px 10px;background:var(--bg-3);
                  border-left:2px solid ${color};border-radius:0 4px 4px 0">
        ${_fngInterpretation(val)}
      </div>

      <!-- 7-day mini chart -->
      ${history.length > 1 ? _fngMiniChart(history) : ''}

      <!-- Source -->
      <div style="font-size:0.6rem;color:var(--text-3);display:flex;
                  justify-content:space-between;align-items:center">
        <span>alternative.me · daily</span>
        <span style="cursor:pointer;color:var(--accent)" data-fng-expand>
          7d history ↓
        </span>
      </div>

      <!-- History table (hidden by default) -->
      <div id="fng-history-table" style="display:none"></div>
    </div>
  `;
}

function _fngBarChart(val) {
  // 20 segments, colored by zone, filled up to current value
  const segments = 20;
  const filled   = Math.round((val / 100) * segments);
  return Array.from({ length: segments }, (_, i) => {
    const pct     = ((i + 1) / segments) * 100;
    const segColor = i < filled ? _fngColor(pct) : 'var(--bg-4)';
    return `<div style="flex:1;background:${segColor};
                        opacity:${i < filled ? 0.9 : 0.3}"></div>`;
  }).join('');
}

function _fngMiniChart(history) {
  const vals    = [...history].reverse().map(h => h.value);
  const oldest  = vals[0];
  const latest  = vals[vals.length - 1];
  const changed = latest - oldest;
  const changeColor = changed >= 0 ? 'var(--green)' : 'var(--red)';
  const min     = Math.min(...vals) - 5;
  const max     = Math.max(...vals) + 5;
  const range   = max - min || 1;
  const W = 400, H = 80;

  // SVG path points
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Area fill path
  const areaPath = `M ${pts[0]} ` +
    pts.slice(1).map(p => `L ${p}`).join(' ') +
    ` L ${W},${H} L 0,${H} Z`;

  // Date labels — one per point
  const dateLabels = [...history].reverse().map((h, i) => {
    const d = new Date(h.timestamp * 1000);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const x = (i / (vals.length - 1)) * W;
    // Only show first, middle, last to avoid crowding
    if (i !== 0 && i !== Math.floor(vals.length / 2) && i !== vals.length - 1) return '';
    return `<text x="${x.toFixed(1)}" y="${H + 14}" text-anchor="${i === 0 ? 'start' : i === vals.length - 1 ? 'end' : 'middle'}"
      font-size="9" fill="var(--text-3)" font-family="monospace">${label}</text>`;
  }).join('');

  // Value dots + hover labels
  const dots = vals.map((v, i) => {
  const x     = (i / (vals.length - 1)) * W;
  const y     = H - ((v - min) / range) * H;
  const col   = _fngColor(v);
  const d     = new Date([...history].reverse()[i].timestamp * 1000);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const lbl   = [...history].reverse()[i].label;

  // Show value label above dot, hidden by default, shown on hover via CSS
  return `
    <g class="fng-dot-group" style="cursor:default">
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"
              fill="${col}" stroke="var(--bg-2)" stroke-width="1.5"/>
      <!-- Invisible larger hit area -->
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10"
              fill="transparent"/>
      <!-- Tooltip box -->
      <g class="fng-tooltip" style="pointer-events:none;opacity:0;transition:opacity 0.1s">
        <rect x="${(x - 36).toFixed(1)}" y="${(y - 32).toFixed(1)}"
              width="72" height="26" rx="3"
              fill="var(--bg-4)" stroke="var(--border)" stroke-width="1"/>
        <text x="${x.toFixed(1)}" y="${(y - 20).toFixed(1)}"
              text-anchor="middle" font-size="9" fill="${col}"
              font-family="monospace" font-weight="700">${v} ${lbl}</text>
        <text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}"
              text-anchor="middle" font-size="8" fill="var(--text-3)"
              font-family="monospace">${label}</text>
      </g>
    </g>`;
}).join('');

  return `
    <div style="margin:8px 0 4px">
      <svg width="100%" height="${H + 20}" viewBox="0 0 ${W} ${H + 20}"
        preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">
        <defs>
          <linearGradient id="fng-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2"/>
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
          </linearGradient>
        </defs>

        <!-- Horizontal guide lines -->
        ${[25, 50, 75].map(v => {
          const y = H - ((v - min) / range) * H;
          return `
            <line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}"
                  stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,4"/>
            <text x="2" y="${(y - 3).toFixed(1)}" font-size="8"
                  fill="var(--text-3)" font-family="monospace">${v}</text>`;
        }).join('')}

        <!-- Area fill -->
        <path d="${areaPath}" fill="url(#fng-area-grad)"/>

        <!-- Line -->
        <polyline points="${pts.join(' ')}"
                  fill="none" stroke="var(--accent)" stroke-width="2"
                  stroke-linejoin="round" stroke-linecap="round"/>

        <!-- Dots with tooltips -->
        ${dots}

        <!-- Date labels — preserveAspectRatio="none" distorts text so override -->
        ${dateLabels}
      </svg>

      <!-- Stats row below chart -->
      <div style="display:flex;justify-content:space-between;align-items:center;
                  margin-top:4px;padding:6px 8px;background:var(--bg-3);
                  border-radius:var(--radius);font-family:var(--font-mono)">
        <div style="font-size:0.62rem;color:var(--text-3)">
          7d low: <span style="color:var(--red)">${Math.min(...vals)}</span>
        </div>
        <div style="font-size:0.62rem;color:${changeColor};font-weight:600">
          ${changed >= 0 ? '↑' : '↓'} ${changed >= 0 ? '+' : ''}${changed} pts this week
        </div>
        <div style="font-size:0.62rem;color:var(--text-3)">
          7d high: <span style="color:var(--green)">${Math.max(...vals)}</span>
        </div>
      </div>
    </div>
  `;
}

function _toggleFngHistory(el, history) {
  const table = el.querySelector('#fng-history-table');
  if (!table) return;
  if (table.style.display === 'none') {
    table.style.display = 'block';
    table.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-top:4px">
        <table style="width:100%;border-collapse:collapse;font-size:0.68rem;font-family:var(--font-mono)">
          <thead>
            <tr style="background:var(--bg-3)">
              <th style="padding:5px 8px;text-align:left;color:var(--text-3);font-weight:500">Date</th>
              <th style="padding:5px 8px;text-align:right;color:var(--text-3);font-weight:500">Value</th>
              <th style="padding:5px 8px;text-align:right;color:var(--text-3);font-weight:500">Sentiment</th>
            </tr>
          </thead>
          <tbody>
            ${history.map(h => {
              const d     = new Date(h.timestamp * 1000);
              const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const col   = _fngColor(h.value);
              return `
                <tr style="border-top:1px solid var(--border)">
                  <td style="padding:5px 8px;color:var(--text-3)">${label}</td>
                  <td style="padding:5px 8px;text-align:right;color:${col};font-weight:600">${h.value}</td>
                  <td style="padding:5px 8px;text-align:right;color:${col}">${h.label}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
    el.querySelector('[data-fng-expand]').textContent = '7d history ↑';
  } else {
    table.style.display = 'none';
    el.querySelector('[data-fng-expand]').textContent = '7d history ↓';
  }
}

function _fngTrend(history) {
  if (history.length < 2) return '';
  const latest = history[0].value;
  const prev   = history[1].value;
  const diff   = latest - prev;
  if (diff === 0) return '→ unchanged';
  return diff > 0
    ? `<span style="color:var(--green)">↑ +${diff} from yesterday</span>`
    : `<span style="color:var(--red)">↓ ${diff} from yesterday</span>`;
}

function _fngColor(val) {
  if (val <= 24) return '#e03040';
  if (val <= 44) return '#ff9f43';
  if (val <= 55) return '#ffd32a';
  if (val <= 75) return '#00a854';
  return '#00d2ff';
}

function _fngInterpretation(val) {
  if (val <= 24) return 'Extreme fear — historically a buying opportunity. Market may be oversold.';
  if (val <= 44) return 'Fear dominates. Cautious investors. Watch for accumulation signals.';
  if (val <= 55) return 'Neutral. No strong directional bias in the market right now.';
  if (val <= 75) return 'Greed rising. Market bullish — watch for overextension.';
  return 'Extreme greed — market may be overheated. Consider taking profits.';
}


// ── TRENDING COINS ────────────────────────────────────────────────────────────

async function renderTrending(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div style="font-size:0.7rem;color:var(--text-3)">—</div>`;
  try {
    const [trendData, wlData] = await Promise.all([
      api.get('/sentiment/trending'),
      api.get('/market/watchlist').catch(() => []),
    ]);
    const coins     = trendData.coins || [];
    const watchedIds = new Set(wlData.map(w => w.coin_id));
    if (!coins.length) {
      el.innerHTML = `<div style="font-size:0.7rem;color:var(--text-3)">No data</div>`;
      return;
    }
    el.innerHTML = _buildTrendingWidget(coins, watchedIds);

    // Wire toggle buttons after render
    el.querySelectorAll('[data-trending-add]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const coinId = btn.dataset.coinId;
        const symbol = btn.dataset.symbol;
        const name   = btn.dataset.name;
        const watching = btn.dataset.watching === 'true';

        if (watching) {
          // Remove from watchlist
          try {
            await api.del(`/market/watchlist/${coinId}`);
            btn.dataset.watching = 'false';
            btn.textContent = '+';
            btn.style.borderColor = 'var(--border)';
            btn.style.color       = 'var(--text-3)';
            btn.title = 'Add to watchlist';
            showToast(`${symbol} removed from watchlist`, '');
          } catch (e) { showToast(e.message, 'error'); }
        } else {
          // Add to watchlist
          try {
            await api.post('/market/watchlist', { coin_id: coinId, symbol, name });
            btn.dataset.watching = 'true';
            btn.textContent = '✓';
            btn.style.borderColor = 'var(--green)';
            btn.style.color       = 'var(--green)';
            btn.title = 'Remove from watchlist';
            showToast(`${symbol} added to watchlist ✓`, 'success');
          } catch (e) {
            if (e.message?.includes('409') || e.message?.includes('UNIQUE')) {
              // Already watching — just update state
              btn.dataset.watching = 'true';
              btn.textContent = '✓';
              btn.style.borderColor = 'var(--green)';
              btn.style.color       = 'var(--green)';
            } else {
              showToast(e.message, 'error');
            }
          }
        }
      });
    });

  } catch (e) {
    el.innerHTML = `<div style="font-size:0.7rem;color:var(--text-3)">Unavailable</div>`;
  }
}

function _buildTrendingWidget(coins, watchedIds = new Set()) {
  const rows = coins.slice(0, 7).map((coin, i) => {
    const priceData  = coin.data || {};
    const rawPrice   = priceData.price;
    const priceStr   = rawPrice != null
      ? rawPrice >= 1000 ? `$${Number(rawPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
        : rawPrice >= 1  ? `$${Number(rawPrice).toFixed(2)}`
        : `$${Number(rawPrice).toFixed(5)}`
      : '—';

    const change24h  = priceData.price_change_percentage_24h?.usd;
    const changeStr  = change24h != null ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(1)}%` : '—';
    const changeColor = change24h == null ? 'var(--text-3)' : change24h >= 0 ? 'var(--green)' : 'var(--red)';
    const rank        = coin.rank ? `#${coin.rank}` : '';
    const safeName    = (coin.name || coin.symbol).replace(/'/g, "\\'");
    const isWatching  = watchedIds.has(coin.id);

    return `
      <div style="display:grid;grid-template-columns:16px 20px 1fr 90px 32px 28px;
                  align-items:center;gap:8px;padding:6px 0;
                  border-bottom:1px solid var(--border)">

        <span style="font-size:0.6rem;color:var(--text-3);text-align:right;
                     font-family:var(--font-mono)">${i + 1}</span>

        ${coin.thumb
          ? `<img src="${coin.thumb}" width="16" height="16"
               style="border-radius:50%;cursor:pointer"
               onclick="openCoinChart('${coin.id}','${coin.symbol}','${safeName}')"
               onerror="this.style.display='none'">`
          : `<div style="width:16px;height:16px;border-radius:50%;background:var(--bg-4)"></div>`}

        <div style="min-width:0;overflow:hidden;cursor:pointer"
             onclick="openCoinChart('${coin.id}','${coin.symbol}','${safeName}')">
          <span style="font-family:var(--font-mono);font-size:0.78rem;font-weight:600;
                       color:var(--text)">${coin.symbol}</span>
          ${isWatching
            ? `<span style="font-size:0.55rem;color:var(--green);margin-left:4px">●</span>`
            : ''}
          <span style="font-size:0.62rem;color:var(--text-3);margin-left:4px">${coin.name}</span>
        </div>

        <div style="text-align:right;font-family:var(--font-mono);min-width:80px">
          <div style="font-size:0.72rem;color:var(--text)">${priceStr}</div>
          <div style="font-size:0.65rem;color:${changeColor}">${changeStr}</div>
        </div>

        <div style="font-size:0.58rem;color:var(--text-3);font-family:var(--font-mono);
                    text-align:right">${rank}</div>

        <button data-trending-add
                data-coin-id="${coin.id}"
                data-symbol="${coin.symbol}"
                data-name="${coin.name.replace(/"/g, '&quot;')}"
                data-watching="${isWatching}"
                title="${isWatching ? 'Remove from watchlist' : 'Add to watchlist'}"
                style="background:none;border:1px solid ${isWatching ? 'var(--green)' : 'var(--border)'};
                       border-radius:3px;
                       color:${isWatching ? 'var(--green)' : 'var(--text-3)'};
                       font-size:0.65rem;cursor:pointer;padding:1px 5px;
                       line-height:1.4;transition:all 0.15s;font-family:var(--font-mono)">
          ${isWatching ? '✓' : '+'}
        </button>
      </div>`;
  }).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
      <div style="font-size:0.65rem;color:var(--text-3);letter-spacing:0.1em;text-transform:uppercase">
        Trending
      </div>
      <div style="font-size:0.58rem;color:var(--text-3)">CoinGecko · click name for chart</div>
    </div>
    ${rows}
  `;
}


// ── COMBINED CARD ─────────────────────────────────────────────────────────────

async function renderSentimentCard(targetId) {
  const el = document.getElementById(targetId);
  if (!el) {
    console.warn('[sentiment] target not found:', targetId);
    return;
  }

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:28px;align-items:start">
      <div id="fng-widget"></div>
      <div>
        <div id="trending-widget"></div>
      </div>
    </div>
  `;

  await new Promise(resolve => setTimeout(resolve, 0));

  const fngEl      = document.getElementById('fng-widget');
  const trendingEl = document.getElementById('trending-widget');
  if (!fngEl || !trendingEl) return;

  await Promise.all([
    renderFearGreed('fng-widget'),
    renderTrending('trending-widget'),
  ]);
}