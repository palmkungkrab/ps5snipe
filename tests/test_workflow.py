"""The GitHub watch workflow: runs must overlap so nobody stops watching between them."""
from pathlib import Path

import yaml

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "watch.yml"
SPACING = 5 * 60          # cron-job.org starts a run every 5 minutes
SLOWEST_STARTUP = 60      # worst measured dispatch -> first Sony check over 24 runs (2026-11-25)


def load():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_runs_check_long_enough_to_overlap():
    # the next run's first check can come SPACING + SLOWEST_STARTUP after this run's first check
    assert int(load()["env"]["RUN_SECONDS"]) >= SPACING + SLOWEST_STARTUP


def test_watch_runs_never_wait_for_each_other():
    conc = load()["concurrency"]
    assert "github.run_id" in conc["group"]  # each watch run is alone in its group
    assert conc["cancel-in-progress"] is False


def test_one_off_tests_keep_a_shared_queue():
    group = load()["concurrency"]["group"]
    assert "inputs.test_sites" in group and "'test'" in group


def test_timeout_leaves_room_for_startup_and_save():
    wf = load()
    assert wf["jobs"]["watch"]["timeout-minutes"] * 60 >= int(wf["env"]["RUN_SECONDS"]) + 120
