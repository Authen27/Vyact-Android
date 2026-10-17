#!/usr/bin/env bash
# CI hand-off that does not depend on the Actions *artifact* quota.
#
# A GitHub account shares one small artifact-storage allowance across every repo. Once it is hit,
# actions/upload-artifact fails with "Artifact storage quota has been hit" — and every job that needs
# a file from another job (the APK for the emulator job, the AAB for you) or wants to show
# screenshots breaks, after the expensive part has already run. Release assets are stored
# separately, so each run publishes its files to ONE prerelease tagged ci-<run_id>:
#
#   ci-release.sh put <file>...      upload (creates the release on first use; missing/empty files are skipped)
#   ci-release.sh get <glob> [dir]   download matching assets of THIS run's release (default dir .)
#   ci-release.sh prune [keep]       delete all but the newest <keep> (default 4) ci-* releases + tags
#
# Needs GH_TOKEN and `permissions: contents: write`. Fetch a finished run's files with:
#   gh release download ci-<run_id> --repo <owner/repo> --dir <dir>
set -euo pipefail

TAG="ci-${GITHUB_RUN_ID:?GITHUB_RUN_ID not set}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
cmd="${1:-}"; shift || true

ensure_release() {
  gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && return 0
  # Two jobs can race to create it; whoever loses just finds it already there.
  gh release create "$TAG" --repo "$REPO" --prerelease --target "${GITHUB_SHA:?}" \
    --title "CI run $GITHUB_RUN_ID" \
    --notes "Files from Actions run $GITHUB_RUN_ID (${GITHUB_WORKFLOW:-workflow}). CI hand-off only — safe to delete." >/dev/null 2>&1 \
    || gh release view "$TAG" --repo "$REPO" >/dev/null
}

case "$cmd" in
  put)
    ensure_release
    for f in "$@"; do
      # -s: GitHub rejects a zero-byte asset ("Bad Content-Length"), and a failed adb pull leaves one.
      if [ -s "$f" ]; then gh release upload "$TAG" "$f" --repo "$REPO" --clobber; echo "ci-release: put $f"
      else echo "ci-release: skip (missing or empty) $f"; fi
    done ;;
  get)
    gh release download "$TAG" --repo "$REPO" --pattern "${1:?pattern required}" --dir "${2:-.}" --clobber ;;
  prune)
    keep="${1:-4}"
    gh release list --repo "$REPO" --limit 200 --json tagName,createdAt \
      --jq "[.[] | select(.tagName | startswith(\"ci-\"))] | sort_by(.createdAt) | reverse | .[$keep:] | .[].tagName" \
      | while read -r t; do
          [ -n "$t" ] && [ "$t" != "$TAG" ] && gh release delete "$t" --repo "$REPO" --cleanup-tag --yes && echo "ci-release: pruned $t"
        done || true ;;
  *) echo "usage: ci-release.sh put <file>... | get <glob> [dir] | prune [keep]" >&2; exit 2 ;;
esac
