# Vendored: linkedin-agent-skill

This directory contains a **verbatim copy** of the skills from:

> https://github.com/Jakeschincariol/linkedin-agent-skill
> The LinkedIn agent skill — Eleven free Claude skills that run a LinkedIn account: posts off 21 hook formulas, comments, replies, profile score, weekly plan, and a humanizer that strips the AI fingerprint and scores the draft before it goes out.
> © Jake Schincariol — [opusjake.ai](https://opusjake.ai)
> **License:** MIT (see [`LINKEDIN-AGENT-SKILL-LICENSE`](./LINKEDIN-AGENT-SKILL-LICENSE))

**Pinned upstream commit:** `add2c23882fe79180737d242ff80a5da205eda6a`

## Files & role in ReddJSON

| Path | Role |
| --- | --- |
| `li-human/slop.json` | **Executed at runtime.** Lexicon for the humanizer: 113 stock terms, 17 invisible-character classes, 11 structural-tell regexes. Read by `lib/humanizer.js`. |
| `li-post/hooks.json` | **Executed at runtime.** The 21 hook formulas + rules; injected into the `hook-engine` prompt template at generation time. |
| `li-human/humanize.py` | Reference implementation (ported to JS — extensions cannot run Python). |
| `li-human/detect.py` | Reference implementation of the five-check panel (ported to JS). |
| `li-profile/rubric.json` | Data for a future profile-scoring feature (not wired up yet). |
| `li-*/SKILL.md` (all 11) | Skill instructions, vendored for reference and future features (comments, replies, plan, carousel, repurpose, DM, inbox, audit). Not wired up yet. |
| `../templates/voice.md` | The voice-profile questionnaire ReddJSON's Writing settings section is modeled on. |

## Resyncing with upstream

```bash
git remote add upstream https://github.com/Jakeschincariol/linkedin-agent-skill   # once
git fetch upstream main --depth 1
git checkout upstream/main -- skills templates
# then update the pinned commit hash in this file and re-verify the JS port
# against the .py reference (see tests/test-humanizer.js)
```

`SKILL.md` files and the Python tools are kept unmodified so the diff stays trivial.
