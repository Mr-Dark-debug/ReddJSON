/**
 * ReddJSON Content Script v2.0
 * ═══════════════════════════════════════════════════════════════════
 * Injects "JSON" + "LI Post" buttons into Reddit action bars.
 * 
 * Duplicate prevention:
 *   1. data-reddjson-added attribute on post elements
 *   2. Global Set<string> of processed post IDs
 *   3. Debounced MutationObserver
 *
 * @version 2.0.0
 */

// ============================================================================
// ICON SVGs
// ============================================================================

const REDDJSON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="18" height="18">
  <g transform="translate(0, 5)">
    <path d="M 100 60 L 100 20 L 130 20" stroke="currentColor" stroke-width="5" fill="none" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="38" cy="75" r="14" fill="white" stroke="currentColor" stroke-width="5"/>
    <circle cx="162" cy="75" r="14" fill="white" stroke="currentColor" stroke-width="5"/>
    <ellipse cx="100" cy="145" rx="40" ry="35" fill="white" stroke="currentColor" stroke-width="5"/>
    <ellipse cx="100" cy="85" rx="55" ry="40" fill="white" stroke="currentColor" stroke-width="5"/>
    <circle cx="80" cy="85" r="9" fill="#FF4500"/>
    <circle cx="120" cy="85" r="9" fill="#FF4500"/>
    <path d="M 80 105 Q 100 120 120 105" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="130" cy="20" r="8" fill="white" stroke="currentColor" stroke-width="5"/>
    <rect x="70" y="125" width="60" height="65" rx="4" fill="#F6F6F6" stroke="currentColor" stroke-width="4"/>
    <path d="M 70 140 L 130 140" stroke="currentColor" stroke-width="2"/>
    <text x="100" y="137" font-family="sans-serif" font-size="8" font-weight="bold" fill="currentColor" text-anchor="middle">.JSON</text>
    <text x="100" y="175" font-family="monospace" font-size="32" font-weight="bold" fill="#FF4500" text-anchor="middle">{}</text>
    <ellipse cx="65" cy="150" rx="9" ry="18" fill="white" stroke="currentColor" stroke-width="5" transform="rotate(-40 65 150)"/>
    <ellipse cx="135" cy="150" rx="9" ry="18" fill="white" stroke="currentColor" stroke-width="5" transform="rotate(40 135 150)"/>
  </g>
</svg>`;

const LINKEDIN_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/>
  <rect x="2" y="9" width="4" height="12"/>
  <circle cx="4" cy="4" r="2"/>
</svg>`;

// ============================================================================
// SELECTORS
// ============================================================================

const SELECTORS = {
  shredditPost: 'shreddit-post',
  postContainer: '[data-testid="post-container"]',
  oldRedditThing: '.thing.link',
  shareButtonSelectors: [
    'shreddit-post-share-button',
    'button[aria-label="Share"]',
    'faceplate-tracker[source="share"]',
    'button[data-click-id="share"]',
  ],
  oldRedditToolbar: '.flat-list.buttons',
  permalinkAttr: 'permalink',
  dataPermalink: 'data-permalink',
  dataFullname: 'data-fullname',
  feedContainers: [
    'shreddit-feed',
    '[data-testid="main-content"]',
    '.sitetable.linklisting',
    '#siteTable',
    'main[role="main"]',
    '#main-content',
  ]
};

// ============================================================================
// CONFIG
// ============================================================================

const CONFIG = {
  toastDuration: 2500,
  observerDebounce: 200,
  redditOrange: '#FF4500',
  linkedinBlue: '#0A66C2',
  markerAttr: 'data-reddjson-added'
};

// ============================================================================
// STATE — Global Set prevents duplicates across re-renders
// ============================================================================

const processedPostIds = new Set();
let isProcessing = false;

// ============================================================================
// UTILITIES
// ============================================================================

function debounce(fn, wait) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getPostUniqueKey(postElement) {
  return postElement.getAttribute('id') ||
    postElement.getAttribute(SELECTORS.dataFullname) ||
    postElement.getAttribute(SELECTORS.permalinkAttr) ||
    postElement.getAttribute(SELECTORS.dataPermalink) ||
    null;
}

// ============================================================================
// TOAST
// ============================================================================

function showToast(message, type = 'info', nearElement = null) {
  document.querySelectorAll('.reddjson-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `reddjson-toast reddjson-toast--${type}`;
  toast.setAttribute('role', 'alert');

  const colors = {
    success: '#46D160', error: '#FF585B', info: '#FF4500', linkedin: '#0A66C2'
  };
  const bg = colors[type] || colors.info;

  const icons = {
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    linkedin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
  };

  toast.style.cssText = `
    position:fixed; z-index:2147483647; padding:10px 18px; border-radius:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:13px; font-weight:600; color:#fff; background:${bg};
    box-shadow:0 6px 20px rgba(0,0,0,.2); opacity:0; transform:translateY(-8px);
    transition:opacity .25s,transform .25s; pointer-events:none;
    max-width:360px; display:flex; align-items:center; gap:8px; white-space:nowrap;
  `;

  toast.innerHTML = `${icons[type] || ''}<span>${escapeHtml(message)}</span>`;

  if (nearElement) {
    const r = nearElement.getBoundingClientRect();
    toast.style.top = `${Math.max(8, r.top - 45)}px`;
    toast.style.left = `${r.left + r.width / 2}px`;
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
  } else {
    toast.style.top = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
  }

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = nearElement ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, CONFIG.toastDuration);
}

// ============================================================================
// BUTTON CREATION
// ============================================================================

function createActionButton(label, icon, accentColor) {
  const btn = document.createElement('button');
  btn.className = 'reddjson-action-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.title = label;

  btn.style.cssText = `
    display:inline-flex; align-items:center; gap:6px; padding:0 8px; height:32px;
    border:none; border-radius:20px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:12px; font-weight:700; cursor:pointer; background:transparent;
    color:var(--color-tone-2,#878A8C); transition:background .15s,color .15s,transform .1s;
    user-select:none; outline:none; vertical-align:middle; flex-shrink:0;
  `;

  btn.innerHTML = `${icon}<span>${escapeHtml(label)}</span>`;

  btn.addEventListener('mouseenter', () => {
    btn.style.background = `${accentColor}14`;
    btn.style.color = accentColor;
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = 'transparent';
    btn.style.color = 'var(--color-tone-2,#878A8C)';
  });
  btn.addEventListener('mousedown', () => { btn.style.transform = 'scale(0.94)'; });
  btn.addEventListener('mouseup', () => { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); btn.click(); }
  });

  return btn;
}

function createSpinner() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" style="animation:reddjson-spin .8s linear infinite">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
  </svg>`;
}

// ============================================================================
// POST DATA EXTRACTION
// ============================================================================

function extractNewRedditPostData(el) {
  try {
    let permalink = el.getAttribute(SELECTORS.permalinkAttr) || el.getAttribute(SELECTORS.dataPermalink);
    if (!permalink) {
      const link = el.querySelector('a[data-click-id="body"],a[href*="/comments/"]');
      if (link) permalink = link.getAttribute('href');
    }
    if (!permalink) {
      const fullLink = el.querySelector('a[slot="full-post-link"]');
      if (fullLink) permalink = fullLink.getAttribute('href');
    }
    if (!permalink) return null;

    let postId = el.getAttribute('id');
    if (!postId) {
      const fn = el.getAttribute(SELECTORS.dataFullname);
      postId = fn ? fn.replace('t3_', '') : null;
    }
    if (!postId && permalink) {
      const m = permalink.match(/comments\/([a-zA-Z0-9]+)/);
      if (m) postId = m[1];
    }

    let title = '';
    const titleEl = el.querySelector('h1,[slot="title"],a[data-click-id="body"] h3,a.title,[data-testid="post-title"]');
    if (titleEl) title = titleEl.textContent.trim();
    if (!title) title = el.getAttribute('post-title') || '';

    let subreddit = el.getAttribute('subreddit-prefixed-name')?.replace(/^r\//, '') || '';
    if (!subreddit) {
      const subEl = el.querySelector('[slot="subreddit-name"],a[href^="/r/"]');
      if (subEl) {
        const m = subEl.getAttribute('href')?.match(/\/r\/([^/]+)/);
        subreddit = m ? m[1] : subEl.textContent.trim().replace(/^r\//, '');
      }
    }

    return { permalink, postId: postId || 'unknown', title, subreddit };
  } catch (e) {
    console.error('[ReddJSON] Extract error:', e);
    return null;
  }
}

function extractOldRedditPostData(el) {
  try {
    let permalink = el.getAttribute('data-permalink') || el.getAttribute('data-url');
    if (!permalink) {
      const link = el.querySelector('a.comments,a.bylink,a[href*="/comments/"]');
      if (link) permalink = link.getAttribute('href');
    }
    if (!permalink) return null;

    let postId = el.getAttribute('data-fullname');
    if (postId) postId = postId.replace('t3_', '');
    else {
      const m = el.className.match(/id-t3[-_]([a-zA-Z0-9]+)/);
      if (m) postId = m[1];
    }

    let title = '';
    const titleEl = el.querySelector('a.title,.title a');
    if (titleEl) title = titleEl.textContent.trim();

    let subreddit = '';
    const subLink = el.querySelector('a.subreddit,a[href^="/r/"]');
    if (subLink) {
      const m = subLink.getAttribute('href')?.match(/\/r\/([^/]+)/);
      if (m) subreddit = m[1];
    }

    return { permalink, postId: postId || 'unknown', title, subreddit };
  } catch (e) {
    return null;
  }
}

// ============================================================================
// CLICK HANDLERS
// ============================================================================

async function handleJsonCopy(e, btn, postData) {
  e.preventDefault();
  e.stopPropagation();
  if (btn.disabled) return;

  const orig = btn.innerHTML;
  btn.innerHTML = createSpinner();
  btn.disabled = true;
  btn.style.cursor = 'wait';

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'fetchJSON', permalink: postData.permalink });
    if (!resp?.success) { showToast(resp?.error || 'Fetch failed', 'error', btn); return; }

    const pretty = JSON.stringify(resp.data, null, 2);
    await navigator.clipboard.writeText(pretty);
    showToast('JSON copied!', 'success', btn);

    chrome.runtime.sendMessage({
      action: 'addToHistory',
      entry: { permalink: postData.permalink, title: postData.title, subreddit: postData.subreddit, postId: postData.postId, jsonData: resp.data }
    }).catch(() => { });

  } catch (err) {
    if (err.name === 'NotAllowedError') showToast('Focus this tab and retry', 'error', btn);
    else showToast('Copy failed', 'error', btn);
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
    btn.style.cursor = 'pointer';
  }
}

async function handleGenerateLI(e, btn, postData) {
  e.preventDefault();
  e.stopPropagation();
  if (btn.disabled) return;

  const orig = btn.innerHTML;
  btn.innerHTML = createSpinner();
  btn.disabled = true;
  btn.style.cursor = 'wait';

  try {
    // First check if settings have a provider configured
    const settingsResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsResp?.settings;

    if (!settings?.defaultProvider || !settings?.defaultModel) {
      showToast('Set up an AI provider in Settings first', 'error', btn);
      // Try to open sidebar
      chrome.runtime.sendMessage({ action: 'openSidePanel' }).catch(() => { });
      return;
    }

    showToast('Generating LinkedIn post…', 'linkedin', btn);

    const resp = await chrome.runtime.sendMessage({
      action: 'generateLinkedInPost',
      permalink: postData.permalink,
      title: postData.title,
      subreddit: postData.subreddit,
      postId: postData.postId
    });

    if (!resp?.success) {
      showToast(resp?.error || 'Generation failed', 'error', btn);
      return;
    }

    showToast('LinkedIn post ready! Check sidebar →', 'success', btn);

    // Open side panel to show the result
    chrome.runtime.sendMessage({ action: 'openSidePanel' }).catch(() => { });

  } catch (err) {
    showToast('Error: ' + (err.message || 'Unknown'), 'error', btn);
  } finally {
    btn.innerHTML = orig;
    btn.disabled = false;
    btn.style.cursor = 'pointer';
  }
}

// ============================================================================
// FIND ACTION BAR
// ============================================================================

function findActionBar(postElement) {
  for (const sel of SELECTORS.shareButtonSelectors) {
    const shareBtn = postElement.querySelector(sel);
    if (shareBtn) return { container: shareBtn.parentElement, shareButton: shareBtn };
  }
  if (postElement.shadowRoot) {
    for (const sel of SELECTORS.shareButtonSelectors) {
      const shareBtn = postElement.shadowRoot.querySelector(sel);
      if (shareBtn) return { container: shareBtn.parentElement, shareButton: shareBtn };
    }
  }
  const allBtns = postElement.querySelectorAll('button');
  for (const b of allBtns) {
    if (b.textContent?.trim() === 'Share' || b.getAttribute('aria-label')?.includes('Share')) {
      return { container: b.parentElement, shareButton: b };
    }
  }
  return null;
}

// ============================================================================
// BUTTON INJECTION
// ============================================================================

function injectButtonsToNewRedditPost(postElement) {
  // Guard 1: data attribute
  if (postElement.hasAttribute(CONFIG.markerAttr)) return;

  // Guard 2: global Set
  const uniqueKey = getPostUniqueKey(postElement);
  if (uniqueKey && processedPostIds.has(uniqueKey)) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  const postData = extractNewRedditPostData(postElement);
  if (!postData?.permalink) return;

  const actionBar = findActionBar(postElement);
  if (!actionBar) {
    console.debug('[ReddJSON] Action bar not found, will retry');
    return;
  }

  // Double-check: if buttons already exist in this action bar, skip
  if (actionBar.container.querySelector('.reddjson-action-btn')) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    if (uniqueKey) processedPostIds.add(uniqueKey);
    return;
  }

  // Create JSON button
  const jsonBtn = createActionButton('JSON', REDDJSON_SVG, CONFIG.redditOrange);
  jsonBtn.addEventListener('click', (e) => handleJsonCopy(e, jsonBtn, postData));

  // Create LinkedIn Post button
  const liBtn = createActionButton('LI Post', LINKEDIN_ICON, CONFIG.linkedinBlue);
  liBtn.addEventListener('click', (e) => handleGenerateLI(e, liBtn, postData));

  // Wrap in a container to keep them together
  const wrapper = document.createElement('span');
  wrapper.className = 'reddjson-buttons-wrapper';
  wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:2px;';
  wrapper.appendChild(jsonBtn);
  wrapper.appendChild(liBtn);

  actionBar.shareButton.after(wrapper);

  // Mark as processed
  postElement.setAttribute(CONFIG.markerAttr, 'true');
  if (uniqueKey) processedPostIds.add(uniqueKey);
}

function injectButtonsToOldRedditPost(postElement) {
  if (postElement.hasAttribute(CONFIG.markerAttr)) return;

  const uniqueKey = getPostUniqueKey(postElement);
  if (uniqueKey && processedPostIds.has(uniqueKey)) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  const postData = extractOldRedditPostData(postElement);
  if (!postData?.permalink) return;

  const toolbar = postElement.querySelector(SELECTORS.oldRedditToolbar);
  if (!toolbar) return;

  if (toolbar.querySelector('.reddjson-action-btn')) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    if (uniqueKey) processedPostIds.add(uniqueKey);
    return;
  }

  const jsonBtn = createActionButton('JSON', REDDJSON_SVG, CONFIG.redditOrange);
  jsonBtn.style.cssText += 'border:1px solid #c6c6c6;padding:4px 8px;border-radius:3px;font-size:11px;height:auto;';
  jsonBtn.addEventListener('click', (e) => handleJsonCopy(e, jsonBtn, postData));

  const liBtn = createActionButton('LI Post', LINKEDIN_ICON, CONFIG.linkedinBlue);
  liBtn.style.cssText += 'border:1px solid #c6c6c6;padding:4px 8px;border-radius:3px;font-size:11px;height:auto;';
  liBtn.addEventListener('click', (e) => handleGenerateLI(e, liBtn, postData));

  const li = document.createElement('li');
  li.style.display = 'inline-block';
  li.appendChild(jsonBtn);
  li.appendChild(liBtn);
  toolbar.appendChild(li);

  postElement.setAttribute(CONFIG.markerAttr, 'true');
  if (uniqueKey) processedPostIds.add(uniqueKey);
}

// ============================================================================
// POST PROCESSING
// ============================================================================

function processAllPosts() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    const isOld = window.location.hostname.includes('old.reddit.com');
    if (isOld) {
      document.querySelectorAll(SELECTORS.oldRedditThing).forEach(p => {
        if (!p.hasAttribute(CONFIG.markerAttr)) injectButtonsToOldRedditPost(p);
      });
    } else {
      document.querySelectorAll(SELECTORS.shredditPost).forEach(p => {
        if (!p.hasAttribute(CONFIG.markerAttr)) injectButtonsToNewRedditPost(p);
      });
    }
  } catch (e) {
    console.error('[ReddJSON] Processing error:', e);
  } finally {
    isProcessing = false;
  }
}

// ============================================================================
// MUTATION OBSERVER
// ============================================================================

function startObserver() {
  const dProc = debounce(processAllPosts, CONFIG.observerDebounce);
  const observer = new MutationObserver((mutations) => {
    let shouldRun = false;
    for (const m of mutations) {
      if (m.type !== 'childList' || !m.addedNodes.length) continue;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const tag = n.tagName?.toLowerCase();
        if (tag === 'shreddit-post' || n.classList?.contains('thing') ||
          n.querySelector?.(SELECTORS.shredditPost) || n.querySelector?.(SELECTORS.oldRedditThing)) {
          shouldRun = true;
          break;
        }
      }
      if (shouldRun) break;
    }
    if (shouldRun) dProc();
  });

  let target = document.body;
  for (const sel of SELECTORS.feedContainers) {
    const c = document.querySelector(sel);
    if (c) { target = c; break; }
  }

  observer.observe(target, { childList: true, subtree: true });
}

// ============================================================================
// STYLES
// ============================================================================

function injectStyles() {
  if (document.getElementById('reddjson-styles-v2')) return;
  const style = document.createElement('style');
  style.id = 'reddjson-styles-v2';
  style.textContent = `
    @keyframes reddjson-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
    .reddjson-action-btn { outline:none !important; }
    .reddjson-action-btn:focus-visible { box-shadow:0 0 0 2px rgba(255,69,0,.5); }
    .reddjson-action-btn:active { transform:scale(.94) !important; }
  `;
  document.head.appendChild(style);
}

// ============================================================================
// INIT
// ============================================================================

function init() {
  console.log('[ReddJSON] Content v2.0 initializing…');
  injectStyles();
  processAllPosts();
  startObserver();
  setTimeout(processAllPosts, 1000);
  setTimeout(processAllPosts, 3000);
  console.log('[ReddJSON] Content v2.0 ready ✓');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else setTimeout(init, 150);

// SPA navigation detection
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    // Don't clear processedPostIds — prevents re-injection on back-navigation
    setTimeout(processAllPosts, 500);
  }
}).observe(document, { subtree: true, childList: true });
