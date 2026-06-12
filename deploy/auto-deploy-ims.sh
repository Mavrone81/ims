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

# 1b) Gate on CI: only deploy a commit whose GitHub checks have passed. -------
#     NON-BLOCKING: one API call per cron run. If CI is still running we exit 0
#     and let the next minute's run retry — this keeps us well under GitHub's
#     unauthenticated 60-requests/hour limit (a busy-wait here exhausted it).
#     Uses only the check-runs API (where GitHub Actions reports); no token
#     needed for a public repo. Never deploys on failure or while pending.
REPO_SLUG=Mavrone81/ims
runs=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
       "https://api.github.com/repos/$REPO_SLUG/commits/$REMOTE/check-runs" 2>/dev/null)
total=$(printf '%s' "$runs" | grep -c '"conclusion"')
fail=$(printf '%s' "$runs" | grep -oE '"conclusion": *"(failure|cancelled|timed_out|action_required|stale)"' | wc -l | tr -d ' ')
pending=$(printf '%s' "$runs" | grep -oE '"status": *"(queued|in_progress|pending)"' | wc -l | tr -d ' ')

if [ "$fail" -gt 0 ]; then
  echo "$(ts) $TAG CI FAILED for ${REMOTE:0:7} — not deploying"; exit 1
fi
if [ -z "$runs" ] || [ "$total" -eq 0 ] || [ "$pending" -gt 0 ]; then
  echo "$(ts) $TAG CI not green yet for ${REMOTE:0:7} (total=$total pending=$pending) — will retry next run"; exit 0
fi
echo "$(ts) $TAG CI passed for ${REMOTE:0:7} ($total checks) — deploying"

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
