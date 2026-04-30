// modules/stocks.js
// Stage 2b — Stock watchlist, portfolio positions, S&P500

let stockWatchlist = [];
let stockPositions = [];

async function renderStocks() {
  const el = document.getElementById('page-stocks');
  el.innerHTML = loadingHtml('Loading stocks');

  try {
    const [wl, portfolio] = await Promise.all([
      api.get('/charts/stocks/watchlist'),
      api.get('/charts/stocks/positions')
    ]);
    stockWatchlist = wl;
    stockPositions = portfolio.positions || [];
    renderStocksView(el, wl, portfolio);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderStocksView(el, watchlist, portfolio) {
  const totalPnlClass = portfolio.total_pnl >= 0 ? 'pos' : 'neg';

  // Watchlist cards
  const wlCards = watchlist.length === 0
    ? `<div style="color:var(--text-3);font-size:0.8rem;padding:20px 0">No stocks on watchlist yet.</div>`
    : watchlist.map(item => {
        const q = item.quote;
        const up = q && q.change_pct >= 0;
        return `
          <div class="coin-card" onclick="openStockChart('${item.ticker}', '${(item.name || item.ticker).replace(/'/g,'')}')" style="cursor:pointer">
            <div class="coin-card-header">
              <div>
                <div class="coin-sym">${item.ticker}</div>
                <div class="coin-name">${item.name || ''}</div>
              </div>
              <button class="btn btn-sm btn-danger btn-icon"
                onclick="event.stopPropagation();removeStockWatch('${item.ticker}')" title="Remove">✕</button>
            </div>
            ${q
              ? `<div class="coin-price">$${parseFloat(q.price).toFixed(2)}</div>
                 <div class="coin-stats">
                   <div class="coin-stat">
                     <div class="coin-stat-label">Day</div>
                     <div class="coin-stat-val ${up ? 'pos' : 'neg'}">${up ? '+' : ''}${q.change_pct}%</div>
                   </div>
                   <div class="coin-stat">
                     <div class="coin-stat-label">Change</div>
                     <div class="coin-stat-val ${up ? 'pos' : 'neg'}">${q.change_amt >= 0 ? '+' : ''}$${Math.abs(q.change_amt).toFixed(2)}</div>
                   </div>
                   <div class="coin-stat">
                     <div class="coin-stat-label">Chart</div>
                     <div class="coin-stat-val" style="color:var(--cyan);font-size:0.68rem">↗ View</div>
                   </div>
                 </div>`
              : `<div style="color:var(--text-3);font-size:0.72rem;margin-top:8px">${item.quote_error || 'Price unavailable'}</div>`
            }
          </div>
        `;
      }).join('');

  // Portfolio positions table
  const posRows = stockPositions.length === 0
    ? `<tr class="empty-row"><td colspan="8">${emptyStateHtml('◇', 'No positions logged yet')}</td></tr>`
    : stockPositions.map(p => `
        <tr onclick="openStockChart('${p.ticker}','${(p.name || p.ticker).replace(/'/g,'')}')" style="cursor:pointer">
          <td><strong>${p.ticker}</strong></td>
          <td>${p.shares}</td>
          <td>$${parseFloat(p.avg_cost).toFixed(2)}</td>
          <td>${p.current_price ? '$' + parseFloat(p.current_price).toFixed(2) : '<span class="zero">—</span>'}</td>
          <td>$${parseFloat(p.cost_basis).toFixed(2)}</td>
          <td>${p.current_value ? '$' + parseFloat(p.current_value).toFixed(2) : '<span class="zero">—</span>'}</td>
          <td>${fmtPnl(p.pnl)}</td>
          <td>${p.pnl_pct !== null ? fmtPct(p.pnl_pct) : '—'}</td>
          <td>
            <button class="btn btn-sm btn-danger btn-icon" onclick="event.stopPropagation();deletePosition(${p.id})">✕</button>
          </td>
        </tr>
      `).join('');

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Stocks</div>
        <div class="page-subtitle">Portfolio & watchlist</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost" onclick="openAddStockWatchModal()">+ Watch Ticker</button>
        <button class="btn btn-primary" onclick="openAddPositionModal()">+ Log Position</button>
      </div>
    </div>

    ${portfolio.positions.length > 0 ? `
    <div class="stat-grid" style="margin-bottom:20px">
      <div class="stat-card cyan" style="cursor:pointer" onclick="openPortfolioValueBar()">
        <div class="stat-label">Portfolio Value</div>
        <div class="stat-value neutral">$${parseFloat(portfolio.total_value).toFixed(2)}</div>
        <div class="stat-sub">Current market value</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cost Basis</div>
        <div class="stat-value">$${parseFloat(portfolio.total_cost).toFixed(2)}</div>
        <div class="stat-sub">Total invested</div>
      </div>
      <div class="stat-card ${portfolio.total_pnl >= 0 ? '' : 'red'}" style="cursor:pointer" onclick="openPortfolioPnlBar()">
        <div class="stat-label">Unrealized P&L ↗</div>
        <div class="stat-value ${totalPnlClass}">${portfolio.total_pnl >= 0 ? '+' : ''}$${Math.abs(portfolio.total_pnl).toFixed(2)}</div>
        <div class="stat-sub">${portfolio.total_pnl_pct >= 0 ? '+' : ''}${portfolio.total_pnl_pct}%</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Positions</div>
        <div class="stat-value">${portfolio.positions.length}</div>
        <div class="stat-sub">tracked holdings</div>
      </div>
    </div>` : ''}

    <!-- Watchlist -->
    <div style="margin-bottom:28px">
      <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Watchlist</div>
      <div class="coin-grid">${wlCards}</div>
    </div>

    <!-- Positions table -->
    <div style="font-size:0.68rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">
      Portfolio Positions
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Shares</th>
            <th>Avg Cost</th>
            <th>Price</th>
            <th>Cost Basis</th>
            <th>Value</th>
            <th>P&L</th>
            <th>%</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${posRows}</tbody>
      </table>
    </div>

    <div style="font-size:0.7rem;color:var(--text-3);margin-top:12px">
      Click any row or card to open the price chart. Prices from Yahoo Finance (15–20 min delayed).
    </div>
  `;
}

// ─────────────────────────────────────────
//  STOCK WATCHLIST
// ─────────────────────────────────────────

function openAddStockWatchModal() {
  openModal(`
    <div class="modal-title">Watch a Stock / ETF</div>
    <div style="font-size:0.75rem;color:var(--text-3);margin-bottom:16px;line-height:1.7">
      Enter any ticker symbol. Examples: <strong>AAPL</strong>, <strong>SPY</strong> (S&P 500 ETF),
      <strong>^GSPC</strong> (S&P 500 index), <strong>TSLA</strong>, <strong>VOO</strong>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Ticker Symbol</label>
        <input id="sw-ticker" class="form-input" placeholder="SPY, AAPL, ^GSPC…"
          style="text-transform:uppercase" onkeydown="if(event.key==='Enter')submitStockWatch()">
      </div>
      <div class="form-group">
        <label class="form-label">Display Name (optional)</label>
        <input id="sw-name" class="form-input" placeholder="S&P 500 ETF">
      </div>
    </div>
    <div id="sw-error" style="color:var(--red);font-size:0.75rem;min-height:18px;margin-bottom:10px"></div>
    <button class="btn btn-primary" onclick="submitStockWatch()" style="width:100%">Add to Watchlist</button>
  `);
  setTimeout(() => document.getElementById('sw-ticker')?.focus(), 50);
}

async function submitStockWatch() {
  const ticker = document.getElementById('sw-ticker').value.trim().toUpperCase();
  const name = document.getElementById('sw-name').value.trim();
  const errEl = document.getElementById('sw-error');

  if (!ticker) { errEl.textContent = 'Ticker required'; return; }
  errEl.textContent = 'Validating…';

  try {
    await api.post('/charts/stocks/watchlist', { ticker, name: name || ticker });
    closeModal();
    showToast(`${ticker} added to watchlist ✓`, 'success');
    renderStocks();
  } catch (e) {
    errEl.textContent = e.message.includes('409') ? `${ticker} is already on your watchlist` : e.message;
  }
}

async function removeStockWatch(ticker) {
  try {
    await api.del(`/charts/stocks/watchlist/${ticker}`);
    showToast(`${ticker} removed`, 'success');
    renderStocks();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// ─────────────────────────────────────────
//  POSITIONS
// ─────────────────────────────────────────

function openAddPositionModal() {
  openModal(`
    <div class="modal-title">Log Stock Position</div>
    <div style="font-size:0.75rem;color:var(--text-3);margin-bottom:16px">
      Log shares you own to track unrealized P&L. Use <strong>SPY</strong> or <strong>VOO</strong> to track S&P 500 investments.
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">Ticker</label>
        <input id="pos-ticker" class="form-input" placeholder="SPY, AAPL…" style="text-transform:uppercase">
      </div>
      <div class="form-group">
        <label class="form-label">Shares</label>
        <input id="pos-shares" class="form-input" type="number" step="any" placeholder="10">
      </div>
      <div class="form-group">
        <label class="form-label">Avg Cost Per Share ($)</label>
        <input id="pos-cost" class="form-input" type="number" step="any" placeholder="450.00">
      </div>
      <div class="form-group">
        <label class="form-label">Purchase Date</label>
        <input id="pos-date" class="form-input" type="date" value="${todayISO()}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:18px">
      <label class="form-label">Notes (optional)</label>
      <input id="pos-notes" class="form-input" placeholder="DCA buy, lump sum…">
    </div>
    <button class="btn btn-primary" onclick="submitPosition()" style="width:100%">Log Position</button>
  `);
}

async function submitPosition() {
  const ticker = document.getElementById('pos-ticker').value.trim().toUpperCase();
  const shares = document.getElementById('pos-shares').value;
  const cost = document.getElementById('pos-cost').value;
  const date = document.getElementById('pos-date').value;

  if (!ticker || !shares || !cost || !date) { showToast('Fill in all required fields', 'error'); return; }

  try {
    await api.post('/charts/stocks/positions', {
      ticker, shares, avg_cost: cost, purchase_date: date,
      notes: document.getElementById('pos-notes').value
    });
    closeModal();
    showToast(`${ticker} position logged ✓`, 'success');
    renderStocks();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function deletePosition(id) {
  confirmAction('Remove this position?', async () => {
    try {
      await api.del(`/charts/stocks/positions/${id}`);
      showToast('Position removed', 'success');
      renderStocks();
    } catch (e) {
      showToast(e.message, 'error');
    }
  });
}

async function openPortfolioValueBar() {
  openChartModal('Portfolio Value by Position', 'Current market value per holding',
    barCanvasBlock('modal-port-val', 240));
  try {
    const portfolio = await api.get('/charts/stocks/positions');
    const data = portfolio.positions
      .filter(p => p.current_value)
      .sort((a,b) => b.current_value - a.current_value)
      .map(p => ({
        label: p.ticker,
        value: parseFloat(p.current_value.toFixed(2)),
        color: '#a78bfa'
      }));
    _mountModalBar('modal-port-val', data, {
      formatValue: v => '$' + Math.abs(v).toFixed(0),
      formatTooltipValue: v => '$' + parseFloat(v).toFixed(2),
    });
  } catch(e) { showToast(e.message,'error'); }
}

async function openPortfolioPnlBar() {
  openChartModal('Unrealized P&L by Position', 'Gain/loss on each holding',
    barCanvasBlock('modal-port-pnl', 240));
  try {
    const portfolio = await api.get('/charts/stocks/positions');
    const data = portfolio.positions
      .filter(p => p.pnl !== null)
      .sort((a,b) => b.pnl - a.pnl)
      .map(p => ({
        label: p.ticker,
        value: parseFloat(p.pnl.toFixed(2))
      }));
    _mountModalBar('modal-port-pnl', data);
  } catch(e) { showToast(e.message,'error'); }
}