const _activeCharts = {};

function destroyChart(id) {
  if (_activeCharts[id]) { _activeCharts[id].destroy(); delete _activeCharts[id]; }
}

function mountChart(canvasId, series, rangeKey, height = 220, opts = {}) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  canvas.dataset.height = height;
  const chart = new LineChart(canvas, opts);
  chart.setData(series, rangeKey);
  _activeCharts[canvasId] = chart;
  return chart;
}

function _tintClass(val) {
  if (val === null || val === undefined) return '';
  return parseFloat(val) < 0 ? 'chart-card-negative' : '';
}

// ─────────────────────────────────────────
//  CHARTS PAGE
// ─────────────────────────────────────────

let chartsRange = '1m';

async function renderCharts() {
  const el = document.getElementById('page-charts');
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Analytics</div>
        <div class="page-subtitle">Progress across all modules</div>
      </div>
    </div>
    ${rangeBar(chartsRange, 'setChartsRange')}
    <div id="charts-body" style="display:flex;flex-direction:column;gap:24px;margin-top:20px">
      ${loadingHtml('Building charts')}
    </div>
  `;
  await loadAllCharts();
}

function setChartsRange(range) {
  chartsRange = range;
  document.querySelectorAll('#page-charts .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  loadAllCharts();
}

async function loadAllCharts() {
  const body = document.getElementById('charts-body');
  if (!body) return;
  body.innerHTML = loadingHtml('Loading data');

  try {
    const [spendData, tradeData, gambData, nwData] = await Promise.all([
      api.get(`/charts/spending?range=${chartsRange}`),
      api.get(`/charts/trades?range=${chartsRange}`),
      api.get(`/charts/gambling?range=${chartsRange}`),
      api.get('/charts/networth'),
    ]);

    const nwPts    = nwData.net_worth || [];
    const nwLast   = nwPts.length ? nwPts[nwPts.length - 1].v : 0;
    const tradePts = tradeData.cumulative_pnl || [];
    const tradeLast= tradePts.length ? tradePts[tradePts.length - 1].v : 0;
    const cashPts  = spendData.balance || [];
    const cashLast = cashPts.length ? cashPts[cashPts.length - 1].v : 0;
    const gambPts  = gambData.cumulative_pnl || [];
    const gambLast = gambPts.length ? gambPts[gambPts.length - 1].v : 0;

    body.innerHTML = `
      ${_chartCard('net-worth',     'Net Worth',           'Combined across all accounts',     nwPts.length > 1,    nwLast)}
      ${_chartCard('trade-pnl',     'Trade P&L',           'Cumulative crypto trading',         tradePts.length > 1, tradeLast)}
      ${_chartCard('cash-balance',  'Cash Balance',        'Running checkbook balance',         cashPts.length > 1,  cashLast)}
      ${_chartCard('income-expense','Income vs Expenses',  'Daily income and spending',         (spendData.income?.length > 0 || spendData.expenses?.length > 0), null, true)}
      ${_categorySection(spendData.by_category)}
      ${_chartCard('gamble-pnl',    'Gambling P&L',        'Cumulative gambling profit/loss',   gambPts.length > 1,  gambLast)}
    `;

    if (nwPts.length > 1)
      mountChart('canvas-net-worth', [{ label: 'Net Worth', color: '#00d2ff', points: nwPts }], chartsRange, 240);

    if (tradePts.length > 1)
      mountChart('canvas-trade-pnl', [{ label: 'Trade P&L', points: tradePts }], chartsRange);

    if (cashPts.length > 1)
      mountChart('canvas-cash-balance', [{ label: 'Balance', color: '#00d2ff', points: cashPts }], chartsRange);

    if (spendData.income?.length > 0 || spendData.expenses?.length > 0)
      mountChart('canvas-income-expense', [
        { label: 'Income',   color: '#00e676', points: spendData.income   || [] },
        { label: 'Expenses', color: '#ff4757', points: spendData.expenses || [] },
      ], chartsRange);

    const catColors = ['#a78bfa','#00d2ff','#ffd32a','#ff6b6b','#00e676','#ff9f43','#54a0ff','#ff4757'];
    Object.entries(spendData.by_category || {}).forEach(([cat, pts], i) => {
      const id = 'canvas-cat-' + _sid(cat);
      if (document.getElementById(id))
        mountChart(id, [{ label: cat, color: catColors[i % catColors.length], points: pts }], chartsRange, 160, {
          formatValue: v => '$' + Math.abs(v).toFixed(0),
          formatTooltipValue: v => '$' + parseFloat(v).toLocaleString('en-US', { minimumFractionDigits: 2 })
        });
    });

    if (gambPts.length > 1)
      mountChart('canvas-gamble-pnl', [{ label: 'Gambling P&L', points: gambPts }], chartsRange);

  } catch (e) {
    body.innerHTML = `<div style="color:var(--red);padding:20px">Error: ${e.message}</div>`;
  }
}

function _chartCard(id, title, subtitle, hasData, lastVal, multiSeries = false) {
  const tint = lastVal !== null ? _tintClass(lastVal) : '';
  return `
    <div class="chart-card ${tint}">
      <div class="chart-card-header">
        <div>
          <div class="chart-title">${title}</div>
          <div class="chart-subtitle">${subtitle}</div>
        </div>
      </div>
      ${hasData
        ? `<div class="chart-wrap"><canvas id="canvas-${id}"></canvas></div>`
        : `<div class="chart-empty">${emptyStateHtml('◈', 'No data for this range yet')}</div>`}
    </div>`;
}

function _categorySection(byCategory) {
  const cats = Object.keys(byCategory || {});
  if (!cats.length) return '';
  return `
    <div class="chart-card">
      <div class="chart-card-header">
        <div class="chart-title">Spending by Category</div>
        <div class="chart-subtitle">Each expense category over time — click to zoom</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:4px">
        ${cats.map(cat => `
          <div class="cat-chart-item" onclick="openCategoryModal('${_sid(cat)}','${cat}')">
            <div style="font-size:0.72rem;color:var(--text-2);margin-bottom:6px;font-weight:500;display:flex;justify-content:space-between">
              <span>${cat}</span><span style="color:var(--text-3);font-size:0.65rem">↗ expand</span>
            </div>
            <div class="chart-wrap" style="height:160px">
              <canvas id="canvas-cat-${_sid(cat)}"></canvas>
            </div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ─────────────────────────────────────────
//  CATEGORY MODAL
// ─────────────────────────────────────────

async function openCategoryModal(sid, label) {
  openModal(`
    <div class="modal-title">${label}</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin:-10px 0 14px">Spending over time</div>
    ${rangeBar('1m', 'setCatModalRange', sid)}
    <div id="cat-modal-wrap" class="chart-wrap" style="height:260px;margin-top:14px">
      ${loadingHtml('Loading')}
    </div>
  `);
  window._catModalSid   = sid;
  window._catModalLabel = label;
  await _loadCatModal(sid, label, '1m');
}

async function setCatModalRange(range, sid) {
  document.querySelectorAll('#modal-content .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  await _loadCatModal(sid, window._catModalLabel, range);
}

async function _loadCatModal(sid, label, range) {
  const wrap = document.getElementById('cat-modal-wrap');
  if (!wrap) return;
  wrap.innerHTML = loadingHtml('Loading');
  try {
    const data = await api.get(`/charts/spending?range=${range}`);
    const pts  = (data.by_category || {})[label] || [];
    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">Not enough data</div>`;
      return;
    }
    wrap.innerHTML = `<canvas id="canvas-cat-modal"></canvas>`;
    mountChart('canvas-cat-modal', [{ label, color: '#a78bfa', points: pts }], range, 260, {
      formatValue: v => '$' + Math.abs(v).toFixed(0),
      formatTooltipValue: v => '$' + parseFloat(v).toFixed(2)
    });
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}


// ─────────────────────────────────────────
//  NET WORTH HERO  (for dashboard)
// ─────────────────────────────────────────

async function renderNetWorthHero(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = loadingHtml('');

  try {
    const data = await api.get('/charts/networth');
    const pts  = data.net_worth || [];
    if (pts.length < 2) { el.innerHTML = ''; return; }

    const first = pts[0].v;
    const last  = pts[pts.length - 1].v;
    const chg   = last - first;
    const chgPct= (chg / Math.abs(first) * 100).toFixed(1);
    const isPos = last >= 0;
    const up    = chg >= 0;

    el.innerHTML = `
      <div class="nw-hero ${isPos ? '' : 'nw-negative'}">
        <div class="nw-hero-left">
          <div class="nw-label">NET WORTH</div>
          <div class="nw-value ${isPos ? 'pos' : 'neg'}">
            ${last < 0 ? '-' : ''}$${Math.abs(last).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
          </div>
          <div class="nw-change ${up ? 'pos' : 'neg'}">
            ${up ? '▲' : '▼'} ${up ? '+' : ''}$${chg.toFixed(2)} (${up?'+':''}${chgPct}%) all time
          </div>
        </div>
        <div class="nw-hero-chart">
          <canvas id="nw-hero-canvas" data-height="80"></canvas>
        </div>
      </div>
    `;

    // Mount sparkline in the hero
    destroyChart('nw-hero-canvas');
    const canvas = document.getElementById('nw-hero-canvas');
    if (canvas) {
      canvas.dataset.height = 80;
      const chart = new LineChart(canvas, {
        sparkline: true,
        splitFill: true,
        animate: true,
        animDuration: 900,
        zeroLine: false,
      });
      chart.setData([{ label: 'Net Worth', color: isPos ? '#00d2ff' : '#ff4757', points: pts }], 'all');
      _activeCharts['nw-hero-canvas'] = chart;
    }
  } catch (e) {
    el.innerHTML = '';
  }
}


// ─────────────────────────────────────────
//  COIN CHART MODAL
// ─────────────────────────────────────────

let _coinChartRange = '1m';

async function openCoinChart(coinId, symbol, name) {
  _coinChartRange = '1m';
  openModal(`
    <div class="modal-title">${symbol} — Price Chart</div>
    <div style="font-size:0.72rem;color:var(--text-3);margin:-10px 0 14px">${name || ''}</div>
    ${rangeBar(_coinChartRange, 'setCoinChartRange')}
    <div id="coin-chart-wrap" class="chart-wrap" style="height:260px;margin-top:14px">
      ${loadingHtml('Fetching price history')}
    </div>
    <div id="coin-chart-stats" style="margin-top:14px"></div>
  `);
  window._activeCoinChart = { coinId, symbol, name };
  await _loadCoinChart(coinId, _coinChartRange);
}

async function setCoinChartRange(range) {
  _coinChartRange = range;
  document.querySelectorAll('#modal-content .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  const { coinId } = window._activeCoinChart || {};
  if (coinId) await _loadCoinChart(coinId, range);
}

async function _loadCoinChart(coinId, range) {
  const wrap = document.getElementById('coin-chart-wrap');
  if (!wrap) return;
  wrap.innerHTML = loadingHtml('Fetching price history');
  try {
    const data = await api.get(`/charts/crypto/${coinId}?range=${range}`);
    const pts  = data.points || [];
    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">Not enough data for this range</div>`;
      return;
    }
    wrap.innerHTML = `<canvas id="canvas-coin-modal"></canvas>`;
    const first = pts[0].v, last = pts[pts.length-1].v;
    mountChart('canvas-coin-modal', [{ label: window._activeCoinChart?.symbol || coinId, points: pts }], range, 260, {
      formatValue: v => _fmtPriceAxis(v),
      formatTooltipValue: v => _fmtPriceTip(v),
      splitFill: true,
    });
    _updateChartStats('coin-chart-stats', first, last);
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}


// ─────────────────────────────────────────
//  STOCK CHART MODAL
// ─────────────────────────────────────────

let _stockChartRange = '1m';

async function openStockChart(ticker, name) {
  _stockChartRange = '1m';
  openModal(`
    <div class="modal-title">${ticker} — ${name || 'Price Chart'}</div>
    ${rangeBar(_stockChartRange, 'setStockChartRange')}
    <div id="stock-chart-wrap" class="chart-wrap" style="height:260px;margin-top:14px">
      ${loadingHtml('Fetching data')}
    </div>
    <div id="stock-chart-stats" style="margin-top:14px"></div>
  `);
  window._activeStockChart = { ticker, name };
  await _loadStockChart(ticker, _stockChartRange);
}

async function setStockChartRange(range) {
  _stockChartRange = range;
  document.querySelectorAll('#modal-content .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  const { ticker } = window._activeStockChart || {};
  if (ticker) await _loadStockChart(ticker, range);
}

async function _loadStockChart(ticker, range) {
  const wrap = document.getElementById('stock-chart-wrap');
  if (!wrap) return;
  wrap.innerHTML = loadingHtml('Fetching data');
  try {
    const data = await api.get(`/charts/stock/${ticker}?range=${range}`);
    const pts  = data.points || [];
    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">No data for this range</div>`;
      return;
    }
    wrap.innerHTML = `<canvas id="canvas-stock-modal"></canvas>`;
    const first = pts[0].v, last = pts[pts.length-1].v;
    mountChart('canvas-stock-modal', [{ label: ticker, points: pts }], range, 260, {
      formatValue: v => '$' + parseFloat(v).toFixed(0),
      formatTooltipValue: v => '$' + parseFloat(v).toLocaleString('en-US',{minimumFractionDigits:2}),
      splitFill: false,
    });
    _updateChartStats('stock-chart-stats', first, last);
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}


// ─────────────────────────────────────────
//  GAMBLING CHART MODAL
// ─────────────────────────────────────────

async function openGamblingChart(gameType) {
  openModal(`
    <div class="modal-title">${gameType || 'All Games'} — P&L Trend</div>
    ${rangeBar('all', 'setGambModalRange', gameType || 'all')}
    <div id="gamb-modal-wrap" class="chart-wrap" style="height:260px;margin-top:14px">
      ${loadingHtml('Loading')}
    </div>
  `);
  window._gambModalGame = gameType;
  await _loadGambModal(gameType, 'all');
}

async function setGambModalRange(range, game) {
  document.querySelectorAll('#modal-content .range-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  await _loadGambModal(game === 'all' ? null : game, range);
}

async function _loadGambModal(gameType, range) {
  const wrap = document.getElementById('gamb-modal-wrap');
  if (!wrap) return;
  wrap.innerHTML = loadingHtml('Loading');
  try {
    const data = await api.get(`/charts/gambling?range=${range}`);
    let pts = data.cumulative_pnl || [];
    if (gameType && gameType !== 'all')
      pts = pts.filter(p => p.game === gameType);
    if (pts.length < 2) {
      wrap.innerHTML = `<div style="color:var(--text-3);padding:20px;text-align:center">Not enough sessions for this range</div>`;
      return;
    }
    wrap.innerHTML = `<canvas id="canvas-gamb-modal"></canvas>`;
    mountChart('canvas-gamb-modal', [{ label: gameType || 'All Games', points: pts }], range, 260);
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
  }
}


// ─────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────

function _updateChartStats(elId, first, last) {
  const el = document.getElementById(elId);
  if (!el) return;
  const chg    = last - first;
  const chgPct = (chg / Math.abs(first) * 100);
  el.innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="stat-card" style="flex:1;min-width:100px;padding:12px 14px">
        <div class="stat-label">Open</div>
        <div class="stat-value" style="font-size:0.95rem">${_fmtPriceTip(first)}</div>
      </div>
      <div class="stat-card" style="flex:1;min-width:100px;padding:12px 14px">
        <div class="stat-label">Current</div>
        <div class="stat-value" style="font-size:0.95rem">${_fmtPriceTip(last)}</div>
      </div>
      <div class="stat-card ${chg >= 0 ? '' : 'red'}" style="flex:1;min-width:100px;padding:12px 14px">
        <div class="stat-label">Change</div>
        <div class="stat-value ${chg >= 0 ? 'pos' : 'neg'}" style="font-size:0.95rem">
          ${chg >= 0 ? '+' : ''}${chgPct.toFixed(2)}%
        </div>
      </div>
    </div>`;
}

function _fmtPriceAxis(v) {
  const n = parseFloat(v);
  if (n >= 10000) return '$' + (n/1000).toFixed(0) + 'k';
  if (n >= 1000)  return '$' + (n/1000).toFixed(1) + 'k';
  if (n >= 1)     return '$' + n.toFixed(2);
  if (n >= 0.01)  return '$' + n.toFixed(4);
  return '$' + n.toFixed(6);
}

function _fmtPriceTip(v) {
  const n = parseFloat(v);
  if (n >= 1)    return '$' + n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  if (n >= 0.01) return '$' + n.toFixed(6);
  return '$' + n.toExponential(4);
}

function _sid(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}