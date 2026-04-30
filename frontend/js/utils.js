// utils.js — shared helpers

// ─────────────────────────────────────────
//  FORMATTERS
// ─────────────────────────────────────────

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return '—';
  return parseFloat(val).toFixed(decimals);
}

function fmtUSD(val) {
  if (val === null || val === undefined) return '—';
  const n    = parseFloat(val);
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}

function fmtPnl(val) {
  if (val === null || val === undefined) return '<span class="zero">—</span>';
  const n   = parseFloat(val);
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
  const sign= n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}$${Math.abs(n).toFixed(2)}</span>`;
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  const n    = parseFloat(val);
  const sign = n > 0 ? '+' : '';
  const cls  = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  return `<span class="${cls}">${sign}${n.toFixed(1)}%</span>`;
}

function fmtDate(str) {
  if (!str) return '—';
  return str.substring(0, 10);
}

function todayISO() {
  return new Date().toISOString().substring(0, 10);
}

function pnlClass(val) {
  if (val === null || val === undefined) return '';
  return parseFloat(val) > 0 ? 'pos' : parseFloat(val) < 0 ? 'neg' : 'zero';
}

// ─────────────────────────────────────────
//  UI HELPERS
// ─────────────────────────────────────────

function showToast(message, type = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className   = type ? `show ${type}` : 'show';
  setTimeout(() => { t.className = ''; }, 3000);
}

function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  _destroyModalCharts();
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}

function confirmAction(msg, onConfirm) {
  if (confirm(msg)) onConfirm();
}

function loadingHtml(msg = 'Loading') {
  return `<div class="loading dot-anim">${msg}</div>`;
}

function emptyStateHtml(icon, msg) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-text">${msg}</div>
  </div>`;
}

// ─────────────────────────────────────────
//  RANGE BAR  (shared across all chart pages)
// ─────────────────────────────────────────

const RANGE_OPTS = [
  { key: '6h',  label: '6H'  },
  { key: '1d',  label: '1D'  },
  { key: '1w',  label: '1W'  },
  { key: '1m',  label: '1M'  },
  { key: '3m',  label: '3M'  },
  { key: '6m',  label: '6M'  },
  { key: '1y',  label: '1Y'  },
  { key: 'all', label: 'ALL' },
];

function rangeBar(currentRange, onChangeFn, prefix) {
  return `<div class="range-bar">
    ${RANGE_OPTS.map(r =>
      `<button class="range-btn ${r.key === currentRange ? 'active' : ''}"
        data-range="${r.key}"
        onclick="${onChangeFn}('${r.key}'${prefix ? ",'" + prefix + "'" : ''})">${r.label}</button>`
    ).join('')}
  </div>`;
}

// ─────────────────────────────────────────
//  CANVAS BLOCK HELPERS
// ─────────────────────────────────────────

function lineCanvasBlock(id, height = 220) {
  return `<div class="chart-wrap" style="height:${height}px;margin-top:10px">
    <canvas id="${id}" data-height="${height}"></canvas>
  </div>`;
}

function barCanvasBlock(id, height = 240) {
  return `<div class="chart-wrap" style="height:${height}px;margin-top:10px">
    <canvas id="${id}" data-height="${height}"></canvas>
  </div>`;
}

// ─────────────────────────────────────────
//  CHART MODAL HELPERS
// ─────────────────────────────────────────

function openChartModal(title, subtitle, bodyHtml, onMount) {
  openModal(`
    <div class="modal-title">${title}</div>
    ${subtitle
      ? `<div style="font-size:0.72rem;color:var(--text-3);margin:-10px 0 14px">${subtitle}</div>`
      : ''}
    ${bodyHtml}
  `);
  if (onMount) requestAnimationFrame(onMount);
}

// Registry of charts mounted inside modals — destroyed when modal closes
const _modalCharts = {};

function _mountModalBar(id, data, opts = {}) {
  if (_modalCharts[id]) { _modalCharts[id].destroy(); delete _modalCharts[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const chart = new BarChart(canvas, opts);
  chart.setData(data);
  _modalCharts[id] = chart;
  return chart;
}

function _mountModalLine(id, series, rangeKey, height = 220, opts = {}) {
  if (_modalCharts[id]) { _modalCharts[id].destroy(); delete _modalCharts[id]; }
  const canvas = document.getElementById(id);
  if (!canvas) return;
  canvas.dataset.height = height;
  const chart = new LineChart(canvas, opts);
  chart.setData(series, rangeKey);
  _modalCharts[id] = chart;
  return chart;
}

function _destroyModalCharts() {
  Object.keys(_modalCharts).forEach(k => {
    try { _modalCharts[k].destroy(); } catch (e) {}
    delete _modalCharts[k];
  });
}