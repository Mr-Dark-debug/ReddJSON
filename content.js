/**
 * ReddJSON Content Script v2.1
 * ═══════════════════════════════════════════════════════════════════
 * Injects "JSON" + "Post" buttons into Reddit action bars.
 *
 * Duplicate prevention:
 *   1. data-reddjson-added attribute on post elements
 *   2. Global Set<string> of processed post IDs (capped at 500)
 *   3. Debounced MutationObserver
 *
 * v2.1: JSON filter menu (post-only vs full), keyboard shortcut
 * message handling, processedPostIds cap.
 *
 * @version 2.1.0
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
    'button[aria-label*="share" i]',
    'faceplate-tracker[source="share"]',
    'faceplate-tracker[source="post_share"]',
    'faceplate-tracker[action="share"]',
    'faceplate-tracker[noun="share"]',
    'button[data-click-id="share"]',
    'shreddit-post-overflow-menu',
    'button[aria-label*="More options" i]',
    'a[slot="comment-button"]',
    'button[slot="comment-button"]',
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
  markerAttr: 'data-reddjson-added',
  maxProcessedIds: 500
};

// ============================================================================
// STATE — Global Set prevents duplicates across re-renders
// ============================================================================

const processedPostIds = new Set();
let isProcessing = false;

function trackPostId(id) {
  if (!id) return;
  if (processedPostIds.size >= CONFIG.maxProcessedIds) {
    const first = processedPostIds.values().next().value;
    processedPostIds.delete(first);
  }
  processedPostIds.add(id);
}

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

function hasReddJsonButtons(el, actionBar = null) {
  if (!el) return false;
  if (el.querySelector?.('.reddjson-buttons-wrapper, .reddjson-action-btn')) return true;
  if (el.shadowRoot?.querySelector?.('.reddjson-buttons-wrapper, .reddjson-action-btn')) return true;
  if (actionBar?.container?.querySelector?.('.reddjson-buttons-wrapper, .reddjson-action-btn')) return true;
  return false;
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

function createActionButton(label, icon, accentColor, options = {}) {
  const btn = document.createElement('button');
  btn.className = 'reddjson-action-btn';
  btn.type = 'button';
  const ariaLabel = options.ariaLabel || label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.title = options.title || label;
  if (options.hasPopup) {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.style.cssText = `
    display:inline-flex; align-items:center; gap:6px; padding:0 8px; height:32px;
    border:none; border-radius:20px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    font-size:12px; font-weight:700; cursor:pointer; background:transparent;
    color:var(--color-tone-2,#878A8C); transition:background .15s,color .15s,transform .1s;
    user-select:none; outline:none; vertical-align:middle; flex-shrink:0;
    position:relative; z-index:10;
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
    // Fallback on single post page
    if (!permalink && /\/comments\//.test(window.location.pathname)) {
      permalink = window.location.pathname;
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
    if (!postId && /\/comments\/([a-zA-Z0-9]+)/.test(window.location.pathname)) {
      const m = window.location.pathname.match(/\/comments\/([a-zA-Z0-9]+)/);
      if (m) postId = m[1];
    }

    let title = '';
    const titleEl = el.querySelector('h1,[slot="title"],a[data-click-id="body"] h3,a.title,[data-testid="post-title"]');
    if (titleEl) title = titleEl.textContent.trim();
    if (!title) title = el.getAttribute('post-title') || '';
    if (!title && /\/comments\//.test(window.location.pathname)) {
      const h1 = document.querySelector('h1,[slot="title"],[data-testid="post-title"]');
      if (h1) title = h1.textContent.trim();
      if (!title) title = document.title.replace(/ : .*$/, '').replace(/ - Reddit$/, '');
    }

    let subreddit = el.getAttribute('subreddit-prefixed-name')?.replace(/^r\//, '') || '';
    if (!subreddit) {
      const subEl = el.querySelector('[slot="subreddit-name"],a[href^="/r/"]');
      if (subEl) {
        const m = subEl.getAttribute('href')?.match(/\/r\/([^/]+)/);
        subreddit = m ? m[1] : subEl.textContent.trim().replace(/^r\//, '');
      }
    }
    if (!subreddit && /\/r\/([^/]+)/.test(window.location.pathname)) {
      const m = window.location.pathname.match(/\/r\/([^/]+)/);
      if (m) subreddit = m[1];
    }

    return { permalink, postId: postId || 'unknown', title: title || 'Untitled Post', subreddit: subreddit || 'unknown' };
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

async function handleJsonCopy(e, btn, postData, postOnly = false) {
  e.preventDefault();
  e.stopPropagation();
  if (btn.disabled) return;

  const orig = btn.innerHTML;
  btn.innerHTML = createSpinner();
  btn.disabled = true;
  btn.style.cursor = 'wait';

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'fetchJSON',
      permalink: postData.permalink,
      postOnly
    });
    if (!resp?.success) { showToast(resp?.error || 'Fetch failed', 'error', btn); return; }

    const pretty = JSON.stringify(resp.data, null, 2);
    await navigator.clipboard.writeText(pretty);
    const labelSpan = btn.querySelector('span');
    if (labelSpan) {
      const origLabel = labelSpan.textContent;
      labelSpan.textContent = '✓ Copied!';
      setTimeout(() => { if (labelSpan) labelSpan.textContent = origLabel; }, 1500);
    }
    showToast(postOnly ? 'Post JSON copied (no comments)!' : 'JSON copied!', 'success', btn);

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

async function handleGenerateLI(e, btn, postData, promptId = null) {
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
      postId: postData.postId,
      promptId: promptId
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
  if (!postElement) return null;

  // Strategy 1: find a Share or action button in light DOM of post
  for (const sel of SELECTORS.shareButtonSelectors) {
    const shareBtn = postElement.querySelector(sel);
    if (shareBtn) return { container: shareBtn.parentElement, shareButton: shareBtn, inShadow: false };
  }

  // Strategy 2: check shadowRoot
  if (postElement.shadowRoot) {
    for (const sel of SELECTORS.shareButtonSelectors) {
      const shareBtn = postElement.shadowRoot.querySelector(sel);
      if (shareBtn) return { container: shareBtn.parentElement, shareButton: shareBtn, inShadow: true };
    }
    // Check slots or toolbars inside shadowRoot
    const shadowToolbar = postElement.shadowRoot.querySelector(
      'slot[name="action-bar"], slot[name="share-button"], slot[name="credit-bar"], [role="toolbar"], .action-row'
    );
    if (shadowToolbar) {
      return { container: shadowToolbar.parentElement || postElement.shadowRoot, shareButton: shadowToolbar, inShadow: true };
    }
  }

  // Strategy 3: generic button text match in post
  const allBtns = postElement.querySelectorAll('button');
  for (const b of allBtns) {
    const text = b.textContent?.trim() || '';
    const label = b.getAttribute('aria-label') || '';
    if (text === 'Share' || label.toLowerCase().includes('share')) {
      return { container: b.parentElement, shareButton: b, inShadow: false };
    }
  }

  // Strategy 4: find action row or toolbar
  const actionRow = postElement.querySelector('[data-testid="action-row"], [slot="action-bar"], [slot="credit-bar"], rpl-action-bar');
  if (actionRow) {
    for (const sel of SELECTORS.shareButtonSelectors) {
      const shareBtn = actionRow.querySelector(sel);
      if (shareBtn) return { container: shareBtn.parentElement, shareButton: shareBtn, inShadow: false };
    }
    const lastChild = actionRow.lastElementChild;
    return { container: actionRow, shareButton: lastChild, inShadow: false };
  }

  // Strategy 5: on single post page, search document for post's action bar
  if (/\/comments\//.test(window.location.pathname)) {
    const pageShareBtn = document.querySelector('shreddit-post-share-button, shreddit-post-overflow-menu');
    if (pageShareBtn && !pageShareBtn.closest('shreddit-comment')) {
      return { container: pageShareBtn.parentElement, shareButton: pageShareBtn, inShadow: false };
    }
    const pageActionRow = document.querySelector('[data-testid="action-row"]');
    if (pageActionRow && !pageActionRow.querySelector('.reddjson-action-btn')) {
      const lastChild = pageActionRow.lastElementChild;
      return { container: pageActionRow, shareButton: lastChild, inShadow: false };
    }
    if (postElement.tagName?.toLowerCase() === 'shreddit-post') {
      return { container: postElement, shareButton: null, forceSlot: 'action-bar', inShadow: false };
    }
  }

  return null;
}

// ============================================================================
// BUTTON INJECTION
// ============================================================================

function injectButtonsToNewRedditPost(postElement) {
  if (!postElement) return;

  // Check if buttons are already in this post element
  if (hasReddJsonButtons(postElement)) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  const postData = extractNewRedditPostData(postElement);
  if (!postData?.permalink) return;

  const actionBar = findActionBar(postElement);
  if (!actionBar || !actionBar.container) {
    console.debug('[ReddJSON] Action bar not found, will retry');
    return;
  }

  // Double-check: if buttons already exist in this action bar container, skip
  if (actionBar.container.querySelector?.('.reddjson-action-btn') ||
      actionBar.container.querySelector?.('.reddjson-buttons-wrapper')) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  // Create JSON button with right-click menu for post-only option
  const jsonBtn = createActionButton('JSON', REDDJSON_SVG, CONFIG.redditOrange, {
    ariaLabel: 'Copy Reddit post JSON (Right-click for options)',
    title: 'Copy JSON (Right-click for options)',
    hasPopup: true
  });
  jsonBtn.addEventListener('click', (e) => handleJsonCopy(e, jsonBtn, postData, false));
  jsonBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    jsonBtn.setAttribute('aria-expanded', 'true');
    showJsonFilterMenu(e, jsonBtn, postData);
  });

  // Create LinkedIn Post button
  const liBtn = createActionButton('Post', LINKEDIN_ICON, CONFIG.linkedinBlue, {
    ariaLabel: 'Generate LinkedIn post (Right-click to select template)',
    title: 'Generate LinkedIn post (Right-click to select template)',
    hasPopup: true
  });
  liBtn.addEventListener('click', (e) => handleGenerateLI(e, liBtn, postData));
  liBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    liBtn.setAttribute('aria-expanded', 'true');
    showPromptTemplateMenu(e, liBtn, postData);
  });

  // Wrap in a container to keep them together
  const wrapper = document.createElement('span');
  wrapper.className = 'reddjson-buttons-wrapper';
  wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:2px;position:relative;z-index:10;vertical-align:middle;';
  wrapper.appendChild(jsonBtn);
  wrapper.appendChild(liBtn);

  // Web Component Slot Assignment:
  // If wrapper is placed inside a custom element with Shadow DOM (like shreddit-post),
  // it must have the appropriate slot attribute to be rendered.
  let slotName = actionBar.forceSlot || null;
  if (!slotName && actionBar.shareButton?.getAttribute) {
    slotName = actionBar.shareButton.getAttribute('slot');
  }
  if (!slotName && actionBar.container?.getAttribute) {
    slotName = actionBar.container.getAttribute('slot');
  }
  const isDirectChildOfPost = (actionBar.shareButton?.parentElement === postElement) ||
                              (actionBar.container === postElement);
  if (!slotName && isDirectChildOfPost) {
    const candidates = ['action-bar', 'share-button', 'credit-bar', 'post-overflow-menu'];
    for (const c of candidates) {
      if (postElement.querySelector(`[slot="${c}"]`)) { slotName = c; break; }
      if (postElement.shadowRoot?.querySelector(`slot[name="${c}"]`)) { slotName = c; break; }
    }
    if (!slotName) slotName = 'action-bar';
  }

  if (slotName && (isDirectChildOfPost || !actionBar.inShadow)) {
    wrapper.setAttribute('slot', slotName);
  }

  if (actionBar.shareButton && actionBar.shareButton.parentNode) {
    actionBar.shareButton.after(wrapper);
  } else if (actionBar.container) {
    actionBar.container.appendChild(wrapper);
  }

  // Mark as processed
  postElement.setAttribute(CONFIG.markerAttr, 'true');
  const uniqueKey = getPostUniqueKey(postElement);
  if (uniqueKey) trackPostId(uniqueKey);
}

function injectButtonsToOldRedditPost(postElement) {
  if (hasReddJsonButtons(postElement)) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  const postData = extractOldRedditPostData(postElement);
  if (!postData?.permalink) return;

  const toolbar = postElement.querySelector(SELECTORS.oldRedditToolbar);
  if (!toolbar) return;

  if (toolbar.querySelector('.reddjson-action-btn') || toolbar.querySelector('.reddjson-buttons-wrapper')) {
    postElement.setAttribute(CONFIG.markerAttr, 'true');
    return;
  }

  const jsonBtn = createActionButton('JSON', REDDJSON_SVG, CONFIG.redditOrange, {
    ariaLabel: 'Copy Reddit post JSON (Right-click for options)',
    title: 'Copy JSON (Right-click for options)',
    hasPopup: true
  });
  jsonBtn.style.cssText += 'border:1px solid #c6c6c6;padding:4px 8px;border-radius:3px;font-size:11px;height:auto;';
  jsonBtn.addEventListener('click', (e) => handleJsonCopy(e, jsonBtn, postData, false));
  jsonBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    jsonBtn.setAttribute('aria-expanded', 'true');
    showJsonFilterMenu(e, jsonBtn, postData);
  });

  const liBtn = createActionButton('Post', LINKEDIN_ICON, CONFIG.linkedinBlue, {
    ariaLabel: 'Generate LinkedIn post (Right-click to select template)',
    title: 'Generate LinkedIn post (Right-click to select template)',
    hasPopup: true
  });
  liBtn.style.cssText += 'border:1px solid #c6c6c6;padding:4px 8px;border-radius:3px;font-size:11px;height:auto;';
  liBtn.addEventListener('click', (e) => handleGenerateLI(e, liBtn, postData));
  liBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    liBtn.setAttribute('aria-expanded', 'true');
    showPromptTemplateMenu(e, liBtn, postData);
  });

  const li = document.createElement('li');
  li.className = 'reddjson-buttons-wrapper';
  li.style.display = 'inline-block';
  li.appendChild(jsonBtn);
  li.appendChild(liBtn);
  toolbar.appendChild(li);

  postElement.setAttribute(CONFIG.markerAttr, 'true');
  const uniqueKey = getPostUniqueKey(postElement);
  if (uniqueKey) trackPostId(uniqueKey);
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
        if (!hasReddJsonButtons(p)) injectButtonsToOldRedditPost(p);
      });
    } else {
      // Feed posts
      document.querySelectorAll(SELECTORS.shredditPost).forEach(p => {
        if (!hasReddJsonButtons(p)) injectButtonsToNewRedditPost(p);
      });

      // Single post page handling
      const isSinglePostPage = /\/comments\//.test(window.location.pathname);
      if (isSinglePostPage) {
        const singlePost = document.querySelector('shreddit-post');
        if (singlePost) {
          if (!hasReddJsonButtons(singlePost)) {
            injectButtonsToNewRedditPost(singlePost);
          }
        } else {
          // Fallback if shreddit-post is not rendered (quarantined interstitial, custom shell, etc.)
          const containers = document.querySelectorAll(
            '[data-testid="post-container"], article, [data-testid="action-row"], [slot="action-bar"], rpl-action-bar'
          );
          containers.forEach(container => {
            if (container.closest('shreddit-comment')) return; // ignore comments
            if (!hasReddJsonButtons(container)) {
              injectButtonsToActionRow(container);
            }
          });
        }
      }
    }
  } catch (e) {
    console.error('[ReddJSON] Processing error:', e);
  } finally {
    isProcessing = false;
  }
}

/**
 * Direct injection into an action-row on single post pages
 * when no parent shreddit-post element is found
 */
function injectButtonsToActionRow(actionRow) {
  if (!actionRow || hasReddJsonButtons(actionRow)) return;

  const urlMatch = window.location.pathname.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
  const permalink = window.location.pathname;
  const subreddit = urlMatch ? urlMatch[1] : (window.location.pathname.match(/\/r\/([^/]+)/)?.[1] || 'unknown');
  const postId = urlMatch ? urlMatch[2] : (window.location.pathname.match(/comments\/([a-zA-Z0-9]+)/)?.[1] || 'unknown');

  let title = '';
  const titleEl = document.querySelector('h1,[slot="title"],[data-testid="post-title"]');
  if (titleEl) title = titleEl.textContent.trim();
  if (!title) title = document.title.replace(/ : .*$/, '').replace(/ - Reddit$/, '');

  const postData = { permalink, postId, title, subreddit };

  const jsonBtn = createActionButton('JSON', REDDJSON_SVG, CONFIG.redditOrange, {
    ariaLabel: 'Copy Reddit post JSON (Right-click for options)',
    title: 'Copy JSON (Right-click for options)',
    hasPopup: true
  });
  jsonBtn.addEventListener('click', (e) => handleJsonCopy(e, jsonBtn, postData, false));
  jsonBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    jsonBtn.setAttribute('aria-expanded', 'true');
    showJsonFilterMenu(e, jsonBtn, postData);
  });

  const liBtn = createActionButton('Post', LINKEDIN_ICON, CONFIG.linkedinBlue, {
    ariaLabel: 'Generate LinkedIn post (Right-click to select template)',
    title: 'Generate LinkedIn post (Right-click to select template)',
    hasPopup: true
  });
  liBtn.addEventListener('click', (e) => handleGenerateLI(e, liBtn, postData));
  liBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    liBtn.setAttribute('aria-expanded', 'true');
    showPromptTemplateMenu(e, liBtn, postData);
  });

  const wrapper = document.createElement('span');
  wrapper.className = 'reddjson-buttons-wrapper';
  wrapper.style.cssText = 'display:inline-flex;align-items:center;gap:2px;position:relative;z-index:10;vertical-align:middle;';
  wrapper.appendChild(jsonBtn);
  wrapper.appendChild(liBtn);

  let inserted = false;
  for (const sel of SELECTORS.shareButtonSelectors) {
    const shareBtn = actionRow.querySelector(sel);
    if (shareBtn) {
      if (shareBtn.getAttribute('slot')) wrapper.setAttribute('slot', shareBtn.getAttribute('slot'));
      shareBtn.after(wrapper);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    const arBtns = actionRow.querySelectorAll('button');
    for (const b of arBtns) {
      if (b.textContent?.trim() === 'Share' || b.getAttribute('aria-label')?.toLowerCase().includes('share')) {
        b.after(wrapper);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) {
    actionRow.appendChild(wrapper);
  }
}

// ============================================================================
// JSON FILTER CONTEXT MENU
// ============================================================================

function showJsonFilterMenu(e, btn, postData) {
  document.querySelectorAll('.reddjson-filter-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'reddjson-filter-menu';
  menu.style.cssText = `
    position:fixed; z-index:2147483647; background:#fff; border:1px solid #e0e0e0;
    border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.15); padding:4px 0;
    min-width:180px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  `;

  const options = [
    { label: 'Full Thread JSON', desc: 'Post + all comments', postOnly: false },
    { label: 'Post Only JSON', desc: 'No comments (smaller)', postOnly: true },
  ];

  options.forEach(opt => {
    const item = document.createElement('button');
    item.type = 'button';
    item.style.cssText = `
      display:block; width:100%; padding:8px 14px; border:none; background:none;
      text-align:left; cursor:pointer; font-size:12px; color:#1a1a1b;
      font-family:inherit; transition:background .15s;
    `;
    item.innerHTML = `<strong>${opt.label}</strong><br><span style="font-size:10px;color:#878a8c">${opt.desc}</span>`;
    item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,69,0,.06)'; });
    item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
    item.addEventListener('click', (ev) => {
      menu.remove();
      handleJsonCopy(ev, btn, postData, opt.postOnly);
    });
    menu.appendChild(item);
  });

  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${e.clientX}px`;
  document.body.appendChild(menu);

  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu, true);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
}

// ============================================================================
// PROMPT TEMPLATES CONTEXT MENU
// ============================================================================

async function showPromptTemplateMenu(e, btn, postData) {
  document.querySelectorAll('.reddjson-filter-menu').forEach(m => m.remove());

  try {
    const settingsResp = await chrome.runtime.sendMessage({ action: 'getSettings' });
    const settings = settingsResp?.settings;
    const prompts = settings?.systemPrompts || [];

    if (prompts.length === 0) {
      showToast('No templates found', 'error', btn);
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'reddjson-filter-menu';
    menu.style.cssText = `
      position:fixed; z-index:2147483647; background:#fff; border:1px solid #e0e0e0;
      border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,.15); padding:4px 0;
      min-width:220px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    `;

    const activePromptId = settings.activePromptId || 'default';

    prompts.forEach(p => {
      const item = document.createElement('button');
      item.type = 'button';
      item.style.cssText = `
        display:block; width:100%; padding:8px 14px; border:none; background:none;
        text-align:left; cursor:pointer; font-size:12px; color:#1a1a1b;
        font-family:inherit; transition:background .15s; line-height:1.4;
      `;
      const isActive = p.id === activePromptId;
      const previewText = p.prompt ? p.prompt.substring(0, 45).replace(/\n/g, ' ') : '';
      item.innerHTML = `<strong>${isActive ? '★ ' : ''}${escapeHtml(p.name)}</strong><br><span style="font-size:10px;color:#878a8c">${escapeHtml(previewText)}...</span>`;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(10,102,194,.06)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
      item.addEventListener('click', (ev) => {
        menu.remove();
        handleGenerateLI(ev, btn, postData, p.id);
      });
      menu.appendChild(item);
    });

    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;
    document.body.appendChild(menu);

    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu, true), 0);
  } catch (err) {
    showToast('Failed to load templates', 'error', btn);
  }
}

// ============================================================================
// MESSAGE LISTENER — keyboard shortcut support
// ============================================================================

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'showToast') {
    showToast(message.message, message.type || 'info');
  } else if (message.action === 'copyToClipboard') {
    navigator.clipboard.writeText(message.text).then(() => {
      showToast('JSON copied!', 'success');
    }).catch(() => {
      showToast('Copy failed — focus this tab', 'error');
    });
  }
});

// ============================================================================
// MUTATION OBSERVER
// ============================================================================

function schedulePostProcessing(delays = [50, 300, 800, 1500, 2500]) {
  delays.forEach(ms => setTimeout(processAllPosts, ms));
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
        if (
          tag === 'shreddit-post' ||
          tag === 'shreddit-post-share-button' ||
          tag === 'shreddit-post-overflow-menu' ||
          tag === 'shreddit-async-loader' ||
          tag === 'rpl-action-bar' ||
          n.classList?.contains('thing') ||
          n.hasAttribute?.('slot') ||
          n.querySelector?.(SELECTORS.shredditPost) ||
          n.querySelector?.('shreddit-post-share-button') ||
          n.querySelector?.('[slot*="action"]') ||
          n.querySelector?.('[slot*="share"]') ||
          n.querySelector?.('[data-testid="action-row"]') ||
          (n.closest && n.closest('shreddit-post'))
        ) {
          shouldRun = true;
          break;
        }
      }
      if (shouldRun) break;
    }
    if (shouldRun) dProc();
  });

  // Always observe document.body so modals, overlays, and SPA view changes are caught
  observer.observe(document.body, { childList: true, subtree: true });
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
// INTERSTITIAL & SPA NAVIGATION (Bolt ⚡ performance optimization)
// ============================================================================

// Interstitial / Quarantined opt-in click listener
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target) return;
  const btn = target.closest('button, [role="button"], faceplate-tracker');
  if (btn) {
    const text = (btn.textContent || '').toLowerCase();
    if (
      text.includes('continue') ||
      text.includes('view') ||
      text.includes('agree') ||
      text.includes('understand') ||
      text.includes('yes')
    ) {
      schedulePostProcessing([200, 600, 1200, 2500]);
    }
  }
}, true);

// Lightweight SPA navigation detection:
// Replaces expensive full-document MutationObserver with History API hooks + popstate
let lastUrl = location.href;

function onUrlChange() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    schedulePostProcessing([50, 250, 600, 1200, 2500]);
  }
}

// Hook History API
const origPushState = history.pushState;
history.pushState = function(...args) {
  const ret = origPushState.apply(this, args);
  onUrlChange();
  return ret;
};

const origReplaceState = history.replaceState;
history.replaceState = function(...args) {
  const ret = origReplaceState.apply(this, args);
  onUrlChange();
  return ret;
};

window.addEventListener('popstate', onUrlChange);

// Lightweight fallback polling (350ms) for edge cases
setInterval(onUrlChange, 350);

// ============================================================================
// INIT
// ============================================================================

function init() {
  console.log('[ReddJSON] Content v2.1 initializing…');
  injectStyles();
  processAllPosts();
  startObserver();
  schedulePostProcessing([100, 500, 1200, 2500]);
  console.log('[ReddJSON] Content v2.1 ready ✓');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else setTimeout(init, 150);
