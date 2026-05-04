// app.js — router & initialization

fetch('/api/auth/check')
  .then(r => r.json())
  .then(d => {
    if (!d.authenticated) window.location.href = '/login';
  });

const pages = {
  dashboard: { render: renderDashboard },
  trades: { render: renderTrades },
  checkbook: { render: renderCheckbook },
  credit: { render: renderCredit },
  budget: { render: renderBudget },
  market: { render: renderMarket },
  gambling: { render: renderGambling },
  predictions: { render: renderPredictions },
  notes: { render: renderNotes },
  backtester: { render: renderBacktester },
  news: { render: renderNews },
  settings: { render: renderSettings },
  tools: { render: renderTools },
  stocks: { render: renderStocks },
  charts: { render: renderCharts },
  connections: { render: renderConnections },
};

let currentPage = 'dashboard';

initNavCustomize();

function navigateTo(page) {
  if (!pages[page]) return;
  if (currentPage === 'market') stopMarketAutoRefresh();
  if (currentPage === 'news' && typeof _newsRefreshTimer !== 'undefined') {
    clearInterval(_newsRefreshTimer);
  }
    
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target
  document.getElementById(`page-${page}`).classList.add('active');

  // Update mobile nav
  document.querySelectorAll('.mob-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  currentPage = page;
  pages[page].render();

  // Close mobile sidebar
  closeSidebar();
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

async function logOut() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  // Create sidebar overlay element
  const overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  document.body.appendChild(overlay);

  // Hamburger
  const ham = document.getElementById('hamburger');
  ham.addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    const isOpen = sidebar.classList.toggle('open');
    overlay.classList.toggle('active', isOpen);
  });

  overlay.addEventListener('click', closeSidebar);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  async function loadAppVersion() {
    try {
      const data = await api.get('/version');
      const el = document.getElementById('app-version');
      if (el) el.textContent = `v${data.version}`;
    } catch (e) {}
  }

  // Initial page
  renderDashboard();
  initPWA();
  loadAppVersion();
});