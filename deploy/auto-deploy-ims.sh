#!/usr/bin/env bash
#
# auto-deploy-ims.sh — server-side pull deploy for IMS (ims.urbanwerkzsg.com).
# Compose project: ims  (/root/ims/docker-compose.prod.yml, services db/api/web)
#
# Runs every minute from root's crontab under flock. If origin/main has a new
# commit, fast-forwards the working tree and rebuilds ONLY this app's api/web
# containers. Other compose projects on this shared host (newhrms,
# housecharging-server, urbanwerkz, web, website, mandamix, bf, enshrine) are
# never touched: every docker command is pinned to THIS compose file, which
# scopes it to the `ims` project.
#
# Persistent state is safe:
#   * .env (DB password, JWT secrets) is git-ignored, so `git reset --hard`
#     never overwrites it.
#   * The database lives in the named volume ims_pgdata; `up -d --build` never
#     touches volumes. The db service uses a registry image and is never rebuilt.
# This script never runs `compose down`, `down -v`, or `volume rm`.
#
# Canonical copy lives in the repo at deploy/auto-deploy-ims.sh; the installed
# copy is /root/auto-deploy-ims.sh (re-copy manually if you change it).
#
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

REPO=/root/ims
COMPOSE_FILE="$REPO/docker-compose.prod.yml"
SERVICES="api web"
BRANCH=main
TAG="[ims-deploy]"
ts() { date '+%F %T'; }

cd "$REPO" || { echo "$(ts) $TAG ERROR: cannot cd $REPO"; exit 1; }

# 1) Fetch and compare --------------------------------------------------------
if ! git fetch --quiet origin "$BRANCH"; then
  echo "$(ts) $TAG ERROR: git fetch failed"; exit 1
fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0   # up to date — stay quiet (runs every minute)

echo "$(ts) $TAG new commit ${LOCAL:0:7} -> ${REMOTE:0:7}"
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
echo "$(ts) $TAG changed files:"; printf '%s\n' "$CHANGED" | sed 's/^/    /'

# 1b) Gate on CI via a marker ref — NOT the REST API. -------------------------
#     CI pushes refs/ci-pass/<sha> on success (.github/workflows/ci.yml). We
#     query that ONE specific ref over the git protocol, which is not subject
#     to GitHub's REST rate limit at all (the previous REST-based gate kept
#     exhausting the 60-req/hour unauthenticated quota). Public repo → the
#     read needs no credentials. Never deploys until the marker for the exact
#     target commit exists; CI failure simply means no marker, so we wait.
if git ls-remote origin "refs/ci-pass/$REMOTE" 2>/dev/null | grep -q "$REMOTE"; then
  echo "$(ts) $TAG CI-pass marker present for ${REMOTE:0:7} — deploying"
else
  echo "$(ts) $TAG no CI-pass marker for ${REMOTE:0:7} yet — will retry next run"; exit 0
fi

# 2) Advance code (code only; .env is git-ignored and survives) ---------------
git reset --hard "$REMOTE"

# 3) Rebuild + restart, scoped to the `ims` compose project -------------------
#    Recreates only api/web when their images change; db keeps running and
#    ims_pgdata is untouched. Migrations run on api boot (idempotent).
# shellcheck disable=SC2086
docker compose -f "$COMPOSE_FILE" up -d --build $SERVICES
RC=$?
[ "$RC" -ne 0 ] && echo "$(ts) $TAG ERROR: rebuild exited rc=$RC (old containers kept running)"

# 4) Disk hygiene: drop dangling images only ----------------------------------
docker image prune -f >/dev/null 2>&1

echo "$(ts) $TAG done rc=$RC, now at $(git rev-parse --short HEAD)"
exit "$RC"
