// frontend/js/modules/predictions.js
// Kalshi Predictions module

let _predictionsData  = [];
let _predictionsTab   = 'positions'; // 'positions' | 'history' | 'watchlist' | 'markets'
let _predictionsStats = {};

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderPredictions() {
  const el = document.getElementById('page-predictions');
  el.innerHTML = loadingHtml('Loading predictions');

  try {
    const [preds, stats, watchlist] = await Promise.all([
      api.get('/predictions/'),
      api.get('/predictions/stats'),
      api.get('/predictions/watchlist'),
    ]);
    _predictionsData  = preds;
    _predictionsStats = stats;
    renderPredictionsView(el, preds, stats, watchlist);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderPredictionsView(el, preds, stats, watchlist) {
  const open = preds.filter(p => p.status === 'open');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Predictions</div>
        <div class="page-subtitle">Kalshi prediction market positions and watchlist</div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="openMarketSearch()">🔍 Search Markets</button>
        <button class="btn btn-primary" onclick="openManualPredictionModal()">+ Log Manually</button>
      </div>
    </div>

    <!-- Stats -->
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card ${stats.total_pnl_dollars >= 0 ? '' : 'red'}">
        <div class="stat-label">Total P&L</div>
        <div class="stat-value ${stats.total_pnl_dollars >= 0 ? 'pos' : 'neg'}">
          ${stats.total_pnl_dollars >= 0 ? '+' : ''}$${Math.abs(stats.total_pnl_dollars || 0).toFixed(2)}
        </div>
        <div class="stat-sub">${stats.total_closed || 0} closed positions</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">Open Positions</div>
        <div class="stat-value" style="color:var(--yellow)">${stats.open_positions || 0}</div>
      </div>
      <div class="stat-card ${stats.overall_win_rate >= 50 ? '' : 'red'}">
        <div class="stat-label">Overall Win Rate</div>
        <div class="stat-value ${stats.overall_win_rate >= 50 ? 'pos' : 'neg'}">${stats.overall_win_rate || 0}%</div>
        <div class="stat-sub">${stats.total_wins || 0}W / ${stats.total_losses || 0}L</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Held to Resolution</div>
        <div class="stat-value ${stats.resolved_win_rate >= 50 ? 'pos' : 'neg'}">${stats.resolved_win_rate || 0}%</div>
        <div class="stat-sub">${stats.resolved_wins || 0}W / ${stats.resolved_losses || 0}L</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Exited Early</div>
        <div class="stat-value ${stats.early_exit_win_rate >= 50 ? 'pos' : 'neg'}">${stats.early_exit_win_rate || 0}%</div>
        <div class="stat-sub">${stats.early_exit_wins || 0}W / ${stats.early_exit_losses || 0}L</div>
      </div>
      <div class="stat-card ${(stats.early_exit_pnl_dollars || 0) >= 0 ? 'cyan' : 'red'}">
        <div class="stat-label">Early Exit P&L</div>
        <div class="stat-value ${(stats.early_exit_pnl_dollars || 0) >= 0 ? 'neutral' : 'neg'}">
          ${(stats.early_exit_pnl_dollars || 0) >= 0 ? '+' : ''}$${Math.abs(stats.early_exit_pnl_dollars || 0).toFixed(2)}
        </div>
        <div class="stat-sub">vs $${(stats.resolved_pnl_dollars || 0).toFixed(2)} held</div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="market-tabs" style="margin-bottom:20px">
      <button class="market-tab ${_predictionsTab==='positions'?'active':''}"
        onclick="setPredictionsTab('positions')">
        Open Positions ${open.length > 0 ? `<span class="badge badge-yellow" style="font-size:0.6rem;margin-left:4px">${open.length}</span>` : ''}
      </button>
      <button class="market-tab ${_predictionsTab==='history'?'active':''}"
        onclick="setPredictionsTab('history')">History</button>
      <button class="market-tab ${_predictionsTab==='watchlist'?'active':''}"
        onclick="setPredictionsTab('watchlist')">
        Watchlist ${watchlist.length > 0 ? `<span class="badge badge-gray" style="font-size:0.6rem;margin-left:4px">${watchlist.length}</span>` : ''}
      </button>
      <button class="market-tab ${_predictionsTab==='markets'?'active':''}"
        onclick="setPredictionsTab('markets')">Browse Markets</button>
    </div>

    <div id="predictions-tab-content"></div>
  `;

  _renderPredictionsTab(preds, watchlist);
}

function setPredictionsTab(tab) {
  _predictionsTab = tab;
  document.querySelectorAll('#page-predictions .market-tab').forEach(t => {
    t.classList.toggle('active', t.textContent.trim().startsWith(
      tab === 'positions' ? 'Open' : tab === 'history' ? 'History' :
      tab === 'watchlist' ? 'Watchlist' : 'Browse'
    ));
  });
  _renderPredictionsTab(_predictionsData, []);
}

function _renderPredictionsTab(preds, watchlist) {
  const container = document.getElementById('predictions-tab-content');
  if (!container) return;

  if (_predictionsTab === 'positions') {
    const open = preds.filter(p => p.status === 'open');
    if (!open.length) {
      container.innerHTML = emptyStateHtml('◈', 'No open positions');
      return;
    }

    // Group by market_ticker
    const grouped = {};
    for (const p of open) {
      const t = p.market_ticker;
      if (!grouped[t]) {
        grouped[t] = {
          ...p,
          contracts:         0,
          total_cost_cents:  0,
          fills:             [],
        };
      }
      grouped[t].contracts        += p.contracts;
      grouped[t].total_cost_cents += (p.entry_price_cents || 0) * p.contracts;
      grouped[t].fills.push(p);
    }

    // Compute weighted average entry price
    for (const g of Object.values(grouped)) {
      g.avg_entry_cents   = g.contracts > 0
        ? Math.round(g.total_cost_cents / g.contracts)
        : 0;
      g.avg_entry_dollars = g.avg_entry_cents / 100;
    }

    container.innerHTML = Object.values(grouped).map(g => _positionCard(g)).join('');
  }

  else if (_predictionsTab === 'history') {
    const closed = preds.filter(p => p.status !== 'open');
    if (!closed.length) {
      container.innerHTML = emptyStateHtml('◈', 'No closed positions yet');
      return;
    }
    // Group by status
    const groups = {
      'resolved_win':  closed.filter(p => p.status === 'resolved_win'),
      'resolved_loss': closed.filter(p => p.status === 'resolved_loss'),
      'exited_win':    closed.filter(p => p.status === 'exited_win'),
      'exited_loss':   closed.filter(p => p.status === 'exited_loss'),
    };
    container.innerHTML = `
      ${_historyGroup('✓ Resolved — Won', groups.resolved_win, 'var(--green)')}
      ${_historyGroup('✕ Resolved — Lost', groups.resolved_loss, 'var(--red)')}
      ${_historyGroup('↗ Exited Early — Win', groups.exited_win, 'var(--cyan)')}
      ${_historyGroup('↙ Exited Early — Loss', groups.exited_loss, '#ff9f43')}
    `;
  }

  else if (_predictionsTab === 'watchlist') {
    api.get('/predictions/watchlist').then(wl => {
      if (!wl.length) {
        container.innerHTML = emptyStateHtml('◉', 'No markets on watchlist — search and add markets');
        return;
      }
      container.innerHTML = wl.map(m => _watchlistCard(m)).join('');
    });
  }

  else if (_predictionsTab === 'markets') {
    container.innerHTML = `
      <div style="margin-bottom:16px">
        <div style="display:flex;gap:8px">
          <input id="market-search-input" class="form-input" placeholder="Search markets... (e.g. Fed rate, Bitcoin, NFL)"
            style="flex:1" onkeydown="if(event.key==='Enter') searchMarketsInline()">
          <button class="btn btn-primary" onclick="searchMarketsInline()">Search</button>
        </div>
      </div>
      <div id="market-search-results">${loadingHtml('Loading trending markets')}</div>
    `;
    // Load some default open markets
    api.get('/predictions/markets/search?q=&limit=20').then(markets => {
      _renderMarketResults(markets);
    }).catch(() => {
      document.getElementById('market-search-results').innerHTML =
        emptyStateHtml('◈', 'Kalshi not configured or unavailable');
    });
  }
}

// ── Card renderers ────────────────────────────────────────────────────────────

function _predictionCard(p) {
  const sideCls = p.side === 'yes' ? 'prediction-card-yes' : 'prediction-card-no';
  const statusBadge = _statusBadge(p.status);
  const entryPrice  = (p.entry_price_dollars || 0).toFixed(4);

  return `
    <div class="prediction-card ${sideCls}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            ${statusBadge}
            <span class="badge ${p.side==='yes'?'badge-green':'badge-red'}" style="font-size:0.65rem">
              ${p.side.toUpperCase()}
            </span>
            <span style="font-size:0.65rem;color:var(--text-3)">${p.category || ''}</span>
          </div>
          <div style="font-size:0.9rem;font-weight:600;margin-bottom:4px;line-height:1.4">
            ${p.market_title || p.market_ticker}
          </div>
          <div style="font-size:0.7rem;color:var(--text-3)">
            ${p.contracts} contract${p.contracts !== 1 ? 's' : ''} ·
            Entry $${entryPrice} · ${_fmtDate(p.opened_at)}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px">${p.market_ticker}</div>
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <button class="btn btn-sm btn-ghost" onclick="openExitPredictionModal(${p.id})">Exit Early</button>
            <button class="btn btn-sm btn-danger btn-icon" onclick="deletePrediction(${p.id})">✕</button>
          </div>
        </div>
      </div>
    </div>`;
}

function _historyGroup(label, preds, color) {
  if (!preds.length) return '';
  return `
    <div style="margin-bottom:20px">
      <div style="font-size:0.72rem;color:${color};font-weight:600;
                  text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">
        ${label} (${preds.length})
      </div>
      ${preds.map(p => {
        const pnl = p.pnl_dollars;
        return `
          <div class="prediction-card" style="cursor:default;margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <div style="flex:1;min-width:0">
                <div style="font-size:0.85rem;font-weight:600;margin-bottom:2px">${p.market_title || p.market_ticker}</div>
                <div style="font-size:0.7rem;color:var(--text-3)">
                  ${p.contracts} contracts · ${p.side.toUpperCase()} ·
                  Entry $${(p.entry_price_dollars||0).toFixed(4)} ·
                  ${p.exit_type === 'early_exit' ? 'Exited early' : 'Resolved'}
                  ${p.closed_at ? _fmtDate(p.closed_at) : ''}
                </div>
              </div>
              ${pnl !== null ? `
              <div class="${pnl >= 0 ? 'pos' : 'neg'}" style="font-weight:700;font-size:1rem">
                ${pnl >= 0 ? '+' : ''}$${Math.abs(pnl).toFixed(2)}
              </div>` : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function _watchlistCard(m) {
  const yesPrice = m.yes_price_cents ? (m.yes_price_cents / 100).toFixed(2) : '—';
  const noPrice  = m.no_price_cents  ? (m.no_price_cents  / 100).toFixed(2) : '—';
  return `
    <div class="prediction-card prediction-card-open" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.88rem;font-weight:600;margin-bottom:4px">${m.market_title}</div>
          <div style="font-size:0.7rem;color:var(--text-3)">
            ${m.market_ticker} · ${m.category || ''}
            ${m.close_time ? ` · Closes ${_fmtDate(m.close_time)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div style="text-align:center">
            <div style="font-size:0.62rem;color:var(--green);text-transform:uppercase">YES</div>
            <div style="font-size:0.95rem;font-weight:700;color:var(--green)">$${yesPrice}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:0.62rem;color:var(--red);text-transform:uppercase">NO</div>
            <div style="font-size:0.95rem;font-weight:700;color:var(--red)">$${noPrice}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <button class="btn btn-sm btn-primary" style="font-size:0.7rem"
              onclick="openOrderModal('${m.market_ticker}', '${m.market_title}')">Trade</button>
            <button class="btn btn-sm btn-ghost btn-icon"
              onclick="removeFromWatchlist('${m.market_ticker}')">✕</button>
          </div>
        </div>
      </div>
    </div>`;
}

function _renderMarketResults(markets) {
  const el = document.getElementById('market-search-results');
  if (!el) return;
  if (!markets.length) {
    el.innerHTML = emptyStateHtml('◈', 'No markets found');
    return;
  }
  el.innerHTML = markets.map(m => `
    <div class="prediction-card prediction-card-open" style="margin-bottom:8px;cursor:pointer"
      onclick="openOrderModal('${m.ticker}', '${m.title.replace(/'/g, "\\'")}')">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.85rem;font-weight:600;margin-bottom:2px">${m.title}</div>
          <div style="font-size:0.68rem;color:var(--text-3)">${m.ticker} · ${m.category}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div style="text-align:center">
            <div style="font-size:0.6rem;color:var(--green)">YES</div>
            <div style="font-size:0.9rem;font-weight:700;color:var(--green)">
              $${m.yes_price ? m.yes_price.toFixed(2) : '—'}
            </div>
          </div>
          <div style="text-align:center">
            <div style="font-size:0.6rem;color:var(--red)">NO</div>
            <div style="font-size:0.9rem;font-weight:700;color:var(--red)">
              $${m.no_price ? m.no_price.toFixed(2) : '—'}
            </div>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm btn-ghost btn-icon" title="Add to watchlist"
              onclick="event.stopPropagation();addToWatchlist('${m.ticker}','${m.title.replace(/'/g, "\\'")}')">
              ☆
            </button>
          </div>
        </div>
      </div>
    </div>`).join('');
}

async function searchMarketsInline() {
  const q  = document.getElementById('market-search-input')?.value || '';
  const el = document.getElementById('market-search-results');
  if (el) el.innerHTML = loadingHtml('Searching');
  try {
    const markets = await api.get(`/predictions/markets/search?q=${encodeURIComponent(q)}&limit=20`);
    _renderMarketResults(markets);
  } catch (e) {
    if (el) el.innerHTML = `<div style="color:var(--red)">${e.message}</div>`;
  }
}

// ── Order placement modal ─────────────────────────────────────────────────────

async function openOrderModal(ticker, title) {
  openModal(`
    <div class="modal-title">Place Order — ${title || ticker}</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:14px">${ticker}</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Side</label>
        <div class="radio-group">
          <div id="order-yes" class="radio-btn active-long" onclick="setOrderSide('yes')">YES</div>
          <div id="order-no"  class="radio-btn"             onclick="setOrderSide('no')">NO</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Action</label>
        <div class="radio-group">
          <div id="order-buy"  class="radio-btn active-long" onclick="setOrderAction('buy')">Buy</div>
          <div id="order-sell" class="radio-btn"             onclick="setOrderAction('sell')">Sell</div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Price ($) — e.g. 0.65</label>
        <input id="order-price" class="form-input" type="number" step="0.01" min="0.01" max="0.99"
          placeholder="0.00" oninput="updateOrderTotal()">
      </div>
      <div class="form-group">
        <label class="form-label">Contracts</label>
        <input id="order-contracts" class="form-input" type="number" min="1" value="1"
          oninput="updateOrderTotal()">
      </div>
    </div>
    <div id="order-confirm-box" style="display:none" class="order-confirm-box">
      <div class="order-line"><span>Ticker</span><span id="confirm-ticker">${ticker}</span></div>
      <div class="order-line"><span>Side</span><span id="confirm-side">YES</span></div>
      <div class="order-line"><span>Action</span><span id="confirm-action">BUY</span></div>
      <div class="order-line"><span>Price per contract</span><span id="confirm-price">$0.00</span></div>
      <div class="order-line"><span>Contracts</span><span id="confirm-contracts">1</span></div>
      <div class="order-line"><span>Total cost</span><span id="confirm-total">$0.00</span></div>
      <div id="confirm-warning" style="font-size:0.72rem;color:var(--yellow);margin-top:8px"></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-ghost" style="flex:1" onclick="previewOrder('${ticker}')">
        Preview Order
      </button>
      <button id="place-order-btn" class="btn btn-primary" style="flex:1;display:none"
        onclick="submitOrder('${ticker}')">
        Place Order
      </button>
    </div>
    <button class="btn btn-ghost btn-sm" style="width:100%;margin-top:8px"
      onclick="addToWatchlist('${ticker}','${(title||ticker).replace(/'/g, "\\'")}')">
      + Add to Watchlist instead
    </button>
  `);
  window._orderSide   = 'yes';
  window._orderAction = 'buy';
}

function setOrderSide(side) {
  window._orderSide = side;
  document.getElementById('order-yes').className = `radio-btn ${side==='yes'?'active-long':''}`;
  document.getElementById('order-no').className  = `radio-btn ${side==='no'?'active-short':''}`;
  document.getElementById('confirm-side').textContent = side.toUpperCase();
}

function setOrderAction(action) {
  window._orderAction = action;
  document.getElementById('order-buy').className  = `radio-btn ${action==='buy'?'active-long':''}`;
  document.getElementById('order-sell').className = `radio-btn ${action==='sell'?'active-short':''}`;
  document.getElementById('confirm-action').textContent = action.toUpperCase();
}

function updateOrderTotal() {
  const price     = parseFloat(document.getElementById('order-price')?.value || 0);
  const contracts = parseInt(document.getElementById('order-contracts')?.value || 1);
  const total     = price * contracts;
  const cp        = document.getElementById('confirm-price');
  const cc        = document.getElementById('confirm-contracts');
  const ct        = document.getElementById('confirm-total');
  if (cp) cp.textContent = `$${price.toFixed(4)}`;
  if (cc) cc.textContent = contracts;
  if (ct) ct.textContent = `$${total.toFixed(2)}`;
}

async function previewOrder(ticker) {
  const price     = parseFloat(document.getElementById('order-price')?.value || 0);
  const contracts = parseInt(document.getElementById('order-contracts')?.value || 1);
  if (!price || !contracts) { showToast('Enter price and contracts', 'error'); return; }

  try {
    const preview = await api.post('/predictions/orders/preview', {
      ticker, side: window._orderSide, action: window._orderAction,
      contracts, price,
    });
    document.getElementById('order-confirm-box').style.display = 'block';
    document.getElementById('place-order-btn').style.display   = 'block';
    const warn = document.getElementById('confirm-warning');
    if (warn) warn.textContent = preview.warning || '';
    updateOrderTotal();
  } catch (e) { showToast(e.message, 'error'); }
}

async function submitOrder(ticker) {
  const price     = parseFloat(document.getElementById('order-price')?.value || 0);
  const contracts = parseInt(document.getElementById('order-contracts')?.value || 1);

  if (!confirm(
    `⚠ CONFIRM ORDER\n\n` +
    `${window._orderAction.toUpperCase()} ${contracts} ${window._orderSide.toUpperCase()} contracts\n` +
    `${ticker} @ $${price.toFixed(4)}\n` +
    `Total: $${(price * contracts).toFixed(2)}\n\n` +
    `This will place a REAL order. Continue?`
  )) return;

  try {
    const result = await api.post('/predictions/orders', {
      ticker, side: window._orderSide, action: window._orderAction,
      contracts, price, confirm: true,
    });
    closeModal();
    showToast('Order placed ✓', 'success');
    renderPredictions();
  } catch (e) { showToast(e.message, 'error'); }
}

function _positionCard(g) {
  const sideCls = g.side === 'yes' ? 'prediction-card-yes' : 'prediction-card-no';
  return `
    <div class="prediction-card ${sideCls}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px">
            <span class="prediction-status-badge pred-open">● OPEN</span>
            <span class="badge ${g.side==='yes'?'badge-green':'badge-red'}" style="font-size:0.65rem">
              ${g.side.toUpperCase()}
            </span>
            <span style="font-size:0.65rem;color:var(--text-3)">${g.category || ''}</span>
          </div>
          <div style="font-size:0.9rem;font-weight:600;margin-bottom:4px;line-height:1.4">
            ${g.market_title || g.market_ticker}
          </div>
          <div style="font-size:0.7rem;color:var(--text-3)">
            ${g.contracts} contracts total ·
            Avg entry $${g.avg_entry_dollars.toFixed(4)} ·
            ${g.fills.length} fill${g.fills.length !== 1 ? 's' : ''}
          </div>
          ${g.fills.length > 1 ? `
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:2px">
            ${g.fills.filter(f => f.contracts > 0).map(f => `
              <div style="font-size:0.68rem;color:var(--text-3)">
                &nbsp;↳ ${f.contracts} contracts @ $${(f.entry_price_cents/100).toFixed(4)}
              </div>`).join('')}
          </div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:6px">${g.market_ticker}</div>
          <div style="display:flex;gap:6px;justify-content:flex-end">
            <button class="btn btn-sm btn-ghost"
              onclick="openExitPositionByTicker('${g.market_ticker}', ${g.fills.map(f=>f.id).join(',')})"
          </div>
        </div>
      </div>
    </div>`;
}

// ── Watchlist actions ─────────────────────────────────────────────────────────

async function addToWatchlist(ticker, title) {
  try {
    await api.post('/predictions/watchlist', { market_ticker: ticker, market_title: title || ticker });
    showToast(`${ticker} added to watchlist ✓`, 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeFromWatchlist(ticker) {
  try {
    await api.del(`/predictions/watchlist/${ticker}`);
    showToast('Removed from watchlist', 'success');
    renderPredictions();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Exit prediction modal ─────────────────────────────────────────────────────

function openExitPositionByTicker(ticker, ...ids) {
  openModal(`
    <div class="modal-title">Exit Position — ${ticker}</div>
    <div style="font-size:0.8rem;color:var(--text-2);margin-bottom:14px">
      This will close all ${ids.length} fill(s) for this market.
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Exit Price ($)</label>
      <input id="exit-price" class="form-input" type="number" step="0.01"
        min="0.01" max="0.99" placeholder="Current market price">
    </div>
    <button class="btn btn-primary" onclick="submitExitAll([${ids}])" style="width:100%">
      Confirm Exit
    </button>
  `);
}

async function submitExitAll(ids) {
  const price = parseFloat(document.getElementById('exit-price')?.value || 0);
  if (!price) { showToast('Enter exit price', 'error'); return; }
  try {
    await Promise.all(ids.map(id => api.post(`/predictions/${id}/close`, { exit_price: price })));
    closeModal();
    showToast(`${ids.length} fill(s) closed ✓`, 'success');
    renderPredictions();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Manual log modal ──────────────────────────────────────────────────────────

function openManualPredictionModal() {
  openModal(`
    <div class="modal-title">Log Prediction Manually</div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Market Ticker</label>
        <input id="mp-ticker" class="form-input" placeholder="e.g. INXD-25DEC31-T4500">
      </div>
      <div class="form-group">
        <label class="form-label">Market Title</label>
        <input id="mp-title" class="form-input" placeholder="Will SPX close above 4500?">
      </div>
      <div class="form-group">
        <label class="form-label">Side</label>
        <select id="mp-side" class="form-select">
          <option value="yes">YES</option>
          <option value="no">NO</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Contracts</label>
        <input id="mp-contracts" class="form-input" type="number" min="1" value="1">
      </div>
      <div class="form-group">
        <label class="form-label">Entry Price ($)</label>
        <input id="mp-price" class="form-input" type="number" step="0.01" placeholder="0.65">
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select id="mp-category" class="form-select">
          <option value="economics">Economics</option>
          <option value="politics">Politics</option>
          <option value="sports">Sports</option>
          <option value="crypto">Crypto</option>
          <option value="weather">Weather</option>
          <option value="other">Other</option>
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes</label>
      <textarea id="mp-notes" class="form-textarea" placeholder="Your thesis..."></textarea>
    </div>
    <button class="btn btn-primary" onclick="submitManualPrediction()" style="width:100%">
      Log Prediction
    </button>
  `);
}

async function submitManualPrediction() {
  const ticker = document.getElementById('mp-ticker')?.value.trim();
  const price  = document.getElementById('mp-price')?.value;
  if (!ticker || !price) { showToast('Ticker and price required', 'error'); return; }
  try {
    await api.post('/predictions/', {
      market_ticker: ticker,
      market_title:  document.getElementById('mp-title')?.value || ticker,
      side:          document.getElementById('mp-side')?.value,
      contracts:     document.getElementById('mp-contracts')?.value,
      entry_price:   price,
      category:      document.getElementById('mp-category')?.value,
      notes:         document.getElementById('mp-notes')?.value,
      action:        'buy',
    });
    closeModal();
    showToast('Prediction logged ✓', 'success');
    renderPredictions();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deletePrediction(id) {
  confirmAction('Delete this prediction?', async () => {
    try {
      await api.del(`/predictions/${id}`);
      showToast('Deleted', 'success');
      renderPredictions();
    } catch (e) { showToast(e.message, 'error'); }
  });
}

// ── Search modal ──────────────────────────────────────────────────────────────

function openMarketSearch() {
  setPredictionsTab('markets');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _statusBadge(status) {
  const map = {
    'open':          '<span class="prediction-status-badge pred-open">● OPEN</span>',
    'resolved_win':  '<span class="prediction-status-badge pred-resolved-win">✓ WON</span>',
    'resolved_loss': '<span class="prediction-status-badge pred-resolved-loss">✕ LOST</span>',
    'exited_win':    '<span class="prediction-status-badge pred-exited-win">↗ EXITED+</span>',
    'exited_loss':   '<span class="prediction-status-badge pred-exited-loss">↙ EXITED-</span>',
  };
  return map[status] || `<span class="badge badge-gray">${status}</span>`;
}

function _fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso.substring(0, 10); }
}
