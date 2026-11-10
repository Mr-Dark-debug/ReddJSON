/**
 * ReddJSON Humanizer v1.0
 * ═══════════════════════════════════════════════════════════════════════
 * JavaScript port of the /li-human skill tools from the MIT-licensed
 * linkedin-agent-skill (github.com/Jakeschincariol/linkedin-agent-skill
 * @ add2c23882fe79180737d242ff80a5da205eda6a), adapted for ReddJSON v2.2.
 *
 * Two local, zero-dependency tools:
 *   humanize(text)  — the 3 cleaning passes from humanize.py:
 *                       1. INVISIBLE    zero-width / format / odd spaces
 *                       2. TYPOGRAPHIC  em dash → comma, curly → straight, …
 *                       3. LEXICAL      slop lexicon → plain English
 *   detect(text)    — the five-check panel from detect.py:
 *                       BURSTINESS · SPECIFICITY · SLOP DENSITY ·
 *                       FINGERPRINT · VOICE  →  overall + verdict
 *   scanStructures  — structural tells, flagged but never auto-rewritten.
 *   buildHookBlock  — prompt block built from the vendored hooks.json.
 *
 * The lexicon (skills/li-human/slop.json) and hooks (skills/li-post/hooks.json)
 * are read from the vendored upstream files at runtime, keeping this port
 * resync-able. Structural tells are REPORTED, not regex-rewritten — changing
 * a sentence's shape needs judgement, per upstream design.
 *
 * Loads in: background service worker (importScripts), side panel (<script>),
 * and Node tests (require/import). No chrome.* dependency unless init() is used.
 *
 * @version 1.0.0
 */

(function (root) {
  'use strict';

  // --------------------------------------------------------------------------
  // STATE — injected data
  // --------------------------------------------------------------------------

  let lexicon = null;   // slop.json content
  let hooks = null;     // hooks.json content
  let structRegexes = null; // lazy cache: slop.json structure regexes compiled for JS
  let initPromise = null;

  function loadLexicon(obj) {
    lexicon = obj || null;
    structRegexes = null;
  }

  function loadHooks(obj) {
    hooks = obj || null;
  }

  /**
   * Fetch and cache the vendored skill data via chrome.runtime.getURL().
   * Works in both the MV3 service worker and the side panel document.
   */
  function init() {
    if (initPromise) return initPromise;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
      return Promise.reject(new Error('ReddJSONHumanizer.init: chrome.runtime unavailable (inject lexicon with loadLexicon instead)'));
    }
    initPromise = (async () => {
      const [lexRes, hookRes] = await Promise.all([
        fetch(chrome.runtime.getURL('skills/li-human/slop.json')),
        fetch(chrome.runtime.getURL('skills/li-post/hooks.json'))
      ]);
      if (!lexRes.ok) throw new Error('Failed to load slop.json: HTTP ' + lexRes.status);
      if (!hookRes.ok) throw new Error('Failed to load hooks.json: HTTP ' + hookRes.status);
      loadLexicon(await lexRes.json());
      loadHooks(await hookRes.json());
      return api;
    })();
    return initPromise;
  }

  function requireLexicon() {
    if (!lexicon) throw new Error('ReddJSONHumanizer: lexicon not loaded — call init() or loadLexicon() first');
    return lexicon;
  }

  // --------------------------------------------------------------------------
  // MATH HELPERS — same formulas as detect.py
  // --------------------------------------------------------------------------

  function clamp(n) {
    return Math.max(0, Math.min(100, n));
  }

  /** Map value onto 0–100 where `human` → 100 and `machine` → 0. */
  function scale(value, human, machine) {
    if (human === machine) return 50;
    return clamp((value - machine) / (human - machine) * 100);
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function mean(arr) {
    return arr.reduce((s, n) => s + n, 0) / arr.length;
  }

  /** Population standard deviation (statistics.pstdev in the reference). */
  function pstdev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s, n) => s + (n - m) * (n - m), 0) / arr.length);
  }

  /** True character (codepoint) count — argv parity with Python `len(text)`. */
  function charCount(text) {
    return [...text].length;
  }

  function wordChars(text) {
    const m = text.match(/[A-Za-z']+/g); // WORD_RE from detect.py
    return m || [];
  }

  function sentenceLens(text) {
    // SENT_RE from detect.py: r"[^.!?\n]+[.!?]*", sentences with > 2 words
    const out = [];
    for (const match of text.matchAll(/[^.!?\n]+[.!?]*/g)) {
      const words = match[0].split(/\s+/).filter(Boolean);
      if (words.length > 2) out.push(words.length);
    }
    return out;
  }

  // --------------------------------------------------------------------------
  // REGEX HELPERS
  // --------------------------------------------------------------------------

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** \b find \b with escaped specials; spaces inside the term become \s+. */
  function termRegExp(find) {
    return new RegExp('\\b' + escapeRe(find).replace(/ /g, '\\s+') + '\\b', 'gi');
  }

  /** Preserve the capitalisation of the source word into the replacement. */
  function matchCase(src, repl) {
    if (!repl) return repl;
    if (src.length > 1 && src === src.toUpperCase()) return repl.toUpperCase();
    if (src[0] !== src[0].toLowerCase()) return repl[0].toUpperCase() + repl.slice(1);
    return repl;
  }

  // slop.json carries Python-style escapes in structure regexes:
  //   "(?i)" inline flags                       → i flag
  //   "\U0001F680" 8-digit codepoint escapes    → literal characters
  function sanitizeStructRegex(source) {
    let flags = 'gm';
    const s = source.replace(/\(\?i\)/g, () => { flags = 'gmi'; return ''; })
      .replace(/\\U([0-9A-Fa-f]{1,8})/g, (m, hex) => {
        const cp = parseInt(hex, 16);
        return cp > 0xFFFF
          ? '\\u{' + cp.toString(16) + '}'
          : '\\u' + cp.toString(16).padStart(4, '0');
      });
    return { source: s, flags };
  }

  function getStructRegexes(lex) {
    if (structRegexes) return structRegexes;
    structRegexes = [];
    for (const s of lex.structures || []) {
      const { source, flags } = sanitizeStructRegex(s.regex);
      try {
        structRegexes.push({ ...s, re: new RegExp(source, flags) });
      } catch {
        // upstream caught re.error the same way — skip broken patterns
      }
    }
    return structRegexes;
  }

  // --------------------------------------------------------------------------
  // URL PROTECTION — no pass rewrites inside a link (URL_RE from humanize.py)
  // --------------------------------------------------------------------------

  const URL_RE = /(?:https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+)/g;

  function protectUrls(text) {
    const found = [];
    const replaced = text.replace(URL_RE, m => {
      found.push(m);
      return '\x00URL' + (found.length - 1) + '\x00';
    });
    return [replaced, found];
  }

  function restoreUrls(text, found) {
    for (let i = found.length - 1; i >= 0; i--) {
      text = text.replace('\x00URL' + i + '\x00', found[i]);
    }
    return text;
  }

  // --------------------------------------------------------------------------
  // PASS 1 — INVISIBLE: delete or space-normalise what no keyboard produces
  // --------------------------------------------------------------------------

  function escCp(cp) {
    return cp > 0xFFFF
      ? '\\u{' + cp.toString(16) + '}'
      : '\\u' + cp.toString(16).padStart(4, '0');
  }

  /** 'U+200B' → 0x200B ; 'U+E0000-U+E007F' → [0xE0000, 0xE007F] */
  function parseCp(spec) {
    if (spec.includes('-')) {
      const [a, b] = spec.split('-');
      return [parseInt(a.slice(2), 16), parseInt(b.slice(2), 16)];
    }
    return parseInt(spec.slice(2), 16);
  }

  function passInvisible(text, lex) {
    const hits = [];
    for (const entry of lex.invisible || []) {
      const cp = parseCp(entry.cp);
      const pattern = Array.isArray(cp)
        ? new RegExp('[' + escCp(cp[0]) + '-' + escCp(cp[1]) + ']', 'gu')
        : new RegExp(escCp(cp), 'gu');
      const n = (text.match(pattern) || []).length;
      if (!n) continue;
      hits.push({ name: entry.cp + ' ' + entry.name, count: n, action: entry.action });
      text = text.replace(pattern, entry.action === 'delete' ? '' : ' ');
    }
    // Any remaining Cf (format) character is invisible by definition.
    const strayRe = /\p{Cf}/gu;
    const stray = (text.match(strayRe) || []).length;
    if (stray) {
      hits.push({ name: 'other invisible format chars', count: stray, action: 'delete' });
      text = text.replace(strayRe, '');
    }
    return [text, hits];
  }

  // --------------------------------------------------------------------------
  // PASS 2 — TYPOGRAPHIC: em dash → comma etc.
  // --------------------------------------------------------------------------

  function passTypographic(text, lex) {
    const hits = [];
    for (const entry of lex.typographic || []) {
      const ch = entry.from;
      const n = (text.match(new RegExp(escapeRe(ch), 'g')) || []).length;
      if (!n) continue;
      hits.push({ name: ch + ' ' + entry.name, count: n, to: entry.to.trim() || '(space)' });
      if (ch === '—') {
        // " word — word " and "word—word" both collapse to a comma + space.
        text = text.replace(/\s*—\s*/g, ', ');
      } else if (ch === '–') {
        text = text.replace(/\s*–\s*(?=\d)/g, '-');   // 5–10   → 5-10
        text = text.replace(/\s+–\s+/g, ', ');        // used as em dash
        text = text.replace(/–/g, '-');
      } else {
        text = text.split(ch).join(entry.to);
      }
    }
    // A comma inserted before existing punctuation reads wrong.
    text = text.replace(/,\s*([,.;:!?])/g, '$1');
    text = text.replace(/,\s*\n/g, '\n');
    return [text, hits];
  }

  // --------------------------------------------------------------------------
  // PASS 3 — LEXICAL: slop lexicon → plain words, longest terms first
  // --------------------------------------------------------------------------

  function passLexical(text, lex) {
    const hits = [];
    const entries = (lex.phrases || []).concat(lex.words || [])
      .sort((a, b) => b.find.length - a.find.length);
    for (const entry of entries) {
      const re = termRegExp(entry.find);
      const found = text.match(re);
      if (!found || found.length === 0) continue;
      hits.push({
        find: entry.find,
        replace: entry.replace || '(deleted)',
        count: found.length,
        family: entry.family
      });
      text = text.replace(re, m => matchCase(m, entry.replace));
    }
    // Clean up after deletions.
    text = text.replace(/[ \t]{2,}/g, ' ');
    text = text.replace(/^[ \t]*([,.;:])\s*/gm, '');
    text = text.replace(/\s+([,.;:!?])/g, '$1');
    text = text.replace(/^[ \t]+$/gm, '');
    text = text.replace(/\n{3,}/g, '\n\n');
    // An em dash that became a comma before a connective leaves a splice
    // ("is important, also, it's proof") — promote it to a full stop.
    text = text.replace(/,\s*(also|so|still|basically|in the end)\s*,\s*/g,
      (m, g1) => '. ' + g1[0].toUpperCase() + g1.slice(1) + ', ');
    return [text, hits];
  }

  // --------------------------------------------------------------------------
  // STRUCTURAL TELLS — reported, never auto-rewritten
  // --------------------------------------------------------------------------

  function scanStructures(text, lex) {
    const flags = [];
    for (const s of getStructRegexes(lex)) {
      const found = text.match(s.re);
      if (found) flags.push({ id: s.id, name: s.name, count: found.length, fix: s.fix });
    }
    // Sentence-length uniformity is structural too.
    const lens = sentenceLens(text);
    if (lens.length >= 4) {
      const m = mean(lens);
      const cv = m ? pstdev(lens) / m : 0;
      if (cv < 0.35) {
        flags.push({
          id: 'uniform-sentences',
          name: 'Uniform sentence length (variation ' + cv.toFixed(2) + ')',
          count: lens.length,
          fix: 'Break one sentence in half. Let another run long. Machines write even.'
        });
      }
    }
    return flags;
  }

  // --------------------------------------------------------------------------
  // HUMANIZE — the 3 passes, in order
  // --------------------------------------------------------------------------

  function humanize(text) {
    const lex = requireLexicon();
    let urls;
    [text, urls] = protectUrls(text);
    let inv, typo, lexi;
    [text, inv] = passInvisible(text, lex);
    [text, typo] = passTypographic(text, lex);
    [text, lexi] = passLexical(text, lex);
    text = restoreUrls(text, urls);
    text = text.trim();
    return {
      text,
      report: {
        invisible: inv,
        typographic: typo,
        lexical: lexi,
        structures: scanStructures(text, lex)
      }
    };
  }

  // --------------------------------------------------------------------------
  // DETECT — the five-check panel (constants from detect.py)
  // --------------------------------------------------------------------------

  const CONTRACTIONS_RE = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
  const PRONOUNS_RE = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
  const NUMBERS_RE = /\b\d[\d,.]*%?\b|\$\d/g;
  const PROPER_RE = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/gm;
  const BULLET_RE = /^\s*[-*•]\s+(.+)$/gm;
  // "hard space" family counted by check_fingerprint
  const HARD_SPACES = /\u00A0|\u202F|\u2009/g;

  function checkBurstiness(text) {
    const lens = sentenceLens(text);
    if (lens.length < 4) return [50, 'too short to judge'];
    const m = mean(lens);
    const cv = m ? pstdev(lens) / m : 0;
    const score = scale(cv, 0.70, 0.22);
    return [score, 'variation ' + cv.toFixed(2) + ' across ' + lens.length + ' sentences (want 0.55+)'];
  }

  function checkSpecificity(text) {
    const words = wordChars(text);
    if (words.length < 25) return [50, 'too short to judge'];
    const per100 = 100 / words.length;
    const numbers = (text.match(NUMBERS_RE) || []).length;
    const proper = new Set(text.match(PROPER_RE) || []).size;
    const hits = numbers + proper;
    const density = hits * per100;
    const score = scale(density, 6.0, 0.5);
    return [score, hits + ' concrete markers, ' + density.toFixed(1) + ' per 100 words (want 4+)'];
  }

  function checkSlop(text) {
    const words = wordChars(text);
    if (words.length === 0) return [50, 'empty'];
    let hits = 0;
    const found = [];
    for (const entry of (lexicon.words || []).concat(lexicon.phrases || [])) {
      const re = termRegExp(entry.find);
      const matches = text.match(re);
      if (matches) {
        hits += matches.length;
        found.push(entry.find);
      }
    }
    const density = hits * 100 / words.length;
    const score = scale(density, 0.0, 4.0);
    let detail = hits + ' stock terms, ' + density.toFixed(1) + ' per 100 words';
    if (found.length) {
      found.sort();
      detail += ' (' + found.slice(0, 4).join(', ') + (found.length > 4 ? ', ...' : '') + ')';
    }
    return [score, detail];
  }

  function checkFingerprint(text) {
    const invisible = (text.match(/\p{Cf}/gu) || []).length;
    const em = (text.match(/—/g) || []).length;
    const curly = (text.match(/[\u2018\u2019\u201C\u201D]/g) || []).length;
    const ellip = (text.match(/…/g) || []).length;
    const nbsp = (text.match(HARD_SPACES) || []).length;
    const total = invisible * 4 + em * 2 + curly + ellip + nbsp;
    const per1k = total * 1000 / Math.max(charCount(text), 1);
    const score = scale(per1k, 0.0, 12.0);
    const detail = invisible + ' invisible, ' + em + ' em dash, ' + curly +
      ' curly quote, ' + ellip + ' ellipsis, ' + nbsp + ' hard space';
    return [score, detail];
  }

  function checkVoice(text) {
    const words = wordChars(text);
    if (words.length < 25) return [50, 'too short to judge'];
    const per100 = 100 / words.length;
    const contractions = (text.match(CONTRACTIONS_RE) || []).length * per100;
    const person = (text.match(PRONOUNS_RE) || []).length * per100;
    let tells = 0;
    const names = [];
    for (const s of getStructRegexes(lexicon)) {
      const matches = text.match(s.re);
      if (matches) {
        tells += matches.length;
        names.push(s.id);
      }
    }
    const bullets = [];
    for (const m of text.matchAll(BULLET_RE)) {
      bullets.push(m[1].split(/\s+/).filter(Boolean).length);
    }
    const uniform = bullets.length >= 3 && pstdev(bullets) < 1.6;
    let score = scale(contractions, 3.0, 0.0) * 0.35
      + scale(person, 8.0, 1.0) * 0.35
      + clamp(100 - tells * 22) * 0.30;
    if (uniform) {
      score -= 12;
      names.push('uniform-bullets');
    }
    let detail = contractions.toFixed(1) + ' contractions, ' + person.toFixed(1) +
      ' personal pronouns per 100 words, ' + tells + ' structural tell(s)';
    if (names.length) {
      detail += ' [' + names.slice(0, 4).join(', ') + ']';
    }
    return [clamp(score), detail];
  }

  const CHECKS = ['BURSTINESS', 'SPECIFICITY', 'SLOP DENSITY', 'FINGERPRINT', 'VOICE'];

  function detect(text) {
    const lex = requireLexicon();
    const raw = {
      'BURSTINESS': checkBurstiness(text),
      'SPECIFICITY': checkSpecificity(text),
      'SLOP DENSITY': checkSlop(text),
      'FINGERPRINT': checkFingerprint(text),
      'VOICE': checkVoice(text)
    };
    const checks = {};
    for (const name of CHECKS) {
      checks[name] = { score: round1(raw[name][0]), detail: raw[name][1] };
    }
    const scores = CHECKS.map(c => raw[c][0]);
    // The weakest check drags the verdict: a detector only needs one signal.
    const overall = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
    const min = Math.min(...scores);
    const verdict = (overall >= 70 && min >= 55) ? 'PASS'
      : (overall >= 50 ? 'REVIEW' : 'FLAGGED');
    return {
      checks,
      overall: round1(overall),
      verdict,
      weakest: CHECKS.reduce((a, b) => (raw[a][0] < raw[b][0] ? a : b))
    };
  }

  // --------------------------------------------------------------------------
  // HOOK BLOCK — the 21 hook formulas as a prompt fragment
  // --------------------------------------------------------------------------

  function buildHookBlock() {
    if (!hooks) return null;
    const lines = [];
    lines.push('=== HOOK FORMULA LIBRARY — choose exactly ONE for line 1 ===');
    lines.push('Line 1 of a LinkedIn post is the whole game: the feed truncates at roughly');
    lines.push('210 characters on desktop and 140 on mobile before "see more".');
    lines.push('');
    lines.push('Environment rules:');
    (hooks.rules || []).forEach((r, i) => lines.push((i + 1) + '. ' + r));
    lines.push('');
    lines.push('Formulas (pick the one the thread actually supports):');
    for (const h of hooks.hooks || []) {
      lines.push('');
      lines.push('#' + h.id + ' ' + h.name + ' — template: ' + h.template);
      lines.push('   What it is for: ' + h.best_for);
      lines.push('   How it gets ruined: ' + h.trap);
    }
    lines.push('');
    lines.push('Fill the chosen template with SPECIFICS pulled from the Reddit thread');
    lines.push('(numbers, quotes, names). Never mention that a formula was used.');
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // PUBLIC API
  // --------------------------------------------------------------------------

  const api = {
    init,
    loadLexicon,
    loadHooks,
    isReady: () => Boolean(lexicon),
    humanize,
    detect,
    scanStructures,
    buildHookBlock,
    // Exported for tests / parity checks against the Python reference
    _internal: {
      scale, clamp, mean, pstdev, round1, charCount,
      escapeRe, termRegExp, matchCase, sanitizeStructRegex,
      protectUrls, restoreUrls, passInvisible, passTypographic, passLexical,
      checkBurstiness, checkSpecificity, checkSlop, checkFingerprint, checkVoice
    }
  };

  // Ensure exports survive both CommonJS and plain script loading.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.ReddJSONHumanizer = api;
  }

})(typeof globalThis !== 'undefined' ? globalThis : this);
