#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <PHONE_E164> [TIMEZONE]"
  echo "Example: $0 +14155551234 America/New_York"
  exit 1
fi

PHONE_E164="$1"
TIMEZONE="${2:-America/New_York}"

API_BASE_URL="${API_BASE_URL:-https://api-production-8bf7.up.railway.app/v1}"
TOOL_API_KEY="${TOOL_API_KEY:-}"

if [[ -z "${TOOL_API_KEY}" ]]; then
  echo "Missing TOOL_API_KEY env var."
  echo "Example: TOOL_API_KEY=... $0 +14155551234"
  exit 1
fi

TS="$(date +%s)"
EMAIL="live-call-${TS}@goalcoach.dev"
PASSWORD="TestPass123!"
NAME="Live Call User"

register_payload="$(cat <<JSON
{
  "email": "${EMAIL}",
  "password": "${PASSWORD}",
  "name": "${NAME}",
  "timezone": "${TIMEZONE}",
  "phone_e164": "${PHONE_E164}",
  "consent_flags": {
    "calls_opt_in": true,
    "transcription_opt_in": true,
    "storage_opt_in": true
  }
}
JSON
)"

register_resp="$(
  curl -sS -X POST "${API_BASE_URL}/auth/register" \
    -H "Content-Type: application/json" \
    -d "${register_payload}"
)"

access_token="$(echo "${register_resp}" | jq -r '.access_token')"
user_id="$(echo "${register_resp}" | jq -r '.user.id')"

if [[ "${access_token}" == "null" || -z "${access_token}" ]]; then
  echo "Failed to register user:"
  echo "${register_resp}" | jq .
  exit 1
fi

curl -sS -X POST "${API_BASE_URL}/auth/verify-phone" \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -d "{\"phone_e164\":\"${PHONE_E164}\",\"otp_code\":\"1234\"}" >/dev/null

goal_resp="$(
  curl -sS -X POST "${API_BASE_URL}/goals" \
    -H "Authorization: Bearer ${access_token}" \
    -H "Content-Type: application/json" \
    -d '{
      "statement":"Build GoalCoach",
      "motivation":"Validate live coaching calls",
      "constraints":"None",
      "target_date":"2026-06-01"
    }'
)"
goal_id="$(echo "${goal_resp}" | jq -r '.id')"

curl -sS -X POST "${API_BASE_URL}/habits" \
  -H "Authorization: Bearer ${access_token}" \
  -H "Content-Type: application/json" \
  -d "{
    \"goal_id\":\"${goal_id}\",
    \"title\":\"Daily planning check-in\",
    \"frequency\":{\"type\":\"daily\"},
    \"measurement\":{\"unit\":\"boolean\"},
    \"difficulty_1_to_10\":3,
    \"default_time_window\":{\"start_local\":\"08:00\",\"end_local\":\"10:00\"},
    \"active\":true
  }" >/dev/null

scheduled_at_utc="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
reschedule_resp="$(
  curl -sS -X POST "${API_BASE_URL}/tools/reschedule" \
    -H "x-tool-api-key: ${TOOL_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{
      \"user_id\":\"${user_id}\",
      \"scheduled_at_utc\":\"${scheduled_at_utc}\",
      \"reason\":\"live_test\"
    }"
)"

checkin_event_id="$(echo "${reschedule_resp}" | jq -r '.checkin_event_id')"

echo "Live call test queued."
echo "user_id=${user_id}"
echo "checkin_event_id=${checkin_event_id}"
echo "phone=${PHONE_E164}"
