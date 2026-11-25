# Overlapping GitHub watch runs: design (2026-11-25)

## Why
Three Sony Store TH drops on 2026-11-25 (15:01, 15:10, 15:22 Thai) were each gone in under a
minute. GitHub runs are started every 5 min by cron-job.org and check for 240 s. The next run
waits for the previous one to finish, then needs 20–60 s to start up. That leaves 60–110 s with
nobody watching, and the blind spot sits right on every 5-minute mark (2 of the 3 drops were
first seen on the first check after one).

## Goals / non-goals / anti-goals
- **Goal:** at every moment at least one GitHub run is checking Sony and JIB, so Sony is checked
  at least every ~30 s around the clock.
- **Non-goal:** faster polling, changes to the cron-job.org trigger, home PC behaviour,
  de-duplicating pings across runs.
- **Anti-goal:** missing a drop in order to avoid a double ping. Double pings are accepted
  (Palm, 2026-11-25).

## Approaches
- **A. Overlap (picked by Palm):** longer runs, and the next run no longer waits for the
  previous one, so it starts up while the previous one is still checking.
- B. Hour-long runs: one start-up gap per hour and no double pings. Rejected: JIB blocks some
  runner IPs, so one blocked runner would leave JIB unwatched for an hour; still one gap per hour.
- C. Faster start-up only: shrinks the gap but never closes it.

## Design
- `.github/workflows/watch.yml`: `RUN_SECONDS` 240 → 360. Measured over 24 runs: dispatch lands
  8–20 s after the 5-minute mark, and start-up (dispatch → first Sony check) takes 20–60 s.
  Worst case the next run's first check comes ~6 min after the previous run's first check, so
  360 s closes the gap with margin.
- Concurrency: each normal watch run gets its own group (`ps5snipe-watch-<run_id>`), so it
  never waits. One-off test runs keep the shared `ps5snipe-test` group.
- `timeout-minutes: 9` stays (worst case ~7.5 min: 60 s start-up + 360 s + last JIB check + save).
- Workflow comments updated to match.
- Accepted side effects:
  - Two runs watch together for ~1.5 min of every 5; a drop in that window pings twice.
  - A run restores the state saved by the run two back (the one just before it hasn't saved
    yet), so there are two interleaved state chains. Effect: re-notify pings may also double.
  - Sony gets ~12 checks per run, so with `--warn-after 10` a single blocked Sony run posts the
    blocked warning (no @mention; Sony has never been blocked on GitHub). JIB (~6 checks per
    run) needs 2 blocked runs from the same state chain, i.e. runs N and N+2 (amended after
    final review: two back-to-back blocked runs sit on different chains and don't warn).
- Test: `tests/test_workflow.py` reads `watch.yml` and checks the run length, the per-run
  group for watch runs, the shared group for tests, and that the timeout leaves room.

## Verification
After the push: across 3+ consecutive runs, Sony check timestamps show no gap longer than
~35 s, and the Actions list shows runs overlapping.
