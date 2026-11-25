# Smarter "site blocked" warning on GitHub Actions: design (2026-11-25)

## Why
JIB sometimes blocks a single GitHub Actions run with HTTP 403. The cause is the runner's IP:
each run gets a fresh Azure machine, and some of those IPs are on JIB's Cloudflare blocklist.
Evidence from all 63 runs to date: 57 JIB-OK, 4 blocked for the whole run, 0 mixed, and no
two blocked runs back-to-back. One blocked run makes 4–5 JIB checks, so the current
threshold (`warn_after_failures: 5`) posts a Discord warning for a block that clears by
itself on the next run. That's a false alarm. `--headful` would not help: the browser
fingerprint is identical in OK and blocked runs, and the 403 arrives on the first response.

## Goals / non-goals / anti-goals
- **Goal:** GitHub runs warn only when a site stays blocked for about 2+ runs in a row.
- **Goal:** the blocked warning stops pointing at `--headful` as the fix for an IP block.
- **Non-goal:** changing PC behaviour (stays at 5), time-based logic, a recovery
  ("all clear") message, proxies, check intervals.
- **Anti-goal:** a lasting block must still warn.

## Approaches
- **A. Per-run override `--warn-after N`, set to 10 in the workflow (picked).** Tiny change,
  fits the data (would have silenced both false alarms so far), PC keeps 5.
- B. Time-based: warn after 15 min of continuous failure. Rejected: gaps between runs (e.g.
  paused cron) count as failing time and cause false alarms unless also gated by a check count.
  More code for little gain.

## Design
- `__main__.py`: new `--warn-after N` (int). When given, it overrides `warn_after_failures`
  from `config.yaml`. It applies to both warning paths (blocked and generic error).
- `.github/workflows/watch.yml`: the normal watch command gets `--warn-after 10`. The
  `test_sites` one-off path is unchanged.
- No state changes needed: the failure streak already carries over between runs
  (`state.save()` runs in `main()`'s `finally`, and the workflow caches `state.json`).
- Blocked warning text becomes:
  `⚠️ {name} has blocked the checker {fails} checks in a row ({e}). It is NOT being watched
  right now. Usually the server's IP is on the site's blocklist, which clears when the IP
  changes. If it keeps happening, run ps5snipe from a home connection.`
- Known side effect: Sony on GitHub (30s interval) would warn after about 5 min of failure
  instead of about 2.5. Acceptable: Sony has never failed so far.
- README: document `--warn-after` and why the workflow uses 10.

## Tests
Unit tests for the threshold resolution (flag overrides config, config otherwise) and for the
blocked message (no `--headful`, includes the streak count). Exact helper factoring is the
builder's call.
