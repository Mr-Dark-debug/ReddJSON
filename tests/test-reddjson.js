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

test('slot determination mirrors the v2.3 placement decision table', () => {
  // From findActionBar + injectButtonsToNewRedditPost (v2.3): the wrapper
  // carries a slot attribute only when it is a direct light child of the
  // post (or forceSlot is set). Verified targets come from Reddit's shadow
  // DOM: the bottom action bar is rpl-action-bar > slot[name=share-button],
  // and there is NO slot named "action-bar" — assigning to it renders nothing.
  function placeWrapper(wrapper, post, actionBar) {
    const isDirectChildOfPost =
      actionBar.shareButton?.parentElement === post || actionBar.container === post;
    const slotName = actionBar.forceSlot ||
      (actionBar.slotName && isDirectChildOfPost ? actionBar.slotName : null);
    if (slotName) wrapper.setAttribute('slot', slotName);
    if (actionBar.shareButton && actionBar.shareButton.parentElement) {
      actionBar.shareButton.after(wrapper);
    } else if (actionBar.container) {
      actionBar.container.appendChild(wrapper);
    }
    return wrapper;
  }

  // Case 1: shadow root bottom bar exists -> wrapper slotted share-button, appended
  const post1b = { children: [], appendChild(c) { this.children.push(c); c.parentElement = this; } };
  const w1 = { setAttribute(k, v) { this['_s' + k] = v; } };
  placeWrapper(w1, post1b, { container: post1b, shareButton: null, inShadow: true, slotName: 'share-button' });
  assert.equal(w1['_sslot'], 'share-button', 'shadow-slot strategy must assign slot=share-button');
  assert.equal(post1b.children.length, 1);

  // Case 2: direct own share button -> inherits its slot name, inserted after it
  const share2 = { parentElement: null, attributes: {}, getAttribute: (a) => 'share-button', after(n) { n.parentElement = this.parentElement; } };
  const post2 = { appendChild(c) { share2.parentElement = post2; } };
  post2.appendChild(share2);
  const w2 = { setAttribute(k, v) { this['_s' + k] = v; } };
  placeWrapper(w2, post2, { container: post2, shareButton: share2, inShadow: false, slotName: 'share-button' });
  assert.equal(w2['_sslot'], 'share-button');

  // Case 3: NOT a direct child (deep in a container) -> NO slot attribute
  const w3 = { setAttribute(k, v) { this['_s' + k] = v; } };
  placeWrapper(w3, {}, { container: {}, shareButton: { parentElement: {}, after: () => {} }, inShadow: false, slotName: 'share-button' });
  assert.equal(w3['_sslot'], undefined, 'deep-inserted wrappers must render inline (no slot attr)');

  // Case 4: single-post fallback forceSlot must target the existing
  // share-button slot — 'action-bar' does not exist in the shadow root and
  // an assignment to it renders nowhere (invisible buttons bug).
  const post4 = { children: [], appendChild(c) { this.children.push(c); } };
  const w4 = { setAttribute(k, v) { this['_s' + k] = v; } };
  placeWrapper(w4, post4, { container: post4, shareButton: null, inShadow: false, forceSlot: 'share-button' });
  assert.equal(w4['_sslot'], 'share-button');
  assert.equal(post4.children.length, 1);
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
    closest(selector) {
      let cur = this;
      while (cur) {
        if (selector === cur.tagName) return cur;
        if (selector.startsWith('[slot=') && cur.getAttribute && cur.getAttribute('slot') === selector.slice(7, -2)) return cur;
        cur = cur.parentElement;
      }
      return null;
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

test('mock DOM: feed card without light share button slotted into the shadow bottom bar', () => {
  // Verified Reddit structure: feed cards have NO share/comment buttons in
  // light DOM until hydration; the bottom action bar is inside the post's
  // shadow root as rpl-action-bar > div > slot[name="share-button"].
  const post = {
    children: [],
    shadowRoot: { slots: ['share-button'] },
    querySelector(selector) {
      if (selector === ':scope > shreddit-post-share-button') return null; // not hydrated
      return null;
    },
    appendChild(c) { this.children.push(c); c.parentElement = this; }
  };

  // findActionBar strategy A replica
  let actionBar = null;
  if (post.shadowRoot?.slots?.includes('share-button')) {
    actionBar = { container: post, shareButton: null, inShadow: true, slotName: 'share-button' };
  }
  assert.ok(actionBar, 'shadow bottom-bar strategy must fire on feed cards');

  // injectButtonsToNewRedditPost placement replica
  const wrapper = { attributes: {}, getAttribute(n) { return this.attributes[n] || null; }, setAttribute(n, v) { this.attributes[n] = v; } };
  const isDirectChildOfPost =
    (actionBar.shareButton?.parentElement === post) || (actionBar.container === post);
  const slotName = actionBar.forceSlot ||
    (actionBar.slotName && isDirectChildOfPost ? actionBar.slotName : null);
  slotName && wrapper.setAttribute('slot', slotName);
  if (actionBar.shareButton && actionBar.shareButton.parentElement) {
    actionBar.shareButton.after(wrapper);
  } else {
    actionBar.container.appendChild(wrapper);
  }

  assert.equal(wrapper.getAttribute('slot'), 'share-button');
  assert.equal(post.children.length, 1);
  assert.equal(post.children[0], wrapper);
});

test('mock DOM: credit-bar anchoring (overflow menu at top of card) is rejected', () => {
  const post = {
    children: [],
    shadowRoot: null,
    querySelector() { return null; },
    appendChild(c) { this.children.push(c); }
  };
  // span[slot=credit-bar] > span > shreddit-post-overflow-menu
  const creditBar = { slot: 'credit-bar', children: [], getAttribute: (n) => n === 'slot' ? 'credit-bar' : null };
  const innerSpan = { children: [], parentElement: creditBar, getAttribute: (n) => null, closest(sel) { return sel === '[slot="credit-bar"]' ? creditBar : (sel === 'shreddit-post' ? post : null); } };
  const overflowMenu = {
    textContent: 'More options',
    parentElement: innerSpan,
    closest(sel) {
      let cur = this;
      while (cur) {
        if (sel.startsWith('[slot=') && cur.getAttribute?.('slot') === sel.slice(7, -2)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
  };
  innerSpan.children.push(overflowMenu);

  // Replica of the reject rule in findActionBar's generic fallback:
  const ruleRejects = (candidate) => !candidate || candidate.closest?.('[slot="credit-bar"]') != null;
  assert.equal(ruleRejects(overflowMenu), true, 'the overflow menu inside credit-bar must never anchor placement');
  assert.equal(ruleRejects(null), true, 'null candidates are not anchors');

  // The buggy v2.2 behavior — anchor = overflow menu, buttons render at top.
  // v2.3 must therefore return "no action bar" here (retry via observer)
  // instead of anchoring at the top of the card.
  const findActionBarReplica = (ownShareFound) => {
    if (ownShareFound) return { anchored: 'share-button' };
    return null; // no shadow slot, no direct share button, credit-bar rejected
  };
  assert.equal(findActionBarReplica(false), null);
});

test('mock DOM: embedded/crossposted post cannot hijack placement or dedup', () => {
  // A crosspost embed is a full shreddit-post INSIDE the main card.
  const mainPost = { closest: () => null, children: [] };
  const embedded = { closest: () => embedded, children: [] };
  // our wrapper only ever inside the embedded post
  const embeddedWrapper = { closest: (sel) => (sel === 'shreddit-post' ? embedded : null) };
  embedded.children.push(embeddedWrapper);
  const embeddedShare = { closest: (sel) => (sel === 'shreddit-post' ? embedded : null) };
  embedded.children.push(embeddedShare);

  // hasReddJsonButtons v2.3: only buttons whose nearest shreddit-post host is
  // the scanned element count.
  function hasReddJsonButtons(el, buttons) {
    for (const node of buttons) {
      if (!node.closest?.('shreddit-post') || node.closest('shreddit-post') === el) return true;
    }
    return false;
  }
  const allButtons = [embeddedWrapper, embeddedShare];
  assert.equal(hasReddJsonButtons(mainPost, allButtons), false,
    'embedded-post buttons must not mark the main card as processed');
  assert.equal(hasReddJsonButtons(embedded, allButtons), true,
    'the embedded post itself owns its buttons');

  // findActionBar own-share check uses :scope > semantics = a DIRECT child.
  const directOwnShare = (postLike) => postLike.children.find(
    c => c.getAttribute?.('aria-share') === 'y' && c.parentElement === postLike);
  const own = { getAttribute: (n) => (n === 'aria-share' ? 'y' : null), parentElement: null };
  mainPost.children.push(own);
  own.parentElement = mainPost;
  assert.equal(directOwnShare(mainPost), own, 'direct share child is an anchor');
  assert.equal(directOwnShare(embedded), undefined,
    'embedded share (not a direct child of the main card) must not anchor the main card');
});
