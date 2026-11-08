#!/usr/bin/env bash
# Post-deploy smoke test.
#   scripts/smoke.sh https://vqm-api.onrender.com https://video-quality-monitor.pages.dev
# Creates one short test session (it will appear in History). Needs curl and python3.
set -uo pipefail

API="${1:?usage: smoke.sh API_URL FRONTEND_URL}"
FRONTEND="${2:?usage: smoke.sh API_URL FRONTEND_URL}"
API="${API%/}"
FRONTEND="${FRONTEND%/}"
failures=0

check() { # check "description" condition-exit-code
  if [ "$2" -eq 0 ]; then printf '  PASS  %s\n' "$1"; else printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); fi
}
json() { python3 -c "import sys, json; d = json.load(sys.stdin); print($1)"; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
post() { curl -s -H 'Content-Type: application/json' -d "$2" "$API$1"; }

sample() { # sample T [verdict reason]
  printf '{"t":%s,"fps":29.6,"brightness":132.4,"motion":1.1,"face":true,"verdict":"%s","reason":%s}' \
    "$1" "${2:-good}" "${3:-null}"
}

echo "Backend: $API (first request may take up to a minute while a sleeping free instance wakes)"
code=$(status --max-time 90 "$API/healthz"); check "GET /healthz -> 200 (got $code)" "$([ "$code" = 200 ]; echo $?)"
cfg=$(curl -s "$API/config")
check "GET /config exposes thresholds: $cfg" "$(echo "$cfg" | json 'd["thresholds"]["max_motion"]' >/dev/null 2>&1; echo $?)"

id=$(curl -s -X POST "$API/sessions" | json 'd["id"]')
check "POST /sessions -> id $id" "$([ -n "$id" ]; echo $?)"

r=$(post "/sessions/$id/samples" "{\"samples\":[$(sample 1),$(sample 2 poor '"too_dark"')]}")
check "POST samples -> $r" "$([ "$(echo "$r" | json 'd["accepted"]')" = 2 ]; echo $?)"
r=$(post "/sessions/$id/samples" "{\"samples\":[$(sample 1),$(sample 2 poor '"too_dark"')]}")
check "resend same batch -> no duplicates stored: $r" "$([ "$(echo "$r" | json 'd["duplicates"]')" = 2 ]; echo $?)"

code=$(status -H 'Content-Type: application/json' -d "{\"samples\":[{\"t\":3,\"fps\":500}]}" "$API/sessions/$id/samples")
check "invalid sample -> 422 (got $code)" "$([ "$code" = 422 ]; echo $?)"

first=$(curl -s -X POST "$API/sessions/$id/stop" | json 'd["ended_at"]')
second=$(curl -s -X POST "$API/sessions/$id/stop" | json 'd["ended_at"]')
check "stop twice -> same ended_at ($first)" "$([ -n "$first" ] && [ "$first" = "$second" ]; echo $?)"

r=$(post "/sessions/$id/samples" "{\"samples\":[$(sample 3)]}")
check "sample after stop -> ignored, not stored: $r" "$([ "$(echo "$r" | json 'd["ignored_after_stop"]')" = 1 ]; echo $?)"

summary=$(curl -s "$API/sessions/$id" | json 'd["summary"]')
check "GET session summary: $summary" "$(curl -s "$API/sessions/$id" | json 'd["summary"]["duration_s"] == 2 and len(d["samples"]) == 2' | grep -q True; echo $?)"
listed=$(curl -s "$API/sessions?limit=1" | json 'd["items"][0]["id"]')
check "GET /sessions lists it first (newest first)" "$([ "$listed" = "$id" ]; echo $?)"
code=$(status "$API/sessions/00000000-0000-4000-8000-000000000000")
check "unknown session -> 404 (got $code)" "$([ "$code" = 404 ]; echo $?)"

preflight() {
  curl -s -o /dev/null -D - -X OPTIONS -H "Origin: $1" -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type' "$API/sessions" |
    tr -d '\r' | awk -F': ' 'tolower($1) == "access-control-allow-origin" {print $2}'
}
acao=$(preflight "$FRONTEND")
check "CORS allows $FRONTEND (got '${acao}')" "$([ "$acao" = "$FRONTEND" ]; echo $?)"
acao=$(preflight "https://evil.example")
check "CORS refuses https://evil.example (got '${acao}')" "$([ -z "$acao" ]; echo $?)"

echo "Frontend: $FRONTEND"
check "page loads" "$(curl -s "$FRONTEND/" | grep -q '<title>Video Quality Monitor</title>'; echo $?)"
code=$(status "$FRONTEND/models/blaze_face_short_range.tflite")
check "face model self-hosted -> 200 (got $code)" "$([ "$code" = 200 ]; echo $?)"
ctype=$(curl -s -o /dev/null -w '%{content_type}' "$FRONTEND/mediapipe/wasm/vision_wasm_internal.wasm")
check "MediaPipe wasm self-hosted as application/wasm (got $ctype)" "$([ "$ctype" = application/wasm ]; echo $?)"

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; fi
exit "$failures"
