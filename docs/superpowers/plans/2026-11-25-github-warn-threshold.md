# GitHub warn threshold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false-alarm "site blocked" Discord warnings from single blocked GitHub runs by letting the workflow raise the warn threshold, and fix the misleading `--headful` hint.

**Architecture:** Two small pure helpers in `ps5snipe/__main__.py` (threshold resolution, blocked-warning text), wired into `main()`. The workflow passes `--warn-after 10`. No state changes: the streak already persists across runs via `state.json`.

**Tech Stack:** Python 3.10+, argparse, pytest, GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-11-25-github-warn-threshold-design.md`

## Global Constraints

- PC default stays `warn_after_failures: 5` (config.yaml unchanged).
- Workflow normal-watch value: `--warn-after 10`; the `test_sites` path is unchanged.
- Blocked warning copy, verbatim: `⚠️ {name} has blocked the checker {fails} checks in a row ({e}). It is NOT being watched right now. Usually the server's IP is on the site's blocklist, which clears when the IP changes. If it keeps happening, run ps5snipe from a home connection.`
- The generic error warning text (`check has failed ... times in a row`) is unchanged; it only picks up the new threshold.
- Work on branch `warn-after`; nothing reaches the scheduled watcher until merged to `main`.

## Review Focus

1. `--warn-after 0` or negative: with the `fails == warn_after` check, the warning would silently never fire. Expected: argparse rejects values < 1 with a clear error (test in Task 1).
2. No flag and no `warn_after_failures` in config: expected default 5 (test in Task 1).
3. Flag given alongside a config value: the flag wins (test in Task 1).
4. `--warn-after 10` accidentally added to the `test_sites` branch of watch.yml: expected only in the `else` (normal watch) line (grep check in Task 1).
5. Blocked message must still carry the error detail (URL + HTTP status) and the streak count (test in Task 2).

---

### Task 1: `--warn-after` override + workflow + README

**Files:**
- Modify: `ps5snipe/__main__.py` (argparse block ~line 54-64; `warn_after = ...` ~line 100)
- Modify: `.github/workflows/watch.yml` (normal-watch `eval python -m ps5snipe ...` line)
- Modify: `README.md` (GitHub Actions section + config reference table)
- Test: `tests/test_logic.py`
- Also commit: the spec and this plan under `docs/superpowers/`

**Interfaces:**
- Produces: `resolve_warn_after(cfg: dict, override: int | None) -> int` in `ps5snipe/__main__.py`; `positive_int(value: str) -> int` argparse type in the same file.

- [ ] **Step 1: Create the branch and commit the docs**

```bash
git checkout -b warn-after
git add docs/superpowers
git commit -m "docs: spec + plan for GitHub warn threshold"
```

- [ ] **Step 2: Write the failing tests** (append to `tests/test_logic.py`; add `import pytest` and import `resolve_warn_after`, `main` from `ps5snipe.__main__`)

```python
def test_resolve_warn_after():
    assert resolve_warn_after({}, None) == 5
    assert resolve_warn_after({"warn_after_failures": 7}, None) == 7
    assert resolve_warn_after({"warn_after_failures": 7}, 10) == 10


def test_warn_after_rejects_non_positive():
    for bad in ("0", "-3"):
        with pytest.raises(SystemExit):
            main(["--warn-after", bad, "--test-notify"])
```

- [ ] **Step 3: Run to verify they fail**

Run: `python -m pytest tests/test_logic.py -q`
Expected: FAIL / collection error: `cannot import name 'resolve_warn_after'`

- [ ] **Step 4: Implement**

Add `positive_int` (raise `argparse.ArgumentTypeError("must be 1 or more")` for < 1) and `resolve_warn_after` (override if not None, else `int(cfg.get("warn_after_failures", 5))`). Add `ap.add_argument("--warn-after", type=positive_int, help="warn on Discord after N failures in a row (overrides warn_after_failures)")`. Replace the `warn_after = int(cfg.get(...))` line with `warn_after = resolve_warn_after(cfg, args.warn_after)`.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: `8 passed`

- [ ] **Step 6: Workflow + README**

In watch.yml change the normal-watch line to `eval python -m ps5snipe $SITES --duration "$RUN_SECONDS" --no-start-message --warn-after 10`. README: add `--warn-after` to the Run docs / config table, and one line in the GitHub Actions section explaining that the workflow uses 10 because a single run can land on a blocked IP and the next run usually clears it.

Verify: `grep -n "warn-after" .github/workflows/watch.yml` → exactly one hit, on the `eval python -m ps5snipe $SITES` line.

- [ ] **Step 7: Commit**

```bash
git add ps5snipe/__main__.py tests/test_logic.py .github/workflows/watch.yml README.md
git commit -m "feat: --warn-after override; workflow warns only after ~2 blocked runs"
```

### Task 2: Blocked-warning text

**Files:**
- Modify: `ps5snipe/__main__.py` (the `except SiteBlocked` branch in `run_site`)
- Test: `tests/test_logic.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `blocked_warning(name: str, error: object, fails: int) -> str` in `ps5snipe/__main__.py`.

- [ ] **Step 1: Write the failing test**

```python
def test_blocked_warning_text():
    err = "bot protection on https://www.jib.co.th/x (HTTP 403)"
    msg = blocked_warning("JIB", err, 10)
    assert msg.startswith("⚠️ JIB has blocked the checker 10 checks in a row (")
    assert err in msg
    assert "NOT being watched" in msg
    assert "home connection" in msg
    assert "--headful" not in msg
```

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/test_logic.py -q`
Expected: FAIL: `cannot import name 'blocked_warning'`

- [ ] **Step 3: Implement `blocked_warning`** returning the Global Constraints copy verbatim with `{e}` = `error`; make the `except SiteBlocked` branch post `discord.info(blocked_warning(name, e, fails))`.

- [ ] **Step 4: Run the full suite**

Run: `python -m pytest -q`
Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add ps5snipe/__main__.py tests/test_logic.py
git commit -m "fix: blocked warning explains IP blocks instead of suggesting --headful"
```
