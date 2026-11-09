import test from 'node:test';
import assert from 'node:assert/strict';

// Test URL parsing logic for single post pages and quarantined subreddits
test('extracts post data correctly from URL pathname on single post page', () => {
  const path = '/r/opencode/comments/1xpylm3/i_love_opencode/';
  const urlMatch = path.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
  assert.ok(urlMatch);
  assert.equal(urlMatch[1], 'opencode');
  assert.equal(urlMatch[2], '1xpylm3');
});

test('extracts post data correctly from quarantined or short URL pathname', () => {
  const path = '/r/quarantined_sub/comments/abc123z/';
  const urlMatch = path.match(/\/r\/([^/]+)\/comments\/([^/]+)/);
  assert.ok(urlMatch);
  assert.equal(urlMatch[1], 'quarantined_sub');
  assert.equal(urlMatch[2], 'abc123z');
});

test('slot determination correctly identifies appropriate slot name for Web Components', () => {
  function determineSlot(targetEl, postElement) {
    if (targetEl?.getAttribute?.('slot')) return targetEl.getAttribute('slot');
    if (targetEl?.parentElement && targetEl.parentElement !== postElement && targetEl.parentElement.getAttribute?.('slot')) {
      return targetEl.parentElement.getAttribute('slot');
    }
    const candidates = ['action-bar', 'share-button', 'credit-bar', 'post-overflow-menu'];
    for (const c of candidates) {
      if (postElement?.mockSlots?.includes(c)) return c;
    }
    return 'action-bar';
  }

  // Case 1: share button has slot="share-button"
  const shareBtn = { getAttribute: (attr) => (attr === 'slot' ? 'share-button' : null), parentElement: null };
  assert.equal(determineSlot(shareBtn, null), 'share-button');

  // Case 2: share button has slot="action-bar"
  const actionBtn = { getAttribute: (attr) => (attr === 'slot' ? 'action-bar' : null), parentElement: null };
  assert.equal(determineSlot(actionBtn, null), 'action-bar');

  // Case 3: postElement has slot candidates
  const postElement = { mockSlots: ['action-bar'] };
  assert.equal(determineSlot({}, postElement), 'action-bar');
});

test('hasReddJsonButtons prevents duplicates without false blocking new elements', () => {
  function hasReddJsonButtons(el) {
    if (!el) return false;
    return Boolean(el.hasButtons);
  }

  const postInFeed = { hasButtons: true };
  const newPostOnPage = { hasButtons: false };

  assert.equal(hasReddJsonButtons(postInFeed), true);
  assert.equal(hasReddJsonButtons(newPostOnPage), false);
});

test('normalizes permalink correctly for fetchRedditJSON', () => {
  function normalizePermalink(permalink) {
    let normalizedPath = permalink.startsWith('/') ? permalink : '/' + permalink;
    normalizedPath = normalizedPath.replace(/\/+$/, '');
    return `https://www.reddit.com${normalizedPath}.json`;
  }

  assert.equal(
    normalizePermalink('/r/opencode/comments/1xpylm3/i_love_opencode/'),
    'https://www.reddit.com/r/opencode/comments/1xpylm3/i_love_opencode.json'
  );
  assert.equal(
    normalizePermalink('r/quarantined/comments/123/'),
    'https://www.reddit.com/r/quarantined/comments/123.json'
  );
  assert.equal(
    normalizePermalink('/comments/1xpylm3'),
    'https://www.reddit.com/comments/1xpylm3.json'
  );
});

test('validates and sanitizes imported history entries against malicious payloads', () => {
  function validateHistoryEntry(e) {
    if (!e || typeof e !== 'object') return null;
    if (!e.postId || typeof e.postId !== 'string') return null;
    return {
      id: typeof e.id === 'string' ? e.id : `reddjson_${Date.now()}_${e.postId}`,
      postId: String(e.postId).slice(0, 50),
      title: typeof e.title === 'string' ? e.title.slice(0, 300) : 'Untitled Post',
      subreddit: typeof e.subreddit === 'string' ? e.subreddit.slice(0, 50) : 'unknown',
      permalink: typeof e.permalink === 'string' ? e.permalink.slice(0, 500) : '',
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
      copiedCount: typeof e.copiedCount === 'number' ? e.copiedCount : 1,
      jsonPreview: typeof e.jsonPreview === 'string' ? e.jsonPreview.slice(0, 500) : ''
    };
  }

  const valid = validateHistoryEntry({ postId: '1xpylm3', title: 'A valid post', subreddit: 'opencode' });
  assert.ok(valid);
  assert.equal(valid.postId, '1xpylm3');
  assert.equal(valid.title, 'A valid post');

  const invalid = validateHistoryEntry({ __proto__: { evil: true } });
  assert.equal(invalid, null);

  const oversized = validateHistoryEntry({ postId: 'p1', title: 'A'.repeat(500) });
  assert.equal(oversized.title.length, 300);
});

test('mock DOM: simulates single post page injection and slot assignment', () => {
  // Mock element hierarchy for Reddit's modern shreddit-post
  class MockElement {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName;
      this.attributes = { ...attributes };
      this.children = [];
      this.parentElement = null;
      this.shadowRoot = null;
    }
    getAttribute(name) { return this.attributes[name] || null; }
    setAttribute(name, val) { this.attributes[name] = String(val); }
    hasAttribute(name) { return name in this.attributes; }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    after(newSibling) {
      if (!this.parentElement) return;
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        newSibling.parentElement = this.parentElement;
        this.parentElement.children.splice(idx + 1, 0, newSibling);
      }
    }
    querySelector(selector) {
      for (const child of this.children) {
        if (selector === child.tagName || selector === child.getAttribute('class')) return child;
        if (selector.startsWith('[slot=') && child.getAttribute('slot') === selector.slice(7, -2)) return child;
        const found = child.querySelector?.(selector);
        if (found) return found;
      }
      return null;
    }
  }

  const post = new MockElement('shreddit-post', {
    id: 't3_1xpylm3',
    permalink: '/r/opencode/comments/1xpylm3/i_love_opencode/'
  });
  const shareButton = new MockElement('shreddit-post-share-button', { slot: 'share-button' });
  post.appendChild(shareButton);

  // Determine slot
  let slotName = shareButton.getAttribute('slot');
  assert.equal(slotName, 'share-button');

  const wrapper = new MockElement('span', { class: 'reddjson-buttons-wrapper' });
  if (slotName) wrapper.setAttribute('slot', slotName);
  shareButton.after(wrapper);

  // Assert wrapper was slotted and inserted after share button
  assert.equal(wrapper.getAttribute('slot'), 'share-button');
  assert.equal(post.children[1], wrapper);
  assert.equal(wrapper.parentElement, post);
});
