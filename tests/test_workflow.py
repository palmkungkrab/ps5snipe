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


def test_watch_runs_get_their_own_group_and_tests_share_one():
    # Pinned exactly: flipping != or swapping the branches would put watch runs back in one
    # shared queue (blind gap returns) and still contain all the same words.
    # cron-job.org / schedule runs have no test_sites input; GitHub compares loosely, so a
    # missing input equals '' -> per-run group. A one-off test ("Powerbuy") -> shared 'test'.
    group = load()["concurrency"]["group"]
    assert group == "ps5snipe-${{ inputs.test_sites != '' && 'test' || format('watch-{0}', github.run_id) }}"


def test_running_watch_runs_are_never_cancelled():
    assert load()["concurrency"]["cancel-in-progress"] is False


def test_timeout_leaves_room_for_startup_and_save():
    wf = load()
    assert wf["jobs"]["watch"]["timeout-minutes"] * 60 >= int(wf["env"]["RUN_SECONDS"]) + 120
