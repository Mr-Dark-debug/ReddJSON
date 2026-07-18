/**
 * ReddJSON Sidebar v2.1
 * ═══════════════════════════════════════════════════════════════════
 * 3-tab UI: History | AI Posts | Settings
 *
 * Communicates with background.js via chrome.runtime.sendMessage.
 * All data stored in chrome.storage.local only.
 *
 * v2.1 additions: dark mode, export/import, debounced search,
 * keyboard shortcuts, sidebar toasts, storage optimization.
 */

// ============================================================================
// DOM HELPERS
// ============================================================================

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(ts).toLocaleDateString();
}

function formatCtx(n) {
    if (!n) return '';
    if (n >= 1000000) return (n / 1000000).toFixed(0) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(0) + 'K';
    return n.toString();
}

function debounce(fn, wait) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

// Global state
let cachedModels = { openrouter: [], groq: [] };
let cachedHistory = [];
let cachedAIPosts = [];
let currentSettings = null;
let editingPromptId = null;

// ============================================================================
// SIDEBAR TOAST
// ============================================================================

function showSidebarToast(message, type = 'info') {
    const toast = $('#sidebar-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `sidebar-toast ${type} show`;
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}

// ============================================================================
// DARK MODE
// ============================================================================

function initTheme() {
    const saved = localStorage.getItem('reddjson_theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateThemeIcon();

    $('#theme-toggle')?.addEventListener('click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('reddjson_theme', 'light');
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('reddjson_theme', 'dark');
        }
        updateThemeIcon();
    });
}

function updateThemeIcon() {
    const icon = $('#theme-icon');
    if (!icon) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    icon.innerHTML = isDark
        ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
        : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
}

// ============================================================================
// TABS
// ============================================================================

function initTabs() {
    $$('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            $$('.tab-content').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            const panelId = 'panel-' + tab.dataset.tab;
            const panel = $(`#${panelId}`);
            if (panel) panel.classList.add('active');

            if (tab.dataset.tab === 'history') loadHistory();
            else if (tab.dataset.tab === 'ai-posts') loadAIPosts();
            else if (tab.dataset.tab === 'settings') loadSettings();
        });
    });
}

// ============================================================================
// HISTORY TAB
// ============================================================================

async function loadHistory() {
    const resp = await chrome.runtime.sendMessage({ action: 'getHistory' });
    if (!resp?.success) return;

    cachedHistory = resp.history || [];
    renderHistory();
}

function renderHistory() {
    const list = $('#history-list');
    const empty = $('#history-empty');
    const stats = $('#history-stats');

    if (cachedHistory.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        stats.textContent = '';
        return;
    }

    empty.style.display = 'none';
    const totalCopies = cachedHistory.reduce((s, e) => s + (e.copiedCount || 1), 0);
    stats.textContent = `${cachedHistory.length} posts · ${totalCopies} total copies`;

    const search = ($('#history-search')?.value || '').toLowerCase();
    const filtered = search
        ? cachedHistory.filter(e => (e.title + e.subreddit).toLowerCase().includes(search))
        : cachedHistory;

    list.innerHTML = filtered.map(e => `
    <div class="entry" data-id="${escapeHtml(e.id)}">
      <div class="entry-header">
        <div class="entry-title">${escapeHtml(e.title)}</div>
      </div>
      <div class="entry-meta">
        <span class="badge">r/${escapeHtml(e.subreddit)}</span>
        <span>${timeAgo(e.timestamp)}</span>
        <span>×${e.copiedCount || 1}</span>
      </div>
      <div class="entry-preview">${escapeHtml(e.jsonPreview || '')}</div>
      <div class="entry-actions" style="position: relative;">
        <button class="btn-ghost" data-action="recopy" data-id="${escapeHtml(e.id)}">📋 Re-copy</button>
        <button class="btn-ghost" data-action="view" data-id="${escapeHtml(e.id)}">👁 View</button>
        <button class="btn-ghost" data-action="generate-ai" data-id="${escapeHtml(e.id)}" style="color: var(--linkedin);">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle; margin-right: 2px;"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>Post
        </button>
        <button class="btn-ghost" data-action="delete" data-id="${escapeHtml(e.id)}">🗑</button>
      </div>
    </div>
  `).join('');
}

function initHistoryEvents() {
    $('#history-search')?.addEventListener('input', debounce(() => renderHistory(), 150));

    $('#history-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;

        if (action === 'recopy') {
            const resp = await chrome.runtime.sendMessage({ action: 'getHistoryEntry', entryId: id });
            if (resp?.success && resp.entry) {
                let json = resp.entry.fullJson;
                if (!json && resp.entry.permalink) {
                    showSidebarToast('Re-fetching from Reddit...', 'info');
                    const fetchResp = await chrome.runtime.sendMessage({ action: 'refetchJSON', permalink: resp.entry.permalink });
                    if (fetchResp?.success) json = fetchResp.data;
                    else { showSidebarToast(fetchResp?.error || 'Fetch failed', 'error'); return; }
                }
                if (json) {
                    await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
                    btn.textContent = '✓ Copied!';
                    showSidebarToast('JSON copied to clipboard', 'success');
                    setTimeout(() => { btn.textContent = '📋 Re-copy'; }, 1500);
                }
            }
        } else if (action === 'view') {
            const resp = await chrome.runtime.sendMessage({ action: 'getHistoryEntry', entryId: id });
            if (resp?.success && resp.entry) {
                let json = resp.entry.fullJson;
                if (!json && resp.entry.permalink) {
                    showSidebarToast('Re-fetching from Reddit...', 'info');
                    const fetchResp = await chrome.runtime.sendMessage({ action: 'refetchJSON', permalink: resp.entry.permalink });
                    if (fetchResp?.success) json = fetchResp.data;
                    else { showSidebarToast(fetchResp?.error || 'Fetch failed', 'error'); return; }
                }
                if (json) showJsonModal(resp.entry.title, json);
            }
        } else if (action === 'generate-ai') {
            const resp = await chrome.runtime.sendMessage({ action: 'getHistoryEntry', entryId: id });
            if (resp?.success && resp.entry) {
                showSidebarPromptMenu(e, btn, resp.entry);
            }
        } else if (action === 'delete') {
            showConfirm('Delete this entry?', async () => {
                await chrome.runtime.sendMessage({ action: 'deleteHistoryEntry', entryId: id });
                loadHistory();
            });
        }
    });

    $('#history-clear').addEventListener('click', () => {
        showConfirm('Clear ALL history?', async () => {
            await chrome.runtime.sendMessage({ action: 'clearHistory' });
            loadHistory();
        });
    });

    // Export history
    $('#history-export')?.addEventListener('click', () => {
        if (cachedHistory.length === 0) {
            showSidebarToast('No history to export', 'error');
            return;
        }
        exportAsJSON(cachedHistory, 'reddjson-history');
        showSidebarToast(`Exported ${cachedHistory.length} entries`, 'success');
    });

    // Import history
    $('#history-import')?.addEventListener('click', () => {
        triggerImport('history');
    });
}

// ============================================================================
// SIDEBAR AI GENERATION & TEMPLATE MENU
// ============================================================================

function showSidebarPromptMenu(e, btn, entry) {
    $$('.sidebar-dropdown-menu').forEach(m => m.remove());

    const prompts = currentSettings?.systemPrompts || [];
    if (prompts.length === 0) {
        showSidebarToast('No templates found in settings', 'error');
        return;
    }

    const menu = document.createElement('div');
    menu.className = 'sidebar-dropdown-menu';
    menu.style.cssText = `
        position: absolute;
        z-index: 1000;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow-md);
        padding: 4px 0;
        min-width: 180px;
        max-width: 240px;
    `;

    prompts.forEach(p => {
        const item = document.createElement('button');
        item.style.cssText = `
            display: block;
            width: 100%;
            padding: 8px 12px;
            border: none;
            background: none;
            text-align: left;
            font-family: var(--font);
            font-size: 11px;
            color: var(--text-primary);
            cursor: pointer;
            transition: background var(--transition);
            line-height: 1.3;
        `;
        const previewText = p.prompt ? p.prompt.substring(0, 35).replace(/\n/g, ' ') : '';
        item.innerHTML = `<strong>${escapeHtml(p.name)}</strong><br><span style="color:var(--text-muted);font-size:9px">${escapeHtml(previewText)}...</span>`;

        item.addEventListener('mouseenter', () => { item.style.background = 'var(--accent-light)'; });
        item.addEventListener('mouseleave', () => { item.style.background = 'none'; });

        item.addEventListener('click', async () => {
            menu.remove();
            await generateSidebarAIPost(btn, entry, p.id);
        });
        menu.appendChild(item);
    });

    const entryEl = btn.closest('.entry');
    if (entryEl) {
        entryEl.appendChild(menu);
        menu.style.bottom = `${btn.offsetHeight + 10}px`;
        menu.style.right = `12px`;
    }

    const closeDropdown = (ev) => {
        if (!menu.contains(ev.target) && ev.target !== btn) {
            menu.remove();
            document.removeEventListener('click', closeDropdown, true);
        }
    };
    setTimeout(() => document.addEventListener('click', closeDropdown, true), 0);
}

async function generateSidebarAIPost(btn, entry, promptId) {
    if (!currentSettings?.defaultProvider || !currentSettings?.defaultModel) {
        showSidebarToast('Set up AI provider in Settings first', 'error');
        return;
    }

    const origText = btn.innerHTML;
    btn.innerHTML = '⚡ Generating...';
    btn.disabled = true;
    btn.style.cursor = 'wait';

    showSidebarToast('Generating LinkedIn post...', 'info');

    try {
        const resp = await chrome.runtime.sendMessage({
            action: 'generateLinkedInPost',
            permalink: entry.permalink,
            title: entry.title,
            subreddit: entry.subreddit,
            postId: entry.postId,
            promptId: promptId,
            providerId: currentSettings.defaultProvider,
            modelId: currentSettings.defaultModel
        });

        if (!resp?.success) {
            showSidebarToast(resp?.error || 'Generation failed', 'error');
            return;
        }

        showSidebarToast('LinkedIn post ready!', 'success');

        // Auto switch tab to AI Posts
        const aiTab = $('[data-tab="ai-posts"]');
        if (aiTab) aiTab.click();
    } catch (err) {
        showSidebarToast(err.message || 'Generation failed', 'error');
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
        btn.style.cursor = 'pointer';
    }
}

// ============================================================================
// AI POSTS TAB
// ============================================================================

async function loadAIPosts() {
    const resp = await chrome.runtime.sendMessage({ action: 'getAIPosts' });
    if (!resp?.success) return;

    cachedAIPosts = resp.posts || [];
    renderAIPosts();
}

function renderAIPosts() {
    const list = $('#ai-posts-list');
    const empty = $('#ai-posts-empty');

    if (cachedAIPosts.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    const search = ($('#ai-search')?.value || '').toLowerCase();
    const filtered = search
        ? cachedAIPosts.filter(p => (p.redditTitle + p.generatedText).toLowerCase().includes(search))
        : cachedAIPosts;

    list.innerHTML = filtered.map(p => {
        const mediaHtml = (p.media || []).slice(0, 3).map(m =>
            m.url ? `<img src="${escapeHtml(m.url)}" alt="media" loading="lazy" onerror="this.style.display='none'">` : ''
        ).join('');

        return `
      <div class="entry" data-id="${escapeHtml(p.id)}">
        <div class="entry-header">
          <div class="entry-title">${escapeHtml(p.redditTitle)}</div>
        </div>
        <div class="entry-meta">
          <span class="badge">r/${escapeHtml(p.subreddit)}</span>
          <span>${timeAgo(p.timestamp)}</span>
          <span>${escapeHtml(p.model)}</span>
        </div>
        ${mediaHtml ? `<div class="ai-post-media">${mediaHtml}</div>` : ''}
        <div class="ai-post-text" data-action="toggle-expand">${escapeHtml(p.generatedText)}</div>
        <div class="entry-actions">
          <button class="btn-ghost" data-action="copy-text" data-id="${escapeHtml(p.id)}">📋 Copy Text</button>
          ${(p.media || []).length > 0 ? `<button class="btn-ghost" data-action="copy-media" data-id="${escapeHtml(p.id)}">🖼 Copy Image URL</button>` : ''}
          <button class="btn-linkedin" data-action="open-linkedin" data-id="${escapeHtml(p.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>
            Post to LinkedIn
          </button>
          <button class="btn-ghost" data-action="delete-ai" data-id="${escapeHtml(p.id)}">🗑</button>
        </div>
      </div>
    `;
    }).join('');
}

function initAIPostsEvents() {
    $('#ai-search')?.addEventListener('input', debounce(() => renderAIPosts(), 150));

    $('#ai-posts-list').addEventListener('click', async (e) => {
        const textEl = e.target.closest('.ai-post-text');
        if (textEl) { textEl.classList.toggle('expanded'); return; }

        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;

        const post = cachedAIPosts.find(p => p.id === id);
        if (!post && action !== 'delete-ai') return;

        if (action === 'copy-text') {
            await navigator.clipboard.writeText(post.generatedText);
            btn.textContent = '✓ Copied!';
            showSidebarToast('Post text copied', 'success');
            setTimeout(() => { btn.textContent = '📋 Copy Text'; }, 1500);
        } else if (action === 'copy-media') {
            const url = post.media?.[0]?.url;
            if (url) {
                await navigator.clipboard.writeText(url);
                btn.textContent = '✓ Copied!';
                showSidebarToast('Image URL copied', 'success');
                setTimeout(() => { btn.textContent = '🖼 Copy Image URL'; }, 1500);
            }
        } else if (action === 'open-linkedin') {
            const text = post.generatedText || '';
            const url = `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(text)}`;
            window.open(url, '_blank');
        } else if (action === 'delete-ai') {
            showConfirm('Delete this AI post?', async () => {
                await chrome.runtime.sendMessage({ action: 'deleteAIPost', postId: id });
                loadAIPosts();
            });
        }
    });

    $('#ai-clear').addEventListener('click', () => {
        showConfirm('Clear ALL AI posts?', async () => {
            await chrome.runtime.sendMessage({ action: 'clearAIPosts' });
            loadAIPosts();
        });
    });

    // Export AI posts
    $('#ai-export')?.addEventListener('click', () => {
        if (cachedAIPosts.length === 0) {
            showSidebarToast('No AI posts to export', 'error');
            return;
        }
        exportAsJSON(cachedAIPosts, 'reddjson-ai-posts');
        showSidebarToast(`Exported ${cachedAIPosts.length} posts`, 'success');
    });

    // Import AI posts
    $('#ai-import')?.addEventListener('click', () => {
        triggerImport('ai-posts');
    });
}

// ============================================================================
// EXPORT / IMPORT
// ============================================================================

function exportAsJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

let importTarget = null;

function triggerImport(target) {
    importTarget = target;
    const input = $('#import-file-input');
    input.value = '';
    input.click();
}

function initImport() {
    $('#import-file-input')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!Array.isArray(data)) {
                showSidebarToast('Invalid file: expected an array', 'error');
                return;
            }

            if (importTarget === 'history') {
                const resp = await chrome.runtime.sendMessage({ action: 'getHistory' });
                const existing = resp?.history || [];
                const existingIds = new Set(existing.map(e => e.postId));
                const newEntries = data.filter(e => e.postId && !existingIds.has(e.postId));
                const merged = [...newEntries, ...existing].slice(0, 50);
                await chrome.runtime.sendMessage({
                    action: 'saveSettings',
                    settings: currentSettings
                });
                await chrome.storage.local.set({ reddjson_history: merged });
                loadHistory();
                showSidebarToast(`Imported ${newEntries.length} new entries`, 'success');
            } else if (importTarget === 'ai-posts') {
                const resp = await chrome.runtime.sendMessage({ action: 'getAIPosts' });
                const existing = resp?.posts || [];
                const existingIds = new Set(existing.map(e => e.id));
                const newPosts = data.filter(e => e.id && !existingIds.has(e.id));
                const merged = [...newPosts, ...existing].slice(0, 50);
                await chrome.storage.local.set({ reddjson_ai_posts: merged });
                loadAIPosts();
                showSidebarToast(`Imported ${newPosts.length} new posts`, 'success');
            }
        } catch (err) {
            showSidebarToast('Import failed: invalid JSON', 'error');
        }
    });
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

async function loadSettings() {
    const resp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    if (!resp?.success) return;
    currentSettings = resp.settings;

    const orKey = currentSettings.providers?.openrouter?.apiKey || '';
    const groqKey = currentSettings.providers?.groq?.apiKey || '';
    $('#openrouter-key').value = orKey;
    $('#groq-key').value = groqKey;

    updateProviderStatus('openrouter', orKey);
    updateProviderStatus('groq', groqKey);

    $('#default-provider').value = currentSettings.defaultProvider || '';

    // Load persisted models from settings cache if they exist, otherwise fetch
    ['openrouter', 'groq'].forEach(pid => {
        const key = currentSettings.providers?.[pid]?.apiKey || '';
        const savedModels = currentSettings.providers?.[pid]?.models || [];
        if (key) {
            if (savedModels.length > 0) {
                cachedModels[pid] = savedModels;
                $(`#${pid}-models-area`).style.display = 'block';
                renderModels(pid);
            } else {
                loadModelsForProvider(pid, key);
            }
        }
    });

    updateDefaultModelDropdown();
    renderPrompts();
}

function updateProviderStatus(providerId, apiKey) {
    const el = $(`#${providerId}-status`);
    if (apiKey) {
        el.textContent = 'Configured ✓';
        el.classList.add('active');
    } else {
        el.textContent = 'Not configured';
        el.classList.remove('active');
    }
}

async function loadModelsForProvider(providerId, apiKey) {
    const area = $(`#${providerId}-models-area`);
    const list = $(`#${providerId}-models-list`);

    area.style.display = 'block';
    list.innerHTML = '<div class="loading-spinner"><div class="spinner-icon"></div>Loading models…</div>';

    const resp = await chrome.runtime.sendMessage({ action: 'fetchModels', providerId, apiKey });

    if (!resp?.success) {
        list.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:11px">${escapeHtml(resp?.error || 'Error')}</div>`;
        return;
    }

    const fetchedModels = resp.models || [];
    cachedModels[providerId] = fetchedModels;
    renderModels(providerId);

    // Persist fetched models list into settings storage
    if (currentSettings) {
        if (!currentSettings.providers) currentSettings.providers = {};
        if (!currentSettings.providers[providerId]) currentSettings.providers[providerId] = {};
        currentSettings.providers[providerId].models = fetchedModels;
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        updateDefaultModelDropdown();
    }
}

function renderModels(providerId) {
    const list = $(`#${providerId}-models-list`);
    const searchInput = $(`#${providerId}-model-search`);
    const freeFilter = $(`#${providerId}-free-filter`);

    let models = cachedModels[providerId] || [];
    const search = (searchInput?.value || '').toLowerCase();
    const freeOnly = freeFilter?.checked || false;

    if (search) models = models.filter(m => m.name.toLowerCase().includes(search) || m.id.toLowerCase().includes(search));
    if (freeOnly) models = models.filter(m => m.isFree);

    models.sort((a, b) => {
        if (a.isFree && !b.isFree) return -1;
        if (!a.isFree && b.isFree) return 1;
        return a.name.localeCompare(b.name);
    });

    if (models.length === 0) {
        list.innerHTML = '<div style="padding:10px;color:var(--text-muted);font-size:11px">No models found</div>';
        return;
    }

    const selectedModel = currentSettings?.providers?.[providerId]?.selectedModel;

    list.innerHTML = models.slice(0, 100).map(m => `
    <div class="model-item ${m.id === selectedModel ? 'selected' : ''}" data-model-id="${escapeHtml(m.id)}" data-provider="${providerId}">
      <span class="model-name" title="${escapeHtml(m.id)}">${escapeHtml(m.name)}</span>
      ${m.isFree ? '<span class="model-badge">FREE</span>' : ''}
      ${m.contextLength ? `<span class="model-ctx">${formatCtx(m.contextLength)} ctx</span>` : ''}
    </div>
  `).join('');
}

function initSettingsEvents() {
    ['openrouter', 'groq'].forEach(pid => {
        $(`#${pid}-save`).addEventListener('click', async () => {
            const key = $(`#${pid}-key`).value.trim();
            if (!key) return;

            if (!currentSettings) currentSettings = {};
            if (!currentSettings.providers) currentSettings.providers = {};
            if (!currentSettings.providers[pid]) currentSettings.providers[pid] = {};
            currentSettings.providers[pid].apiKey = key;

            await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
            updateProviderStatus(pid, key);
            loadModelsForProvider(pid, key);
            showSidebarToast('API key saved', 'success');
        });

        const searchEl = $(`#${pid}-model-search`);
        if (searchEl) searchEl.addEventListener('input', debounce(() => renderModels(pid), 150));

        const freeEl = $(`#${pid}-free-filter`);
        if (freeEl) freeEl.addEventListener('change', () => renderModels(pid));
    });

    document.addEventListener('click', async (e) => {
        const modelItem = e.target.closest('.model-item');
        if (!modelItem) return;

        const pid = modelItem.dataset.provider;
        const modelId = modelItem.dataset.modelId;

        if (!currentSettings.providers[pid]) currentSettings.providers[pid] = {};
        currentSettings.providers[pid].selectedModel = modelId;

        if (currentSettings.defaultProvider === pid) {
            currentSettings.defaultModel = modelId;
        }

        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        renderModels(pid);
        updateDefaultModelDropdown();
        showSidebarToast(`Model: ${modelId.split('/').pop()}`, 'success');
    });

    $('#default-provider').addEventListener('change', async (e) => {
        currentSettings.defaultProvider = e.target.value;
        const pid = e.target.value;
        if (pid && currentSettings.providers?.[pid]?.selectedModel) {
            currentSettings.defaultModel = currentSettings.providers[pid].selectedModel;
        } else {
            currentSettings.defaultModel = '';
        }
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        updateDefaultModelDropdown();
    });

    $('#default-model').addEventListener('change', async (e) => {
        currentSettings.defaultModel = e.target.value;
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
    });

    $('#save-defaults').addEventListener('click', async () => {
        currentSettings.defaultProvider = $('#default-provider').value;
        currentSettings.defaultModel = $('#default-model').value;
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        const btn = $('#save-defaults');
        btn.textContent = 'Saved ✓';
        showSidebarToast('Defaults saved', 'success');
        setTimeout(() => { btn.textContent = 'Save Defaults'; }, 1500);
    });

    $('#add-prompt').addEventListener('click', () => {
        editingPromptId = null;
        $('#prompt-modal-title').textContent = 'New System Prompt';
        $('#prompt-name-input').value = '';
        $('#prompt-text-input').value = '';
        $('#prompt-modal').style.display = 'flex';
    });

    $('#prompt-modal-save').addEventListener('click', async () => {
        const name = $('#prompt-name-input').value.trim();
        const prompt = $('#prompt-text-input').value.trim();
        if (!name || !prompt) return;

        if (!currentSettings.systemPrompts) currentSettings.systemPrompts = [];

        if (editingPromptId) {
            const idx = currentSettings.systemPrompts.findIndex(p => p.id === editingPromptId);
            if (idx !== -1) {
                currentSettings.systemPrompts[idx].name = name;
                currentSettings.systemPrompts[idx].prompt = prompt;
            }
        } else {
            currentSettings.systemPrompts.push({
                id: 'prompt_' + Date.now(),
                name,
                prompt,
                isDefault: false
            });
        }

        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        $('#prompt-modal').style.display = 'none';
        renderPrompts();
        showSidebarToast('Prompt saved', 'success');
    });

    $('#prompt-modal-cancel').addEventListener('click', () => { $('#prompt-modal').style.display = 'none'; });
    $('#prompt-modal-close').addEventListener('click', () => { $('#prompt-modal').style.display = 'none'; });
}

function updateDefaultModelDropdown() {
    const select = $('#default-model');
    const pid = currentSettings?.defaultProvider;

    if (!pid || !cachedModels[pid]?.length) {
        select.innerHTML = '<option value="">— Select provider first —</option>';
        return;
    }

    const models = cachedModels[pid];
    select.innerHTML = '<option value="">— Select model —</option>' +
        models.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === currentSettings.defaultModel ? 'selected' : ''}>${escapeHtml(m.name)}${m.isFree ? ' (FREE)' : ''}</option>`).join('');
}

function renderPrompts() {
    const list = $('#prompts-list');
    const prompts = currentSettings?.systemPrompts || [];

    list.innerHTML = prompts.map(p => `
    <div class="prompt-card ${p.id === currentSettings.activePromptId ? 'is-active' : ''}" data-prompt-id="${escapeHtml(p.id)}">
      <div class="prompt-info">
        <div class="prompt-label">${escapeHtml(p.name)} ${p.isDefault ? '(Built-in)' : ''}</div>
        <div class="prompt-preview">${escapeHtml(p.prompt.substring(0, 80))}…</div>
      </div>
      <div class="prompt-actions">
        <button class="btn-ghost" data-action="use-prompt" data-prompt-id="${escapeHtml(p.id)}" title="Use this prompt">${p.id === currentSettings.activePromptId ? '✓ Active' : 'Use'}</button>
        <button class="btn-ghost" data-action="edit-prompt" data-prompt-id="${escapeHtml(p.id)}" title="Edit">✏️</button>
        ${!p.isDefault ? `<button class="btn-ghost" data-action="delete-prompt" data-prompt-id="${escapeHtml(p.id)}" title="Delete">🗑</button>` : ''}
      </div>
    </div>
  `).join('');

    list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const { action, promptId } = btn.dataset;

            if (action === 'use-prompt') {
                currentSettings.activePromptId = promptId;
                await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
                renderPrompts();
                showSidebarToast('Prompt activated', 'success');
            } else if (action === 'edit-prompt') {
                const prompt = currentSettings.systemPrompts.find(p => p.id === promptId);
                if (!prompt) return;
                editingPromptId = promptId;
                $('#prompt-modal-title').textContent = 'Edit Prompt';
                $('#prompt-name-input').value = prompt.name;
                $('#prompt-text-input').value = prompt.prompt;
                $('#prompt-modal').style.display = 'flex';
            } else if (action === 'delete-prompt') {
                showConfirm('Delete this prompt?', async () => {
                    currentSettings.systemPrompts = currentSettings.systemPrompts.filter(p => p.id !== promptId);
                    if (currentSettings.activePromptId === promptId) {
                        currentSettings.activePromptId = currentSettings.systemPrompts[0]?.id || 'default';
                    }
                    await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
                    renderPrompts();
                });
            }
        });
    });
}

// ============================================================================
// MODALS
// ============================================================================

function showJsonModal(title, json) {
    $('#modal-title').textContent = title || 'JSON Viewer';
    $('#modal-json-content').textContent = JSON.stringify(json, null, 2);
    $('#json-modal').style.display = 'flex';
}

$('#modal-close')?.addEventListener('click', () => { $('#json-modal').style.display = 'none'; });
$('#modal-copy')?.addEventListener('click', async () => {
    const text = $('#modal-json-content').textContent;
    await navigator.clipboard.writeText(text);
    const btn = $('#modal-copy');
    btn.textContent = 'Copied ✓';
    showSidebarToast('JSON copied', 'success');
    setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
});

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        $$('.modal-overlay').forEach(m => { m.style.display = 'none'; });
    }
});

// Confirm dialog
let confirmCallback = null;

function showConfirm(message, onConfirm) {
    $('#confirm-message').textContent = message;
    $('#confirm-modal').style.display = 'flex';
    confirmCallback = onConfirm;
}

$('#confirm-cancel')?.addEventListener('click', () => { $('#confirm-modal').style.display = 'none'; confirmCallback = null; });
$('#confirm-ok')?.addEventListener('click', async () => {
    $('#confirm-modal').style.display = 'none';
    if (confirmCallback) { await confirmCallback(); confirmCallback = null; }
});

// ============================================================================
// STORAGE CHANGE LISTENER — live updates
// ============================================================================

chrome.storage.onChanged.addListener((changes) => {
    if (changes.reddjson_history) {
        const activeTab = $('.tab.active')?.dataset?.tab;
        if (activeTab === 'history') loadHistory();
    }
    if (changes.reddjson_ai_posts) {
        const activeTab = $('.tab.active')?.dataset?.tab;
        if (activeTab === 'ai-posts') loadAIPosts();
        if (changes.reddjson_ai_posts.newValue?.length > (changes.reddjson_ai_posts.oldValue?.length || 0)) {
            $$('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            $$('.tab-content').forEach(p => p.classList.remove('active'));
            const aiTab = $('[data-tab="ai-posts"]');
            if (aiTab) { aiTab.classList.add('active'); aiTab.setAttribute('aria-selected', 'true'); }
            $('#panel-ai-posts')?.classList.add('active');
            loadAIPosts();
        }
    }
});

// ============================================================================
// INIT
// ============================================================================

async function init() {
    initTheme();
    initTabs();
    initHistoryEvents();
    initAIPostsEvents();
    initSettingsEvents();
    initImport();
    await loadHistory();
    console.log('[ReddJSON] Sidebar v2.1 ready ✓');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
