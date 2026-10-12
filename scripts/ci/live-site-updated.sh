#!/usr/bin/env bash
# Did this commit reach the live site? Run by .github/workflows/live-site.yml
# after every merge into main (Adam, 12 Oct 2026).
#
# WHY. #36 was merged and the live site never got it: Vercel didn't start a
# build at all, so nothing failed and nobody was told. A merge Claude does is
# checked by hand afterwards; this covers the rest.
#
# HOW. When Vercel finishes a live build it records a "Production" deployment
# for that commit on GitHub, marked success or failure. This waits for one
# marked success. Vercel's commit status ("Vercel" next to the commit) is not
# used: a later preview build of the same commit overwrites it, as happened
# to #34's, which shows a failure although its live build succeeded.
#
# Usage: live-site-updated.sh <owner/repo> <commit sha> [minutes to wait]
# Needs GITHUB_TOKEN (deployments: read) on GitHub; curl and jq.

set -euo pipefail

repo="$1"
sha="$2"
minutes="${3:-15}"
api="https://api.github.com/repos/$repo"
auth=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then auth=(-H "Authorization: Bearer $GITHUB_TOKEN"); fi

get() { curl -fsS "${auth[@]}" -H "Accept: application/vnd.github+json" "$api/$1"; }

# The newest state of each live build of this commit: "success", "failure",
# "error", "in_progress", ... One per line, empty when there is none yet.
# Fails if GitHub doesn't answer.
live_states() {
  local list id statuses
  list="$(get "deployments?sha=$sha&environment=Production&per_page=20")" || return 1
  for id in $(jq -r '.[].id' <<<"$list"); do
    statuses="$(get "deployments/$id/statuses?per_page=1")" || return 1
    jq -r '.[0].state // "pending"' <<<"$statuses"
  done
}

deadline=$(( $(date +%s) + minutes * 60 ))
states=""
answered=0
while :; do
  # GitHub not answering for a moment is not a reason to raise the alarm:
  # keep asking until the time is up.
  if now="$(live_states)"; then answered=1; states="$now"; fi
  if grep -qx success <<<"$states"; then
    echo "The live site has this change (${sha:0:7})."
    exit 0
  fi
  (( $(date +%s) >= deadline )) && break
  sleep 30
done

short="${sha:0:7}"
if (( !answered )); then
  echo "::error title=Live site not checked::Couldn't check whether the live site has this change ($short): GitHub didn't answer for $minutes minutes. Re-run this check from the Actions tab."
  exit 1
fi
if [[ -z "$states" ]]; then
  why="Vercel never started a live build of it."
else
  why="Vercel's live build of it did not finish (last seen: $(tr '\n' ' ' <<<"$states" | sed 's/ $//'))."
fi
echo "::error title=Live site not updated::The live site does not have this change ($short) after $minutes minutes. $why In Vercel, open realcomply-app, Deployments, and redeploy the latest one from main, or ask Claude to."
exit 1
