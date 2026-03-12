/**
 * ReddJSON Content Script
 * ═══════════════════════════════════════════════════════════════════
 * Injects "JSON" copy buttons into Reddit post toolbars and handles
 * all user interactions on the page (click → fetch → copy → toast).
 *
 * Supports:
 *   • New Reddit (www.reddit.com)  — <shreddit-post> custom elements
 *   • Old Reddit (old.reddit.com)  — .thing.link elements
 *   • Single post pages           — both layouts
 *
 * Uses MutationObserver for infinite scroll / SPA navigation.
 *
 * @fileoverview Content script for injection + observation + messaging
 * @author ReddJSON Team
 * @version 1.0.0
 */

// ============================================================================
// SELECTORS — UPDATE IF REDDIT CHANGES UI
// ============================================================================
// These are the CSS selectors used to find Reddit posts and their toolbars.
// If Reddit redesigns their DOM structure, update ONLY these values.
// Everything else should work automatically.

/**
 * @typedef {Object} Selectors
 * @property {string} shredditPost       - New Reddit custom element
 * @property {string} postContainer      - Fallback container selector
 * @property {string} oldRedditThing     - Old Reddit post selector
 * @property {string} shareButton        - Share button selector (inject after this)
 * @property {string} oldRedditToolbar   - Old Reddit toolbar
 * @property {string} permalinkAttr      - Attribute name for permalink on <shreddit-post>
 * @property {string} dataPermalink      - Fallback permalink attribute
 * @property {string} dataFullname       - Reddit fullname attribute (t3_xxxxx)
 * @property {string[]} feedContainers   - Selectors for feed containers (MutationObserver targets)
 */
const SELECTORS = {
  // ── New Reddit (shreddit-post custom element) — PRIMARY ──
  shredditPost: 'shreddit-post',

  // ── New Reddit post container fallback ──
  postContainer: '[data-testid="post-container"]',

  // ── Old Reddit post container (class "thing" with link type) ──
  oldRedditThing: '.thing.link',

  // ── Toolbar / action bar selectors for button injection ──
  shareButton: [
    'button[aria-label="Share"]',
    'button[data-click-id="share"]',
    'faceplate-tracker[source="share"]',
    'shreddit-post-share-button',
  ].join(', '),

  // ── Old Reddit toolbar ──
  oldRedditToolbar: '.flat-list.buttons',

  // ── Post attributes ──
  permalinkAttr: 'permalink',
  dataPermalink: 'data-permalink',
  dataFullname: 'data-fullname',

  // ── Feed containers for MutationObserver ──
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
// CONFIGURATION
// ============================================================================

const CONFIG = {
  /** Button label text (change to "{}" or "Copy JSON" if preferred) */
  buttonLabel: 'JSON',

  /** Toast display duration in milliseconds */
  toastDuration: 2000,

  /** Debounce delay for MutationObserver in milliseconds */
  observerDebounce: 150,

  /** Reddit brand orange */
  redditOrange: '#FF4500',

  /** Success color */
  successGreen: '#46D160',

  /** Error color */
  errorRed: '#FF585B',

  /** Marker attribute to prevent duplicate button injection */
  markerAttribute: 'data-reddjson-added'
};

// ============================================================================
// STATE
// ============================================================================

/** Prevents re-entrant calls to processAllPosts */
let isProcessing = false;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Debounces a function — only the last call within `wait` ms actually fires.
 * @param {Function} func
 * @param {number} wait - Milliseconds
 * @returns {Function}
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Escapes HTML entities to prevent XSS in toast messages.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

/**
 * Shows a floating toast notification near the clicked button.
 * Auto-dismisses after CONFIG.toastDuration ms.
 *
 * @param {string} message - Message to display
 * @param {'success'|'error'|'info'} type - Toast type
 * @param {HTMLElement} [nearElement] - Position toast relative to this element
 */
function showToast(message, type = 'info', nearElement = null) {
  // Remove existing toasts
  document.querySelectorAll('.reddjson-toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `reddjson-toast reddjson-toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  const colors = {
    success: { bg: '#46D160', text: '#fff' },
    error: { bg: '#FF585B', text: '#fff' },
    info: { bg: '#FF4500', text: '#fff' },
  };
  const c = colors[type] || colors.info;

  // ── Icons ──
  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  };

  toast.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    padding: 10px 18px;
    border-radius: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 600;
    color: ${c.text};
    background: ${c.bg};
    box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
    max-width: 320px;
    text-align: center;
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  `;

  toast.innerHTML = `${icons[type] || ''}<span>${escapeHtml(message)}</span>`;

  // Position near the clicked button (or center top)
  if (nearElement) {
    const rect = nearElement.getBoundingClientRect();
    toast.style.top = `${Math.max(8, rect.top - 45)}px`;
    toast.style.left = `${rect.left + (rect.width / 2)}px`;
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
  } else {
    toast.style.top = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%) translateY(-8px)';
  }

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = nearElement
      ? 'translateX(-50%) translateY(0)'
      : 'translateX(-50%) translateY(0)';
  });

  // Animate out
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = nearElement
      ? 'translateX(-50%) translateY(-8px)'
      : 'translateX(-50%) translateY(-8px)';
    setTimeout(() => toast.remove(), 300);
  }, CONFIG.toastDuration);
}

// ============================================================================
// BUTTON CREATION
// ============================================================================

/**
 * Creates the styled JSON copy button element.
 * Matches Reddit's native button styling (pill shape, muted gray, hover orange).
 * @returns {HTMLButtonElement}
 */
function createJsonButton() {
  const button = document.createElement('button');
  button.className = 'reddjson-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'Copy post JSON to clipboard');
  button.title = 'Copy post JSON to clipboard';

  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    margin: 0 4px;
    border: none;
    border-radius: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 1;
    text-transform: uppercase;
    cursor: pointer;
    background: transparent;
    color: #878A8C;
    transition: background 0.15s, color 0.15s, transform 0.1s;
    user-select: none;
    -webkit-user-select: none;
    outline: none;
    vertical-align: middle;
  `;

  // ── JSON curly-braces icon ──
  const icon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/>
    <path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>
  </svg>`;

  button.innerHTML = `${icon}<span>${CONFIG.buttonLabel}</span>`;

  // ── Hover effects ──
  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255, 69, 0, 0.08)';
    button.style.color = CONFIG.redditOrange;
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
    button.style.color = '#878A8C';
  });
  button.addEventListener('mousedown', () => {
    button.style.transform = 'scale(0.94)';
  });
  button.addEventListener('mouseup', () => {
    button.style.transform = 'scale(1)';
  });

  // ── Keyboard support ──
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    }
  });

  return button;
}

/**
 * Returns SVG spinner HTML for the loading state.
 * @returns {string}
 */
function createSpinner() {
  return `<svg class="reddjson-spinner" width="14" height="14" viewBox="0 0 24 24" style="animation: reddjson-spin 0.8s linear infinite;">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
  </svg>`;
}

// ============================================================================
// POST DATA EXTRACTION
// ============================================================================

/**
 * Extracts post metadata from a <shreddit-post> element (New Reddit).
 * @param {HTMLElement} postElement
 * @returns {{permalink: string, postId: string, title: string, subreddit: string}|null}
 */
function extractNewRedditPostData(postElement) {
  try {
    // ── Permalink ──
    let permalink = postElement.getAttribute(SELECTORS.permalinkAttr)
      || postElement.getAttribute(SELECTORS.dataPermalink);

    if (!permalink) {
      const link = postElement.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
      if (link) permalink = link.getAttribute('href');
    }
    if (!permalink) {
      console.warn('[ReddJSON] Could not find permalink for post element');
      return null;
    }

    // ── Post ID ──
    let postId = postElement.getAttribute('id');
    if (!postId) {
      const fullname = postElement.getAttribute(SELECTORS.dataFullname);
      postId = fullname ? fullname.replace('t3_', '') : null;
    }
    if (!postId && permalink) {
      const match = permalink.match(/comments\/([a-zA-Z0-9]+)/);
      if (match) postId = match[1];
    }

    // ── Title ──
    let title = '';
    const titleEl = postElement.querySelector(
      'h1, [slot="title"], a[data-click-id="body"] h3, a.title, [data-testid="post-title"]'
    );
    if (titleEl) title = titleEl.textContent.trim();

    // ── Subreddit ──
    let subreddit = '';
    // Try subreddit-prefixed-name attribute first (most reliable on shreddit-post)
    subreddit = postElement.getAttribute('subreddit-prefixed-name')?.replace(/^r\//, '') || '';
    if (!subreddit) {
      const subEl = postElement.querySelector('[slot="subreddit-name"], a[href^="/r/"]');
      if (subEl) {
        const href = subEl.getAttribute('href');
        const match = href?.match(/\/r\/([^/]+)/);
        subreddit = match ? match[1] : subEl.textContent.trim().replace(/^r\//, '');
      }
    }

    return { permalink, postId: postId || 'unknown', title, subreddit };
  } catch (error) {
    console.error('[ReddJSON] Error extracting new Reddit post data:', error);
    return null;
  }
}

/**
 * Extracts post metadata from an Old Reddit .thing element.
 * @param {HTMLElement} postElement
 * @returns {{permalink: string, postId: string, title: string, subreddit: string}|null}
 */
function extractOldRedditPostData(postElement) {
  try {
    // ── Permalink ──
    let permalink = postElement.getAttribute('data-permalink')
      || postElement.getAttribute('data-url');

    if (!permalink) {
      const commentsLink = postElement.querySelector('a.comments, a.bylink, a[href*="/comments/"]');
      if (commentsLink) permalink = commentsLink.getAttribute('href');
    }
    if (!permalink) return null;

    // ── Post ID ──
    let postId = postElement.getAttribute('data-fullname');
    if (postId) {
      postId = postId.replace('t3_', '');
    } else {
      const classMatch = postElement.className.match(/id-t3[-_]([a-zA-Z0-9]+)/);
      if (classMatch) postId = classMatch[1];
    }

    // ── Title ──
    let title = '';
    const titleEl = postElement.querySelector('a.title, .title a');
    if (titleEl) title = titleEl.textContent.trim();

    // ── Subreddit ──
    let subreddit = '';
    const subLink = postElement.querySelector('a.subreddit, a[href^="/r/"]');
    if (subLink) {
      const match = subLink.getAttribute('href')?.match(/\/r\/([^/]+)/);
      if (match) subreddit = match[1];
    }

    return { permalink, postId: postId || 'unknown', title, subreddit };
  } catch (error) {
    console.error('[ReddJSON] Error extracting old Reddit post data:', error);
    return null;
  }
}

/**
 * Dispatches to the correct extraction function by Reddit version.
 * @param {HTMLElement} postElement
 * @param {'new'|'old'} type
 * @returns {{permalink: string, postId: string, title: string, subreddit: string}|null}
 */
function extractPostData(postElement, type = 'new') {
  return type === 'old'
    ? extractOldRedditPostData(postElement)
    : extractNewRedditPostData(postElement);
}

// ============================================================================
// JSON COPY HANDLER
// ============================================================================

/**
 * Handles the JSON button click:
 *   1. Shows loading spinner
 *   2. Sends "fetchJSON" to background
 *   3. Copies pretty-printed JSON to clipboard
 *   4. Shows success/error toast
 *   5. Stores entry in history
 *
 * @async
 * @param {Event} event
 * @param {HTMLButtonElement} button
 * @param {object} postData
 */
async function handleJsonCopy(event, button, postData) {
  event.preventDefault();
  event.stopPropagation();

  // Prevent double-click
  if (button.disabled) return;

  const originalContent = button.innerHTML;
  button.innerHTML = createSpinner();
  button.disabled = true;
  button.style.cursor = 'wait';

  try {
    // ── 1. Fetch JSON from Reddit via background service worker ──
    const response = await chrome.runtime.sendMessage({
      action: 'fetchJSON',
      permalink: postData.permalink
    });

    if (!response || !response.success) {
      showToast(response?.error || 'Failed to fetch JSON', 'error', button);
      return;
    }

    // ── 2. Pretty-print the entire response ──
    const prettyJson = JSON.stringify(response.data, null, 2);

    // ── 3. Copy to clipboard ──
    await navigator.clipboard.writeText(prettyJson);

    // ── 4. Show success toast ──
    showToast('JSON copied!', 'success', button);

    // ── 5. Add to history (fire-and-forget) ──
    chrome.runtime.sendMessage({
      action: 'addToHistory',
      entry: {
        permalink: postData.permalink,
        title: postData.title || 'Untitled Post',
        subreddit: postData.subreddit || 'unknown',
        postId: postData.postId || 'unknown',
        jsonData: response.data
      }
    }).catch(err => console.warn('[ReddJSON] History storage warning:', err));

  } catch (error) {
    console.error('[ReddJSON] Copy error:', error);

    // Clipboard can fail if page isn't focused
    if (error.name === 'NotAllowedError') {
      showToast('Focus this tab and try again', 'error', button);
    } else {
      showToast('Copy failed: ' + (error.message || 'Unknown error'), 'error', button);
    }
  } finally {
    // Always restore button state
    button.innerHTML = originalContent;
    button.disabled = false;
    button.style.cursor = 'pointer';
  }
}

// ============================================================================
// BUTTON INJECTION
// ============================================================================

/**
 * Injects a JSON button into a New Reddit <shreddit-post> element.
 * Finds the post's action bar and appends the button after existing actions.
 * @param {HTMLElement} postElement
 */
function injectButtonToNewRedditPost(postElement) {
  if (postElement.hasAttribute(CONFIG.markerAttribute)) return;

  const postData = extractPostData(postElement, 'new');
  if (!postData?.permalink) return;

  // ── Find the best injection point ──
  let injectionPoint = null;

  // Strategy 1: Look for the post action bar / actions slot
  const actionBarSelectors = [
    'shreddit-post-overflow-menu',
    '[slot="post-actions"]',
    'shreddit-post-action-bar',
    '.post-action-bar',
    '[data-testid="post-action-bar"]',
  ];
  for (const sel of actionBarSelectors) {
    injectionPoint = postElement.querySelector(sel);
    if (injectionPoint) {
      // If we found the overflow menu, inject into its parent instead
      if (sel === 'shreddit-post-overflow-menu') {
        injectionPoint = injectionPoint.parentElement;
      }
      break;
    }
  }

  // Strategy 2: Find share button and inject alongside it
  if (!injectionPoint) {
    const shareBtn = postElement.querySelector(SELECTORS.shareButton);
    if (shareBtn) injectionPoint = shareBtn.parentElement;
  }

  // Strategy 3: Fall back to any toolbar-like container
  if (!injectionPoint) {
    const meta = postElement.querySelector('[slot="post-meta"]');
    if (meta) injectionPoint = meta;
  }

  if (!injectionPoint) {
    // Last resort: just append to the post element itself
    // This ensures the button always appears even if Reddit restructures
    injectionPoint = postElement;
  }

  // ── Create and insert button ──
  const button = createJsonButton();
  button.addEventListener('click', (e) => handleJsonCopy(e, button, postData));

  // Insert after the last child button/tracker
  const siblings = injectionPoint.querySelectorAll(':scope > button, :scope > faceplate-tracker, :scope > shreddit-post-share-button');
  if (siblings.length > 0) {
    siblings[siblings.length - 1].after(button);
  } else {
    injectionPoint.appendChild(button);
  }

  postElement.setAttribute(CONFIG.markerAttribute, 'true');
}

/**
 * Injects a JSON button into an Old Reddit .thing element.
 * @param {HTMLElement} postElement
 */
function injectButtonToOldRedditPost(postElement) {
  if (postElement.hasAttribute(CONFIG.markerAttribute)) return;

  const postData = extractPostData(postElement, 'old');
  if (!postData?.permalink) return;

  const toolbar = postElement.querySelector(SELECTORS.oldRedditToolbar);
  if (!toolbar) return;

  const button = createJsonButton();

  // Adjust styling for old Reddit's flatter design
  button.style.cssText += `
    border: 1px solid #c6c6c6;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    margin: 0 2px;
  `;

  button.addEventListener('click', (e) => handleJsonCopy(e, button, postData));

  // Wrap in <li> for old Reddit's toolbar (it's a flat-list)
  const listItem = document.createElement('li');
  listItem.className = 'reddjson-old-reddit-item';
  listItem.style.display = 'inline-block';
  listItem.appendChild(button);

  toolbar.appendChild(listItem);
  postElement.setAttribute(CONFIG.markerAttribute, 'true');
}

/**
 * Scans the page for all posts and injects buttons where missing.
 * Safe to call repeatedly — skips already-processed posts.
 */
function processAllPosts() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const isOldReddit = window.location.hostname.includes('old.reddit.com');

    if (isOldReddit) {
      document.querySelectorAll(SELECTORS.oldRedditThing).forEach(post => {
        if (!post.hasAttribute(CONFIG.markerAttribute)) {
          injectButtonToOldRedditPost(post);
        }
      });
    } else {
      // Process <shreddit-post> custom elements
      document.querySelectorAll(SELECTORS.shredditPost).forEach(post => {
        if (!post.hasAttribute(CONFIG.markerAttribute)) {
          injectButtonToNewRedditPost(post);
        }
      });

      // Fallback: check [data-testid="post-container"] and find parent shreddit-post
      document.querySelectorAll(SELECTORS.postContainer).forEach(container => {
        const parentPost = container.closest(SELECTORS.shredditPost);
        if (parentPost && !parentPost.hasAttribute(CONFIG.markerAttribute)) {
          injectButtonToNewRedditPost(parentPost);
        }
      });
    }
  } catch (error) {
    console.error('[ReddJSON] Error processing posts:', error);
  } finally {
    isProcessing = false;
  }
}

// ============================================================================
// MUTATION OBSERVER
// ============================================================================

/**
 * Creates and starts a MutationObserver to watch for dynamically loaded posts.
 * Reddit uses infinite scroll, so new posts are added to the DOM constantly.
 */
function startObserver() {
  const debouncedProcess = debounce(processAllPosts, CONFIG.observerDebounce);

  const observer = new MutationObserver((mutations) => {
    let shouldProcess = false;

    for (const mutation of mutations) {
      if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName?.toLowerCase();
        const isPost =
          tag === 'shreddit-post' ||
          node.classList?.contains('thing') ||
          node.querySelector?.(SELECTORS.shredditPost) ||
          node.querySelector?.(SELECTORS.oldRedditThing);

        if (isPost) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) break;
    }

    if (shouldProcess) {
      debouncedProcess();
    }
  });

  // Find the narrowest possible container to observe
  let observeTarget = document.body;
  for (const selector of SELECTORS.feedContainers) {
    const container = document.querySelector(selector);
    if (container) {
      observeTarget = container;
      break;
    }
  }

  observer.observe(observeTarget, {
    childList: true,
    subtree: true
  });

  console.log('[ReddJSON] Observer started on:', observeTarget.tagName || 'BODY');
}

// ============================================================================
// STYLE INJECTION
// ============================================================================

/**
 * Injects CSS animations and overrides into the page <head>.
 * Uses a unique ID to prevent duplicate injection.
 */
function injectStyles() {
  const styleId = 'reddjson-injected-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* ═══ ReddJSON Extension Styles ═══ */

    @keyframes reddjson-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }

    @keyframes reddjson-fade-in {
      from { opacity: 0; transform: translateY(-8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .reddjson-button {
      outline: none !important;
    }

    .reddjson-button:focus-visible {
      box-shadow: 0 0 0 2px rgba(255, 69, 0, 0.5);
    }

    .reddjson-button:active {
      transform: scale(0.94) !important;
    }

    .reddjson-old-reddit-item {
      display: inline-block !important;
    }

    .reddjson-old-reddit-item::before {
      display: none !important;
    }

    .reddjson-spinner {
      animation: reddjson-spin 0.8s linear infinite;
    }
  `;

  document.head.appendChild(style);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Main initialization entry point.
 * Called once the DOM is ready.
 */
function init() {
  console.log('[ReddJSON] Content script initializing…');

  injectStyles();
  processAllPosts();
  startObserver();

  console.log('[ReddJSON] Content script initialized ✓');
}

// ── Start when DOM is ready ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  // Slight delay to let Reddit's custom elements register
  setTimeout(init, 150);
}

// ── Handle SPA-style navigation (URL changes without page reload) ──
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[ReddJSON] URL changed → reprocessing…');
    // Clear markers so buttons can be re-injected in new context
    document.querySelectorAll(`[${CONFIG.markerAttribute}]`).forEach(el => {
      el.removeAttribute(CONFIG.markerAttribute);
    });
    setTimeout(processAllPosts, 500);
  }
}).observe(document, { subtree: true, childList: true });
