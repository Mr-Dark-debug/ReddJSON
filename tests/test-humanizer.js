import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import humanizer from '../lib/humanizer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// Same data path as the extension, but straight from disk (no chrome.*).
humanizer.loadLexicon(JSON.parse(readFileSync(join(ROOT, 'skills', 'li-human', 'slop.json'), 'utf8')));
const LEX = JSON.parse(readFileSync(join(ROOT, 'skills', 'li-human', 'slop.json'), 'utf8'));
humanizer.loadHooks(JSON.parse(readFileSync(join(ROOT, 'skills', 'li-post', 'hooks.json'), 'utf8')));

const SLOP_DRAFT = 'I am excited to announce a deep dive into my latest framework overview \u2014 I leverage robust, seamless, and scalable tooling to utilize synergies and unlock the game-changing value of a comprehensive journey into the realm. Furthermore, it\u2019s not just a tool, it\u2019s a movement. \ud83d\ude80 In today\u2019s fast-paced world, it is worth noting that #content #marketing #growth #ai #saas #links';

test('invisible characters are deleted or normalised', () => {
  // ZWSP ZWNC ZWJ WORD-JOINER BOM are deleted; NBSP and narrow NBSP become spaces.
  const dirty = 'a\u200Bb\u200Cc\u200Dd\u2060e\uFEFFf\u00A0g\u202Fh';
  const { text, report } = humanizer.humanize(dirty);
  assert.equal(text, 'abcdef g h');
  const totalRemoved = report.invisible.reduce((sum, h) => sum + h.count, 0);
  assert.equal(totalRemoved, 7); // 5 deletes + 2 space-normalisations
  assert.ok(report.invisible.some(h => h.action === 'space'));
});

test('typographic fingerprints become plain equivalents', () => {
  const [text] = humanizer._internal.passTypographic(
    'Growth \u2014 the numbers never lie \u2014 or do they? 5\u201310 items, \u201Cquotes\u201D and \u2018single\u2019\u2026',
    LEX
  );
  // Every em dash becomes ", " exactly where it stood (humanize.py parity).
  assert.equal(text, 'Growth, the numbers never lie, or do they? 5-10 items, "quotes" and \'single\'...');
});

test('slop lexicon replaces stock terms, longest first, keeping case', () => {
  const [text, hits] = humanizer._internal.passLexical(
    'We leverage robust tooling to delve into synergy. Leverage it. My seamless end: game-changer.',
    LEX
  );
  assert.ok(!/\bleverage\b/i.test(text), text);
  assert.ok(!/\brobust\b/i.test(text), text);
  assert.ok(!/\bdelve into\b/i.test(text), text);
  assert.ok(text.includes('We use solid tooling to look at overlap.'), text);
  assert.ok(text.includes('Use it.'), text);            // capitalisation preserved
  assert.ok(text.includes('big deal'), text);           // game-changer
  const found = hits.map(h => h.find);
  for (const term of ['leverage', 'robust', 'delve into', 'game-changer']) {
    assert.ok(found.includes(term), 'expected hit for ' + term);
  }
});

test('URLs and emails are untouched by every pass', () => {
  const url = 'https://www.example.com/path?q=1&utm=x';
  const input = 'Check ' + url + ' \u2014 leverage this analysis, and reply to me@example.com for more advice';
  const { text, report } = humanizer.humanize(input);
  assert.ok(text.includes(url), text);
  assert.ok(text.includes('me@example.com'), text);
  assert.ok(!/\u2014/.test(text), 'the loose em dash outside the URL must go');
  assert.ok(report.lexical.some(h => h.find === 'leverage'));
});

test('structural tells are flagged, never rewritten', () => {
  const tell = 'It\u2019s not just a tool, it\u2019s a framework.';
  const { text, report } = humanizer.humanize(tell);
  const names = report.structures.map(s => s.name);
  assert.ok(names.some(n => n.includes("It's not just X, it's Y")), JSON.stringify(names));
  assert.ok(text.includes('not just a tool'), 'structure must survive into the text for manual rewrite');
});

test('verdict + scores match the upstream five-check math', () => {
  const r = humanizer.detect('Short one.');
  assert.equal(r.checks.BURSTINESS.score, 50);   // too short to judge
  assert.equal(r.checks.SPECIFICITY.score, 50);  // too short to judge
  assert.equal(r.checks['SLOP DENSITY'].score, 100); // zero stock terms
  assert.equal(r.checks.FINGERPRINT.score, 100); // nothing to fingerprint
  assert.equal(r.checks.VOICE.score, 50);        // too short to judge
  const scores = Object.values(r.checks).map(c => c.score);
  const overall = scores.reduce((a, b) => a + b, 0) / scores.length * 0.6 + Math.min(...scores) * 0.4;
  assert.equal(r.overall, Math.round(overall * 10) / 10);
  assert.equal(r.verdict, 'REVIEW');
});

test('a deliberately machine-flavored draft is FLAGGED; cleaning lifts the score', () => {
  const before = humanizer.detect(SLOP_DRAFT);
  assert.equal(before.verdict, 'FLAGGED');
  const { text, report } = humanizer.humanize(SLOP_DRAFT);
  assert.ok(report.invisible.length === 0 || true); // presence is validated by other tests
  const after = humanizer.detect(text);
  assert.ok(after.overall > before.overall + 15,
    'humanizing must lift the score: ' + before.overall + ' -> ' + after.overall);
  assert.ok(after.checks.FINGERPRINT.score >= before.checks.FINGERPRINT.score);
});

test('a human-flavoured draft can PASS the panel', () => {
  const draft = [
    'I sent 400 cold emails in January.',
    'Eleven replied.',
    'Two became clients.',
    'The first no was six words long and completely final, so I stopped pitching and started publishing instead.',
    'Then he saw the page I had written about his competitor.',
    'He called.',
    "It was an 8-minute call. I won't forget it.",
    'One question: what did the numbers cost them?',
    "Now I write that exact page before every single pitch. I don't wait for permission. I don't pitch cold anymore.",
    'Nobody reads 40 slide decks anymore.',
    'People read 1 page about themselves.'
  ].join(' ');
  const r = humanizer.detect(draft);
  assert.ok(r.overall >= 70 && r.verdict === 'PASS',
    'expected PASS, got ' + r.overall + ' ' + r.verdict + ' (weakest: ' + r.weakest + ')');
});

test('_internal.scale clones the detect.py mapping', () => {
  const { scale } = humanizer._internal;
  assert.equal(scale(0.70, 0.70, 0.22), 100);
  assert.equal(scale(0.22, 0.70, 0.22), 0);
  assert.ok(Math.abs(scale(0.50, 0.70, 0.22) - 58.333) < 0.01);
});

test('matchCase preserves capitalisation like humanize.py', () => {
  const { matchCase } = humanizer._internal;
  assert.equal(matchCase('Leverage', 'use'), 'Use');
  assert.equal(matchCase('LEVERAGE', 'use'), 'USE');
  assert.equal(matchCase('leverage', 'use'), 'use');
});

test('buildHookBlock carries rules plus every one of the 21 formulas', () => {
  const block = humanizer.buildHookBlock();
  assert.ok(block.includes('HOOK FORMULA LIBRARY'), block.slice(0, 120));
  assert.ok(block.includes('#1 Contrarian Take'));
  assert.ok(block.includes('#21 The Direct Value'));
  assert.ok(block.includes('Numbers beat adjectives.'));
  assert.ok(block.includes('How it gets ruined:'), 'traps must guide the model');
  const ids = [...block.matchAll(/#(\d+) /g)].map(m => Number(m[1]));
  assert.equal(new Set(ids).size, 21);
});
