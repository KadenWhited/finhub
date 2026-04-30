// utils.js — shared helpers

function fmt(val, decimals = 2) {
  if (val === null || val === undefined) return '—';
  return parseFloat(val).toFixed(decimals);
}

function fmtUSD(val) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPnl(val) {
  if (val === null || val === undefined) return '<span class="zero">—</span>';
  const n = parseFloat(val);
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}$${Math.abs(n).toFixed(2)}</span>`;
}

function fmtPct(val) {
  if (val === null || val === undefined) return '—';
  const n = parseFloat(val);
  const sign = n > 0 ? '+' : '';
  const cls = n > 0 ? 'pos' : n < 0 ? 'neg' : '';
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

// Toast notification
function showToast(message, type = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = type ? `show ${type}` : 'show';
  setTimeout(() => { t.className = ''; }, 3000);
}

// Modal
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-content').innerHTML = '';
}

// Confirm
function confirmAction(msg, onConfirm) {
  if (confirm(msg)) onConfirm();
}

// Loading placeholder
function loadingHtml(msg = 'Loading') {
  return `<div class="loading dot-anim">${msg}</div>`;
}

// Empty state
function emptyStateHtml(icon, msg) {
  return `<div class="empty-state"><div class="empty-state-icon">${icon}</div><div class="empty-state-text">${msg}</div></div>`;
}

// Generic modal with a chart canvas — reused everywhere
function openChartModal(title, subtitle, bodyHtml, onMount) {
  openModal(`
    <div class="modal-title">${title}</div>
    ${subtitle ? `<div style="font-size:0.72rem;color:var(--text-3);margin:-10px 0 14px">${subtitle}</div>` : ''}
    ${bodyHtml}
  `);
  if (onMount) requestAnimationFrame(onMount);
}

// Reusable bar chart canvas block
function barCanvasBlock(id, height = 240) {
  return `<div class="chart-wrap" style="height:${height}px;margin-top:10px">
    <canvas id="${id}" data-height="${height}"></canvas>
  </div>`;
}

// Reusable line chart canvas block
function lineCanvasBlock(id, height = 220) {
  return `<div class="chart-wrap" style="height:${height}px;margin-top:10px">
    <canvas id="${id}" data-height="${height}"></canvas>
  </div>`;
}

// Chart registry so we can destroy on modal close
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

// Destroy all modal charts when modal closes (hook into closeModal)
const _origCloseModal = closeModal;
// eslint-disable-next-line no-global-assign
closeModal = function() {
  Object.keys(_modalCharts).forEach(k => {
    _modalCharts[k].destroy();
    delete _modalCharts[k];
  });
  _origCloseModal();
};