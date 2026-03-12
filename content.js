/**
 * ReddJSON Content Script
 * ═══════════════════════════════════════════════════════════════════
 * Injects "JSON" copy buttons into Reddit post ACTION BARS and handles
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
 * @version 1.1.0
 */

// ============================================================================
// ICON SVG (reddjosn.svg inline — the official ReddJSON mascot)
// ============================================================================
const REDDJSON_SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="18" height="18">
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

// ============================================================================
// SELECTORS — UPDATE IF REDDIT CHANGES UI
// ============================================================================

const SELECTORS = {
  // ── New Reddit (shreddit-post custom element) — PRIMARY ──
  shredditPost: 'shreddit-post',

  // ── New Reddit post container fallback ──
  postContainer: '[data-testid="post-container"]',

  // ── Old Reddit post container ──
  oldRedditThing: '.thing.link',

  // ── Share button selectors to find the bottom action bar ──  
  // The JSON button goes NEXT TO the Share button in the action bar
  shareButtonSelectors: [
    'shreddit-post-share-button',
    'button[aria-label="Share"]',
    'faceplate-tracker[source="share"]',
    'button[data-click-id="share"]',
  ],

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
  buttonLabel: 'JSON',
  toastDuration: 2000,
  observerDebounce: 150,
  redditOrange: '#FF4500',
  successGreen: '#46D160',
  errorRed: '#FF585B',
  markerAttribute: 'data-reddjson-added'
};

// ============================================================================
// STATE
// ============================================================================

let isProcessing = false;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================

function showToast(message, type = 'info', nearElement = null) {
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

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = nearElement
      ? 'translateX(-50%) translateY(0)'
      : 'translateX(-50%) translateY(0)';
  });

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
 * Creates the styled JSON copy button with the official ReddJSON SVG icon.
 * Styled to match Reddit's native action bar buttons.
 */
function createJsonButton() {
  const button = document.createElement('button');
  button.className = 'reddjson-button';
  button.type = 'button';
  button.setAttribute('aria-label', 'Copy post JSON to clipboard');
  button.title = 'Copy post JSON to clipboard';

  // Style to match Reddit's native action bar buttons
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    height: 32px;
    border: none;
    border-radius: 20px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
    background: transparent;
    color: var(--color-tone-2, #878A8C);
    transition: background 0.15s, color 0.15s, transform 0.1s;
    user-select: none;
    -webkit-user-select: none;
    outline: none;
    vertical-align: middle;
    position: relative;
    flex-shrink: 0;
  `;

  // Use the official ReddJSON SVG icon
  button.innerHTML = `${REDDJSON_SVG_ICON}<span>${CONFIG.buttonLabel}</span>`;

  // Hover effects matching Reddit's native style
  button.addEventListener('mouseenter', () => {
    button.style.background = 'rgba(255, 69, 0, 0.08)';
    button.style.color = CONFIG.redditOrange;
  });
  button.addEventListener('mouseleave', () => {
    button.style.background = 'transparent';
    button.style.color = 'var(--color-tone-2, #878A8C)';
  });
  button.addEventListener('mousedown', () => {
    button.style.transform = 'scale(0.94)';
  });
  button.addEventListener('mouseup', () => {
    button.style.transform = 'scale(1)';
  });

  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    }
  });

  return button;
}

function createSpinner() {
  return `<svg class="reddjson-spinner" width="16" height="16" viewBox="0 0 24 24" style="animation: reddjson-spin 0.8s linear infinite;">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"/>
  </svg>`;
}

// ============================================================================
// POST DATA EXTRACTION
// ============================================================================

function extractNewRedditPostData(postElement) {
  try {
    let permalink = postElement.getAttribute(SELECTORS.permalinkAttr)
      || postElement.getAttribute(SELECTORS.dataPermalink);

    if (!permalink) {
      const link = postElement.querySelector('a[data-click-id="body"], a[href*="/comments/"]');
      if (link) permalink = link.getAttribute('href');
    }
    if (!permalink) {
      // Try the full-post-link slot
      const fullLink = postElement.querySelector('a[slot="full-post-link"]');
      if (fullLink) permalink = fullLink.getAttribute('href');
    }
    if (!permalink) {
      console.warn('[ReddJSON] Could not find permalink for post element');
      return null;
    }

    let postId = postElement.getAttribute('id');
    if (!postId) {
      const fullname = postElement.getAttribute(SELECTORS.dataFullname);
      postId = fullname ? fullname.replace('t3_', '') : null;
    }
    if (!postId && permalink) {
      const match = permalink.match(/comments\/([a-zA-Z0-9]+)/);
      if (match) postId = match[1];
    }

    let title = '';
    const titleEl = postElement.querySelector(
      'h1, [slot="title"], a[data-click-id="body"] h3, a.title, [data-testid="post-title"]'
    );
    if (titleEl) title = titleEl.textContent.trim();
    // Fallback: try post-title attribute
    if (!title) title = postElement.getAttribute('post-title') || '';

    let subreddit = '';
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

function extractOldRedditPostData(postElement) {
  try {
    let permalink = postElement.getAttribute('data-permalink')
      || postElement.getAttribute('data-url');

    if (!permalink) {
      const commentsLink = postElement.querySelector('a.comments, a.bylink, a[href*="/comments/"]');
      if (commentsLink) permalink = commentsLink.getAttribute('href');
    }
    if (!permalink) return null;

    let postId = postElement.getAttribute('data-fullname');
    if (postId) {
      postId = postId.replace('t3_', '');
    } else {
      const classMatch = postElement.className.match(/id-t3[-_]([a-zA-Z0-9]+)/);
      if (classMatch) postId = classMatch[1];
    }

    let title = '';
    const titleEl = postElement.querySelector('a.title, .title a');
    if (titleEl) title = titleEl.textContent.trim();

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

function extractPostData(postElement, type = 'new') {
  return type === 'old'
    ? extractOldRedditPostData(postElement)
    : extractNewRedditPostData(postElement);
}

// ============================================================================
// JSON COPY HANDLER
// ============================================================================

async function handleJsonCopy(event, button, postData) {
  event.preventDefault();
  event.stopPropagation();

  if (button.disabled) return;

  const originalContent = button.innerHTML;
  button.innerHTML = createSpinner();
  button.disabled = true;
  button.style.cursor = 'wait';

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'fetchJSON',
      permalink: postData.permalink
    });

    if (!response || !response.success) {
      showToast(response?.error || 'Failed to fetch JSON', 'error', button);
      return;
    }

    const prettyJson = JSON.stringify(response.data, null, 2);
    await navigator.clipboard.writeText(prettyJson);
    showToast('JSON copied!', 'success', button);

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

    if (error.name === 'NotAllowedError') {
      showToast('Focus this tab and try again', 'error', button);
    } else {
      showToast('Copy failed: ' + (error.message || 'Unknown error'), 'error', button);
    }
  } finally {
    button.innerHTML = originalContent;
    button.disabled = false;
    button.style.cursor = 'pointer';
  }
}

// ============================================================================
// BUTTON INJECTION — NEW REDDIT
// ============================================================================

/**
 * Finds the Share button's parent action bar in a <shreddit-post>.
 * This is the BOTTOM action bar containing vote, comments, award, share.
 * We inject our button right AFTER the share button so it sits next to it.
 *
 * @param {HTMLElement} postElement - The <shreddit-post> element
 * @returns {{container: HTMLElement, shareButton: HTMLElement}|null}
 */
function findActionBar(postElement) {
  // Strategy: find the Share button first, then its parent is the action bar
  for (const selector of SELECTORS.shareButtonSelectors) {
    // Search within the post element
    const shareBtn = postElement.querySelector(selector);
    if (shareBtn) {
      return { container: shareBtn.parentElement, shareButton: shareBtn };
    }
  }

  // Fallback: Try shadow DOM of shreddit-post if applicable
  if (postElement.shadowRoot) {
    for (const selector of SELECTORS.shareButtonSelectors) {
      const shareBtn = postElement.shadowRoot.querySelector(selector);
      if (shareBtn) {
        return { container: shareBtn.parentElement, shareButton: shareBtn };
      }
    }
  }

  // Last fallback: search for any element containing "Share" text in the bottom area
  const allButtons = postElement.querySelectorAll('button');
  for (const btn of allButtons) {
    const text = btn.textContent?.trim();
    if (text === 'Share' || btn.getAttribute('aria-label')?.includes('Share')) {
      return { container: btn.parentElement, shareButton: btn };
    }
  }

  return null;
}

/**
 * Injects a JSON button into a New Reddit <shreddit-post> element.
 * Places the button in the BOTTOM action bar, right after the Share button.
 */
function injectButtonToNewRedditPost(postElement) {
  if (postElement.hasAttribute(CONFIG.markerAttribute)) return;

  const postData = extractPostData(postElement, 'new');
  if (!postData?.permalink) return;

  // Find the action bar and share button
  const actionBar = findActionBar(postElement);
  if (!actionBar) {
    // If we can't find the action bar yet, the post might still be loading
    // We'll try again on the next mutation observer pass
    console.debug('[ReddJSON] Action bar not found for post, will retry:', postData.permalink);
    return;
  }

  const button = createJsonButton();
  button.addEventListener('click', (e) => handleJsonCopy(e, button, postData));

  // Insert AFTER the share button so it appears next to it
  actionBar.shareButton.after(button);

  postElement.setAttribute(CONFIG.markerAttribute, 'true');
  console.debug('[ReddJSON] ✓ Button injected for:', postData.permalink);
}

/**
 * Injects a JSON button into an Old Reddit .thing element.
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
    height: auto;
  `;

  button.addEventListener('click', (e) => handleJsonCopy(e, button, postData));

  const listItem = document.createElement('li');
  listItem.className = 'reddjson-old-reddit-item';
  listItem.style.display = 'inline-block';
  listItem.appendChild(button);

  toolbar.appendChild(listItem);
  postElement.setAttribute(CONFIG.markerAttribute, 'true');
}

// ============================================================================
// POST PROCESSING
// ============================================================================

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

      // Fallback: check [data-testid="post-container"]
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

function injectStyles() {
  const styleId = 'reddjson-injected-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes reddjson-spin {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
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

function init() {
  console.log('[ReddJSON] Content script initializing…');

  injectStyles();
  processAllPosts();
  startObserver();

  // Retry after a short delay for posts that were still loading
  setTimeout(processAllPosts, 1000);
  setTimeout(processAllPosts, 3000);

  console.log('[ReddJSON] Content script initialized ✓');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 150);
}

// Handle SPA-style navigation
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    console.log('[ReddJSON] URL changed → reprocessing…');
    document.querySelectorAll(`[${CONFIG.markerAttribute}]`).forEach(el => {
      el.removeAttribute(CONFIG.markerAttribute);
    });
    setTimeout(processAllPosts, 500);
  }
}).observe(document, { subtree: true, childList: true });
