# Overlapping GitHub Watch Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 60–110 s blind gap between GitHub watch runs by letting runs overlap.

**Architecture:** Workflow-only change. Each watch run checks for 360 s and sits in its own
concurrency group, so the next run starts up while the previous one is still checking.

**Tech Stack:** GitHub Actions YAML, pytest + PyYAML (already in requirements.txt).

**Spec:** `docs/superpowers/specs/2026-11-25-github-run-overlap-design.md`

## Global Constraints
- `RUN_SECONDS` = `"360"` (string, as GitHub env values are).
- Watch runs: concurrency group unique per run (`ps5snipe-watch-<run_id>`). Test runs: `ps5snipe-test`.
- `timeout-minutes: 9` unchanged; `cancel-in-progress: false` unchanged.
- No Python code changes; `--warn-after 10` unchanged.

## Review Focus
- Run started by cron-job.org with no inputs → must land in a per-run group, not `test`.
  (Expression keeps the existing `inputs.test_sites != ''` test, which already treats a missing
  input as empty.)
- One-off test run → must still queue in the shared `test` group, never in a per-run group.
- Slow start-up (60 s) + 360 s + final JIB check + cache save → must stay under the 9 min timeout.
- Someone later lowering `RUN_SECONDS` below the 5-min spacing + start-up → test must fail.
- YAML `on:` parses as `True` in PyYAML → test must not depend on the `on` key.

---

### Task 1: Overlapping watch runs

**Files:**
- Create: `tests/test_workflow.py`
- Modify: `.github/workflows/watch.yml` (header comments lines 3–4, concurrency block lines 15–19,
  `RUN_SECONDS` line 22)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing used by other code.

- [ ] **Step 1: Write the failing tests** in `tests/test_workflow.py`, loading
  `.github/workflows/watch.yml` with `yaml.safe_load` (path relative to the test file):
  - `test_runs_check_long_enough_to_overlap`: `int(wf["env"]["RUN_SECONDS"]) >= 5 * 60 + 60`
    (5-min spacing + worst measured 60 s start-up).
  - `test_watch_runs_never_wait_for_each_other`: group string contains `github.run_id`;
    `wf["concurrency"]["cancel-in-progress"] is False`.
  - `test_one_off_tests_keep_a_shared_queue`: group string contains `'test'` and
    `inputs.test_sites`.
  - `test_timeout_leaves_room_for_startup_and_save`:
    `wf["jobs"]["watch"]["timeout-minutes"] * 60 >= RUN_SECONDS + 120`.

- [ ] **Step 2: Run to verify they fail**
  Run: `.venv/Scripts/python -m pytest tests/test_workflow.py -v`
  Expected: `test_runs_check_long_enough_to_overlap` and
  `test_watch_runs_never_wait_for_each_other` FAIL; the other two PASS (they guard behaviour
  that must survive the change).

- [ ] **Step 3: Edit `watch.yml`**
  - `RUN_SECONDS: "360"`.
  - Concurrency group:
    `ps5snipe-${{ inputs.test_sites != '' && 'test' || format('watch-{0}', github.run_id) }}`.
  - Comments: header says runs overlap so there's no gap; concurrency comment says watch runs
    overlap on purpose (no blind gap, a drop may ping twice) and tests share one queue.

- [ ] **Step 4: Run the full suite**
  Run: `.venv/Scripts/python -m pytest -q`
  Expected: all pass (15 existing + 4 new).

- [ ] **Step 5: Commit and push**
  `git add .github/workflows/watch.yml tests/test_workflow.py docs/superpowers` then commit
  `feat: GitHub watch runs overlap so there's no blind gap between them`, push to `main`.

- [ ] **Step 6: Verify on GitHub**
  Wait for 3+ runs on the new commit to complete. For each, collect the Sony check timestamps
  (`gh run view <id> --log | grep "Sony Store TH: "`), merge them in time order, and report
  the largest gap. Expected: ≤ ~35 s, and in the run list the runs overlap in time.
