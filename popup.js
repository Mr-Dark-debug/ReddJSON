/**
 * ReddJSON Popup Script
 * ═══════════════════════════════════════════════════════════════════
 * Manages the popup UI: history list, search, export, JSON viewer
 * modal, and delete/clear operations.
 *
 * Communicates with the background service worker via
 * chrome.runtime.sendMessage().
 *
 * @fileoverview Popup interface controller
 * @author ReddJSON Team
 * @version 1.0.0
 */

// ============================================================================
// STATE
// ============================================================================

/** @type {Array<object>} Current history data */
let historyData = [];

/** @type {object|null} Entry currently displayed in the JSON modal */
let currentEntry = null;

/** @type {number|null} Debounce timer ID for search */
let searchDebounceTimer = null;

// ============================================================================
// DOM REFERENCES
// ============================================================================

const $ = (id) => document.getElementById(id);

const el = {
  historyList: $('historyList'),
  emptyState: $('emptyState'),
  loadingState: $('loadingState'),
  searchInput: $('searchInput'),
  clearSearchBtn: $('clearSearchBtn'),
  exportBtn: $('exportBtn'),
  clearAllBtn: $('clearAllBtn'),
  statsCount: $('statsCount'),
  statsStorage: $('statsStorage'),

  // JSON viewer modal
  jsonModal: $('jsonModal'),
  modalTitle: $('modalTitle'),
  jsonContent: $('jsonContent'),
  modalCopyBtn: $('modalCopyBtn'),
  modalCloseBtn: $('modalCloseBtn'),

  // Confirm dialog
  confirmModal: $('confirmModal'),
  confirmTitle: $('confirmTitle'),
  confirmMessage: $('confirmMessage'),
  confirmOkBtn: $('confirmOkBtn'),
  confirmCancelBtn: $('confirmCancelBtn'),

  // Toast
  toast: $('toast'),
  toastMessage: $('toastMessage'),
};

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Truncates a string with ellipsis.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max = 80) {
  if (!str) return '';
  return str.length <= max ? str : str.substring(0, max - 1) + '…';
}

/**
 * Formats a timestamp as a human-friendly relative time string.
 * @param {number} timestamp - Unix ms timestamp
 * @returns {string}
 */
function timeAgo(timestamp) {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - timestamp;
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const w = Math.floor(d / 7);
  const mo = Math.floor(d / 30);

  if (s < 60) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  if (w < 5) return `${w}w ago`;
  if (mo < 12) return `${mo}mo ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Formats a number with K/M suffix.
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// ============================================================================
// TOAST
// ============================================================================

/** @type {number|null} */
let toastTimer = null;

/**
 * Shows a toast notification at the bottom of the popup.
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showToast(message, type = 'info') {
  el.toastMessage.textContent = message;
  el.toast.className = `toast ${type}`;
  el.toast.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.add('hidden');
  }, 2500);
}

// ============================================================================
// MODALS
// ============================================================================

/**
 * Shows the full JSON viewer modal for an entry.
 * @param {object} entry
 */
function showJsonModal(entry) {
  currentEntry = entry;
  el.modalTitle.textContent = truncate(entry.title, 50);
  el.jsonContent.textContent = JSON.stringify(entry.fullJson, null, 2);
  el.jsonModal.classList.remove('hidden');
}

/** Hides the JSON viewer modal. */
function hideJsonModal() {
  el.jsonModal.classList.add('hidden');
  currentEntry = null;
}

/**
 * Shows the confirmation dialog.
 * @param {string} title
 * @param {string} message
 * @param {string} actionLabel - Text for the action button
 * @param {Function} onConfirm
 */
function showConfirm(title, message, actionLabel, onConfirm) {
  el.confirmTitle.textContent = title;
  el.confirmMessage.textContent = message;
  el.confirmOkBtn.textContent = actionLabel;
  el.confirmModal.classList.remove('hidden');

  const handleOk = async () => {
    cleanup();
    el.confirmModal.classList.add('hidden');
    await onConfirm();
  };
  const handleCancel = () => {
    cleanup();
    el.confirmModal.classList.add('hidden');
  };
  const cleanup = () => {
    el.confirmOkBtn.removeEventListener('click', handleOk);
    el.confirmCancelBtn.removeEventListener('click', handleCancel);
  };

  el.confirmOkBtn.addEventListener('click', handleOk);
  el.confirmCancelBtn.addEventListener('click', handleCancel);
}

// ============================================================================
// HISTORY DATA OPERATIONS
// ============================================================================

/**
 * Loads history from the background service worker.
 * @returns {Promise<Array>}
 */
async function loadHistory() {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'getHistory' });
    historyData = res?.history || [];
    return historyData;
  } catch (err) {
    console.error('[ReddJSON] Load history error:', err);
    return [];
  }
}

/**
 * Deletes a single history entry.
 * @param {string} entryId
 */
async function deleteEntry(entryId) {
  try {
    const res = await chrome.runtime.sendMessage({ action: 'deleteHistoryEntry', entryId });
    if (res?.success) {
      historyData = historyData.filter(e => e.id !== entryId);
      renderHistory(el.searchInput.value.trim());
      updateStats();
      showToast('Entry deleted', 'success');
    }
  } catch (err) {
    console.error('[ReddJSON] Delete error:', err);
    showToast('Failed to delete', 'error');
  }
}

/**
 * Clears all history (with confirmation dialog).
 */
function clearAllHistory() {
  showConfirm(
    'Clear All History',
    'Delete all history entries? This cannot be undone.',
    'Clear All',
    async () => {
      try {
        const res = await chrome.runtime.sendMessage({ action: 'clearHistory' });
        if (res?.success) {
          historyData = [];
          renderHistory();
          updateStats();
          showToast('History cleared', 'success');
        }
      } catch (err) {
        console.error('[ReddJSON] Clear error:', err);
        showToast('Failed to clear history', 'error');
      }
    }
  );
}

/**
 * Copies the full JSON of an entry to clipboard.
 * @param {object} entry
 */
async function copyJson(entry) {
  try {
    await navigator.clipboard.writeText(JSON.stringify(entry.fullJson, null, 2));
    showToast('JSON copied to clipboard!', 'success');
  } catch (err) {
    console.error('[ReddJSON] Clipboard error:', err);
    showToast('Copy failed', 'error');
  }
}

/**
 * Exports all history as a downloadable JSON file.
 */
function exportHistory() {
  if (historyData.length === 0) {
    showToast('No history to export', 'error');
    return;
  }

  try {
    const data = historyData.map(e => ({
      permalink: e.permalink,
      title: e.title,
      subreddit: e.subreddit,
      postId: e.postId,
      timestamp: e.timestamp,
      copiedCount: e.copiedCount,
      json: e.fullJson,
    }));

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reddjson-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`Exported ${data.length} entries`, 'success');
  } catch (err) {
    console.error('[ReddJSON] Export error:', err);
    showToast('Export failed', 'error');
  }
}

// ============================================================================
// UI RENDERING
// ============================================================================

/**
 * Creates a DOM element for a single history entry card.
 * @param {object} entry
 * @returns {HTMLElement}
 */
function createEntryCard(entry) {
  const card = document.createElement('div');
  card.className = 'history-entry';
  card.dataset.entryId = entry.id;
  card.setAttribute('role', 'listitem');

  const postUrl = `https://www.reddit.com${entry.permalink}`;

  card.innerHTML = `
    <div class="entry-header">
      <div class="entry-title">
        <a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer"
           title="${escapeHtml(entry.title || 'Untitled Post')}">
          ${escapeHtml(truncate(entry.title || 'Untitled Post', 90))}
        </a>
      </div>
    </div>
    <div class="entry-meta">
      <span class="sub-badge">${escapeHtml(entry.subreddit || 'unknown')}</span>
      <span class="entry-time">${timeAgo(entry.timestamp)}</span>
      ${entry.copiedCount > 1 ? `
        <span class="copied-count" title="Copied ${entry.copiedCount} times">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          ${entry.copiedCount}×
        </span>
      ` : ''}
    </div>
    <div class="entry-actions">
      <button class="btn btn-primary btn-sm copy-btn" data-action="copy" aria-label="Copy JSON again">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        Copy JSON
      </button>
      <button class="btn btn-ghost btn-sm view-btn" data-action="view" aria-label="View full JSON">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        View
      </button>
      <button class="btn btn-ghost btn-sm delete-btn" data-action="delete" aria-label="Delete entry" title="Delete">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  `;

  // Event delegation
  card.querySelector('.copy-btn').addEventListener('click', () => copyJson(entry));
  card.querySelector('.view-btn').addEventListener('click', () => showJsonModal(entry));
  card.querySelector('.delete-btn').addEventListener('click', () => {
    showConfirm(
      'Delete Entry',
      `Delete "${truncate(entry.title, 40)}" from history?`,
      'Delete',
      () => deleteEntry(entry.id)
    );
  });

  return card;
}

/**
 * Renders the history list, optionally filtered by a search query.
 * @param {string} [filter='']
 */
function renderHistory(filter = '') {
  el.historyList.innerHTML = '';

  let entries = historyData;
  if (filter) {
    const q = filter.toLowerCase();
    entries = historyData.filter(e =>
      e.title?.toLowerCase().includes(q) ||
      e.subreddit?.toLowerCase().includes(q) ||
      e.postId?.toLowerCase().includes(q)
    );
  }

  if (entries.length === 0) {
    el.emptyState.classList.remove('hidden');
    el.historyList.classList.add('hidden');

    const title = el.emptyState.querySelector('.empty__title');
    const desc = el.emptyState.querySelector('.empty__desc');

    if (filter && historyData.length > 0) {
      title.textContent = 'No Matches';
      desc.innerHTML = `Nothing matches "<strong>${escapeHtml(filter)}</strong>". Try a different term.`;
    } else {
      title.textContent = 'No JSON Copied Yet';
      desc.innerHTML = 'Browse Reddit and click the <strong>JSON</strong> button on any post to copy its data.';
    }
    return;
  }

  el.emptyState.classList.add('hidden');
  el.historyList.classList.remove('hidden');

  // Stagger animation
  entries.forEach((entry, i) => {
    const card = createEntryCard(entry);
    card.style.animationDelay = `${i * 30}ms`;
    el.historyList.appendChild(card);
  });
}

/**
 * Updates the stats bar counts.
 */
function updateStats() {
  const totalCopies = historyData.reduce((sum, e) => sum + (e.copiedCount || 1), 0);
  const totalEntries = historyData.length;

  el.statsCount.textContent = `${fmt(totalCopies)} post${totalCopies !== 1 ? 's' : ''} copied`;
  el.statsStorage.textContent = `${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'} stored`;
}

// ============================================================================
// SEARCH
// ============================================================================

/**
 * Handles search input with debounce.
 * @param {string} query
 */
function handleSearch(query) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    renderHistory(query.trim());
  }, 180);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEvents() {
  // Search
  el.searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  el.clearSearchBtn.addEventListener('click', () => {
    el.searchInput.value = '';
    handleSearch('');
    el.searchInput.focus();
  });

  // Actions
  el.exportBtn.addEventListener('click', exportHistory);
  el.clearAllBtn.addEventListener('click', clearAllHistory);

  // JSON Modal
  el.modalCloseBtn.addEventListener('click', hideJsonModal);
  el.modalCopyBtn.addEventListener('click', () => currentEntry && copyJson(currentEntry));
  el.jsonModal.querySelector('.modal__backdrop').addEventListener('click', hideJsonModal);

  // Confirm Modal
  el.confirmModal.querySelector('.modal__backdrop').addEventListener('click', () => {
    el.confirmModal.classList.add('hidden');
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideJsonModal();
      el.confirmModal.classList.add('hidden');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
    }
  });
}

// ============================================================================
// INIT
// ============================================================================

async function init() {
  console.log('[ReddJSON] Popup initializing…');

  setupEvents();

  // Show loading
  el.loadingState.classList.remove('hidden');
  el.historyList.classList.add('hidden');
  el.emptyState.classList.add('hidden');

  await loadHistory();

  // Hide loading
  el.loadingState.classList.add('hidden');

  renderHistory();
  updateStats();

  console.log('[ReddJSON] Popup ready ✓');
}

init();
