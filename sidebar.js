/**
 * ReddJSON Sidebar v2.0
 * ═══════════════════════════════════════════════════════════════════
 * 3-tab UI: History | AI Posts | Settings
 *
 * Communicates with background.js via chrome.runtime.sendMessage.
 * All data stored in chrome.storage.local only.
 *
 * @version 2.0.0
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

// Global state
let cachedModels = { openrouter: [], groq: [] };
let currentSettings = null;
let editingPromptId = null;

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

            // Refresh data when tab becomes visible
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

    const history = resp.history || [];
    const list = $('#history-list');
    const empty = $('#history-empty');
    const stats = $('#history-stats');

    if (history.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        stats.textContent = '';
        return;
    }

    empty.style.display = 'none';
    const totalCopies = history.reduce((s, e) => s + (e.copiedCount || 1), 0);
    stats.textContent = `${history.length} posts · ${totalCopies} total copies`;

    const search = ($('#history-search')?.value || '').toLowerCase();
    const filtered = search
        ? history.filter(e => (e.title + e.subreddit).toLowerCase().includes(search))
        : history;

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
      <div class="entry-actions">
        <button class="btn-ghost" data-action="recopy" data-id="${escapeHtml(e.id)}">📋 Re-copy</button>
        <button class="btn-ghost" data-action="view" data-id="${escapeHtml(e.id)}">👁 View</button>
        <button class="btn-ghost" data-action="delete" data-id="${escapeHtml(e.id)}">🗑</button>
      </div>
    </div>
  `).join('');
}

function initHistoryEvents() {
    $('#history-search')?.addEventListener('input', loadHistory);

    $('#history-list').addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;

        if (action === 'recopy') {
            const resp = await chrome.runtime.sendMessage({ action: 'getHistoryEntry', entryId: id });
            if (resp?.success && resp.entry?.fullJson) {
                await navigator.clipboard.writeText(JSON.stringify(resp.entry.fullJson, null, 2));
                btn.textContent = '✓ Copied!';
                setTimeout(() => { btn.textContent = '📋 Re-copy'; }, 1500);
            }
        } else if (action === 'view') {
            const resp = await chrome.runtime.sendMessage({ action: 'getHistoryEntry', entryId: id });
            if (resp?.success && resp.entry) {
                showJsonModal(resp.entry.title, resp.entry.fullJson);
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
}

// ============================================================================
// AI POSTS TAB
// ============================================================================

async function loadAIPosts() {
    const resp = await chrome.runtime.sendMessage({ action: 'getAIPosts' });
    if (!resp?.success) return;

    const posts = resp.posts || [];
    const list = $('#ai-posts-list');
    const empty = $('#ai-posts-empty');

    if (posts.length === 0) {
        list.innerHTML = '';
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    const search = ($('#ai-search')?.value || '').toLowerCase();
    const filtered = search
        ? posts.filter(p => (p.redditTitle + p.generatedText).toLowerCase().includes(search))
        : posts;

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
    $('#ai-search')?.addEventListener('input', loadAIPosts);

    $('#ai-posts-list').addEventListener('click', async (e) => {
        // Toggle expand
        const textEl = e.target.closest('.ai-post-text');
        if (textEl) { textEl.classList.toggle('expanded'); return; }

        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;

        const resp = await chrome.runtime.sendMessage({ action: 'getAIPosts' });
        const post = resp?.posts?.find(p => p.id === id);
        if (!post && action !== 'delete-ai') return;

        if (action === 'copy-text') {
            await navigator.clipboard.writeText(post.generatedText);
            btn.textContent = '✓ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy Text'; }, 1500);
        } else if (action === 'copy-media') {
            const url = post.media?.[0]?.url;
            if (url) {
                await navigator.clipboard.writeText(url);
                btn.textContent = '✓ Copied!';
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
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

async function loadSettings() {
    const resp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    if (!resp?.success) return;
    currentSettings = resp.settings;

    // Restore API keys
    const orKey = currentSettings.providers?.openrouter?.apiKey || '';
    const groqKey = currentSettings.providers?.groq?.apiKey || '';
    $('#openrouter-key').value = orKey;
    $('#groq-key').value = groqKey;

    // Update status badges
    updateProviderStatus('openrouter', orKey);
    updateProviderStatus('groq', groqKey);

    // Restore defaults
    $('#default-provider').value = currentSettings.defaultProvider || '';
    updateDefaultModelDropdown();

    // Load cached models if keys exist
    if (orKey) loadModelsForProvider('openrouter', orKey);
    if (groqKey) loadModelsForProvider('groq', groqKey);

    // Render prompts
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

    cachedModels[providerId] = resp.models || [];
    renderModels(providerId);
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

    // Sort: free first, then alphabetical
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
    // Save provider keys
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
        });

        // Model search
        const searchEl = $(`#${pid}-model-search`);
        if (searchEl) searchEl.addEventListener('input', () => renderModels(pid));

        // Free filter
        const freeEl = $(`#${pid}-free-filter`);
        if (freeEl) freeEl.addEventListener('change', () => renderModels(pid));
    });

    // Model selection click
    document.addEventListener('click', async (e) => {
        const modelItem = e.target.closest('.model-item');
        if (!modelItem) return;

        const pid = modelItem.dataset.provider;
        const modelId = modelItem.dataset.modelId;

        // Update selected model for this provider
        if (!currentSettings.providers[pid]) currentSettings.providers[pid] = {};
        currentSettings.providers[pid].selectedModel = modelId;

        // If this provider is the default, also update global default model
        if (currentSettings.defaultProvider === pid) {
            currentSettings.defaultModel = modelId;
        }

        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        renderModels(pid);
        updateDefaultModelDropdown();
    });

    // Default provider change
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

    // Default model change
    $('#default-model').addEventListener('change', async (e) => {
        currentSettings.defaultModel = e.target.value;
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
    });

    // Save defaults button
    $('#save-defaults').addEventListener('click', async () => {
        currentSettings.defaultProvider = $('#default-provider').value;
        currentSettings.defaultModel = $('#default-model').value;
        await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
        const btn = $('#save-defaults');
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Save Defaults'; }, 1500);
    });

    // Add new prompt
    $('#add-prompt').addEventListener('click', () => {
        editingPromptId = null;
        $('#prompt-modal-title').textContent = 'New System Prompt';
        $('#prompt-name-input').value = '';
        $('#prompt-text-input').value = '';
        $('#prompt-modal').style.display = 'flex';
    });

    // Prompt modal save
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
    });

    // Prompt modal cancel/close
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

    // Prompt actions
    list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const { action, promptId } = btn.dataset;

            if (action === 'use-prompt') {
                currentSettings.activePromptId = promptId;
                await chrome.runtime.sendMessage({ action: 'saveSettings', settings: currentSettings });
                renderPrompts();
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
    setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
});

// Close modals on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
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
        // Auto-switch to AI Posts tab when a new post arrives
        if (changes.reddjson_ai_posts.newValue?.length > (changes.reddjson_ai_posts.oldValue?.length || 0)) {
            // New AI post was added — switch to AI Posts tab
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
    initTabs();
    initHistoryEvents();
    initAIPostsEvents();
    initSettingsEvents();
    await loadHistory();
    console.log('[ReddJSON] Sidebar v2.0 ready ✓');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
