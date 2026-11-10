import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Skill-engine integration test: evaluates the REAL background.js service
 * worker with stubbed chrome.* APIs (same technique as the DOM mocks in
 * test-reddjson.js) and drives buildSystemPrompt() + humanizeDraft() against
 * the vendored skill data — the exact production code path for the
 * /li-post hook formulas and the /li-human humanizer.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const requireExt = createRequire(import.meta.url);

const noop = () => {};
const chromeStub = {
  sidePanel: { setPanelBehavior: () => Promise.resolve(), open: () => Promise.resolve() },
  storage: { local: { get: async () => ({}), set: noop } },
  runtime: {
    onMessage: { addListener: noop },
    onInstalled: { addListener: noop },
    getURL: (p) => 'file:///' + resolve(ROOT, p).replace(/\\/g, '/'),
    sendMessage: noop
  },
  commands: { onCommand: { addListener: noop } },
  tabs: { query: async () => [{}], sendMessage: noop }
};

function importScriptsStub(p) {
  // Same file the service worker would importScripts()
  globalThis.ReddJSONHumanizer = requireExt(resolve(ROOT, p));
}

// Node's fetch cannot read file:// URLs; back it with the real vendored
// bytes so chrome.runtime.getURL + init() exercise the genuine code path.
const realFetch = globalThis.fetch;
const stubFetch = (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('file://')) {
    const file = new URL(url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const body = new TextEncoder().encode(readFileSync(file, 'utf8'));
    return Promise.resolve(new Response(body, { status: 200 }));
  }
  return realFetch(input, init);
};

globalThis.chrome = chromeStub;
globalThis.fetch = stubFetch;

// Evaluate the real service worker source, then expose its internals.
const src = readFileSync(join(ROOT, 'background.js'), 'utf8')
  + '\nglobalThis.__bg = { buildSystemPrompt, humanizeDraft, PROMPT_TEMPLATES };';
new Function('chrome', 'importScripts', 'fetch', src)
  (chromeStub, importScriptsStub, stubFetch);
const { buildSystemPrompt, humanizeDraft, PROMPT_TEMPLATES } = globalThis.__bg;

test('background ships the hook-engine template with the placeholder', () => {
  const tpl = PROMPT_TEMPLATES.find(t => t.id === 'hook-engine');
  assert.ok(tpl, 'hook-engine built-in template exists');
  assert.ok(tpl.prompt.includes('{{HOOK_FORMULAS}}'), 'placeholder wired for generation-time injection');
});

test('buildSystemPrompt injects all 21 formulas + the voice profile', async () => {
  await ReddJSONHumanizer.init(); // same ordering guarantee the handler enforces
  const tpl = PROMPT_TEMPLATES.find(t => t.id === 'hook-engine');
  const prompt = buildSystemPrompt(tpl, { voiceProfile: 'SMOKE-VOICE-MARKER' });
  assert.ok(prompt.includes('#1 Contrarian Take'));
  assert.ok(prompt.includes('#21 The Direct Value'));
  assert.ok(prompt.includes('SMOKE-VOICE-MARKER'), 'voice profile appended');
  // ...and to non-hook templates as well
  const plain = PROMPT_TEMPLATES.find(t => t.id === 'default');
  assert.ok(buildSystemPrompt(plain, { voiceProfile: 'SMOKE-VOICE-MARKER' }).includes('SMOKE-VOICE-MARKER'));
});

test('humanizeDraft cleans and scores an AI draft end-to-end', async () => {
  const awful = 'I am excited to announce a deep dive into my framework overview \u2014 I leverage ' +
    'robust, seamless, and scalable tooling to utilize synergies and unlock game-changing ' +
    'value \u200B\u200B\u200Bin the realm. Furthermore, it\u2019s not just a tool, it\u2019s a movement.';
  const hr = await humanizeDraft(awful);
  assert.ok(hr.humanData, 'humanData produced');
  assert.ok(!/\u200B/.test(hr.text), 'zero-width watermark chars removed');
  assert.ok(!/\u2014/.test(hr.text), 'em dash removed');
  assert.ok(!/\b(seamless|leverage)\b/i.test(hr.text), 'slop replaced');
  assert.ok(typeof hr.humanData.humanScore === 'number');
  assert.ok(['PASS', 'REVIEW', 'FLAGGED'].includes(hr.humanData.verdict));
  assert.ok(hr.humanData.humanReport.checks.BURSTINESS, 'five checks stored');
  assert.ok(hr.humanData.humanReport.structures.some(s => s.name && s.fix), 'tells keep fix guidance');
});
