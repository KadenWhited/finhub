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
  gambling: { render: renderGambling },
  notes: { render: renderNotes },
  settings: { render: renderSettings },
  tools: { render: renderTools },
};

let currentPage = 'dashboard';

function navigateTo(page) {
  if (!pages[page]) return;

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  // Show target
  document.getElementById(`page-${page}`).classList.add('active');

  // Update sidebar nav
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
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

  // Nav clicks
  document.querySelectorAll('.nav-link, .mob-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

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

  // Initial page
  renderDashboard();
});
