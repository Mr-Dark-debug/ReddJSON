# ReddJSON × linkedin-agent-skill integration — design

**Date:** 2026-11-10 · **Branch:** `feature/linkedin-skill-integration` · **Target version:** 2.2.0
**Upstream:** https://github.com/Jakeschincariol/linkedin-agent-skill (MIT) @ `add2c23882fe79180737d242ff80a5da205eda6a`

## Problem

ReddJSON generates LinkedIn posts from Reddit thread JSON via provider chat completions
(OpenRouter / Groq). Output quality problems the upstream skill pack already solved:

- Hooks are written by prompt vibes, not from a tested formula library.
- Generated text ships with the AI fingerprint: em dashes, curly quotes, zero-width
  characters, and stock vocabulary ("delve", "leverage", "seamless", …).
- The user has no signal for how machine-written the draft reads before posting it.

## Decisions (user-approved)

1. **Scope:** vendor **all 11 skills' files** verbatim into the repo; wire up the
   post-writing path (hook formulas) + humanizer (auto-clean, score badge, report).
   Comment/reply/profile/inbox features are future work on top of the vendored files.
2. **Humanizer UX:** automatic on every generated post. Cleaned text is what is saved,
   copied, and shared. Each card gets a human-score badge with a full report view.
   Structural tells are flagged for manual rewrite, never auto-mangled.
3. **Release:** the agent merges its own PR, then tags `v2.2.0` and publishes the
   GitHub release immediately.

## Approach

**A (chosen): pristine vendoring + zero-dependency JS port.** The upstream `.py`
tools cannot run in a Chrome extension. Their logic is ported to one pure-JS module
(`lib/humanizer.js`) that reads the *vendored JSON* at runtime (`slop.json`,
`hooks.json`), so the extension stays zero-dependency / no build step, stays
byte-resync-able with upstream, and is testable in Node.

Rejected: (B) converting data to JS constants at build time — content drifts from
upstream; (C) prompt-only humanizer — scores are hallucinated and invisible
watermark characters survive copy-paste, which is the entire point of `/li-human`.

## Vendored files

`skills/` mirrors upstream verbatim: 11 `SKILL.md` files, `li-human/{slop.json, humanize.py,
detect.py}`, `li-post/hooks.json`, `li-profile/rubric.json`, plus
`templates/voice.md`, upstream `LICENSE` (copied as
`skills/LINKEDIN-AGENT-SKILL-LICENSE`) and a provenance file `skills/VENDORED.md`
(origin, commit hash, what is executed at runtime vs kept for reference).
`.py` files are **not executed** — extensions can't run Python; they are provenance
and the reference implementation for the port, and they run upstream as documented.

## `lib/humanizer.js` — the port

Single file, plain script (loads in the MV3 service worker via `importScripts` and in
the side panel via `<script>`; importable by Node tests via CJS default export).

- `loadLexicon(lex)` / `loadHooks(hooksObj)` — inject data, used by Node tests and `init()`.
- `init()` — fetch + cache `skills/li-human/slop.json` and `skills/li-post/hooks.json`
  via `chrome.runtime.getURL()` (same package, no `web_accessible_resources` needed).
- `humanize(text)` — 3 passes in upstream order:
  1. **INVISIBLE** — delete/normalise per `slop.json` classes (delete → `''`, space → `' '`);
     sweep remaining `\p{Cf}` chars (JS equivalent of `unicodedata.category == 'Cf'`).
  2. **TYPOGRAPHIC** — em dash → `", "` (whitespace-collapsing), en dash → `-` (numeric
     lookahead first), curly quotes → straight, `…` → `...`, prime/middle-dot/bullet/arrow,
     then `,(punct)` and `,\n` cleanups.
  3. **LEXICAL** — longest-first `\b`-anchored case-insensitive replacement (`\s+` for
     spaces within a term, escaped specials) with
     capitalisation preserved, empty replacements deleting the term, followed by the same
     spacing/punctuation cleanups and the ", also," splice promotion.
     URLs are protected via the upstream `https?://\S+|www\.\S+|\S+@\S+\.\S+` placeholder swap.
- `scanStructures(text)` — the 11 `slop.json` structural regexes (sanitised for JS:
  `(?i)inline flag` → `i` flag; Python-style `\U000XXXXX` codepoint escapes decoded) +
  the sentence-length uniformity check (CV < 0.35). Reported, never rewritten.
- `detect(text)` — the five checks with upstream constants:
  BURSTINESS (cv: human 0.70 / machine 0.22), SPECIFICITY (density: 6.0 / 0.5),
  SLOP DENSITY (0.0 / 4.0), FINGERPRINT (per-1k weighted 4/2/1/1/1: 0 / 12),
  VOICE (contractions ×0.35 + pronouns ×0.35 + (100 − 22·tells) ×0.30, uniform-bullet −12;
  thresholds 3.0/0.0, 8.0/1.0). `overall = 0.6·mean + 0.4·min`.
  Verdict: PASS ≥ 70 ∧ min ≥ 55; REVIEW ≥ 50; else FLAGGED. Scores clamped 0–100, ×1dp.

## Generation pipeline (`background.js`)

- New built-in prompt template `hook-engine` ("Hook Engine · /li-post"): user-editable,
  contains a literal `{{HOOK_FORMULAS}}` placeholder that `generation-time` building replaces
  with the 5 hook rules + all 21 formulas (name, template, trap) read from the vendored
  `hooks.json`, plus bans on em dashes / curly quotes / invisible characters / slop terms.
  Default `activePromptId` for fresh installs only; existing users keep their selection.
- Voice profile (`settings.voiceProfile`, free text; sidebar hint pre-fills the question
  list from `templates/voice.md`) is appended to **every** prompt's system message when set.
- `settings.autoHumanize` (default **on**): after the AI response, run `humanize()` →
  `detect()`, store the cleaned text plus `humanScore`, `verdict`, `humanReport`,
  `humanized: true` in the AI-post entry. Applies to both the sidebar request path and the
  `generate-post` keyboard command path. Keyboard toast reports the score.

## UI (`sidebar.html` / `sidebar.js` / `sidebar.css`)

- AI-post card meta row: score badge `74 · REVIEW` (PASS green / REVIEW amber / FLAGGED
  red). Click toggles a report panel: animated per-check bars (modeled on `detect.py`
  stdout), overall score + verdict + weakest-signal hint, slop hits (`find → replace`),
  invisible-char/typography counts, and structural tells with upstream `fix` guidance.
- Settings tab: new "Writing (LinkedIn skill)" section — voice profile textarea,
  `autoHumanize` toggle, save button.
- `sanitizeAIPostItem` (import) extended to carry the new fields. Pre-2.2 entries have no
  score → badge is simply not rendered.

## Docs, version, tests

- `manifest.json` → 2.2.0 (description mention of humanizer). README: feature bullets,
  credits section ("Powered by linkedin-agent-skill by Jake Schincariol — MIT"), version
  badge bump. `ARCHITECTURE.md`: humanize → detect step added to the flow.
- `tests/test-humanizer.js` (`node:test`, project style): invisible char stripping,
  em dash → comma, slop replacement + capitalisation, URL protection, structural tells
  flagged-not-rewritten, verdict math (deliberately slop-heavy draft → FLAGGED,
  cleaned draft → REVIEW-or-better), `{{HOOK_FORMULAS}}` block builds from `hooks.json`.

## Out of scope

- LinkedIn auto-posting (never — upstream design principle; personal-profile posting
  automation also violates LinkedIn's ToS).
- Comments/replies/profile screens on the vendored files.
- Changing the four existing prompt templates' behaviour.

## Release plan

Push branch → PR with notes → self-merge → tag `v2.2.0` on `main` → GitHub release.
