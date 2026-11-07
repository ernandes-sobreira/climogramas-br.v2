#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
TARGET="${1:-$(git rev-parse HEAD)}"
if [[ ! "$TARGET" =~ ^[0-9a-f]{40}$ ]]; then echo 'Invalid commit SHA'; exit 2; fi
TMPDIR_BUILD=$(mktemp -d)
trap 'rm -rf "$TMPDIR_BUILD"' EXIT
# GitHub REST documents GitHub App installation tokens + Pages(write).
gh api --method POST "repos/$GITHUB_REPOSITORY/pages/builds" > "$TMPDIR_BUILD/request.json"
for attempt in $(seq 1 24); do
  gh api "repos/$GITHUB_REPOSITORY/pages/builds/latest" > "$TMPDIR_BUILD/build.json"
  read -r STATE COMMIT < <(python -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('status','unknown'),d.get('commit','unknown'))" "$TMPDIR_BUILD/build.json")
  if [ "$STATE" = 'built' ] && [ "$COMMIT" = "$TARGET" ]; then
    echo "Pages confirmou o commit $TARGET";exit 0
  fi
  if [ "$STATE" = 'errored' ] && [ "$COMMIT" = "$TARGET" ]; then
    echo "Dados preservados no Git; Pages falhou para $TARGET";exit 1
  fi
  sleep 15
done
echo 'Dados preservados no Git, mas publicação Pages não confirmada no prazo.'
exit 1
