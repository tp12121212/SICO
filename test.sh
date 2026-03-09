#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001/api/capsule}"
STATUS_BASE_URL="${STATUS_BASE_URL:-http://localhost:3001/api/status}"
TOKEN="${TOKEN:-test-token}"
CAPSULE_ID="${CAPSULE_ID:-test1}"
POLICY_NAME="${POLICY_NAME:-TestPolicy}"
SIT_NAME="${SIT_NAME:-TestSIT}"
REGEX_PATTERN="${REGEX_PATTERN:-\\d{4}}"
SHOW_STATUS="${SHOW_STATUS:-true}"

issued_at="2026-03-07T00:00:00.000Z"
expires_at="2026-03-07T00:10:00.000Z"

payload=$(
  CAPSULE_ID="${CAPSULE_ID}" \
  POLICY_NAME="${POLICY_NAME}" \
  SIT_NAME="${SIT_NAME}" \
  REGEX_PATTERN="${REGEX_PATTERN}" \
  ISSUED_AT="${issued_at}" \
  EXPIRES_AT="${expires_at}" \
  node -e '
const payload = {
  capsuleId: process.env.CAPSULE_ID,
  tenant: "your-tenant.onmicrosoft.com",
  userId: "user@your-tenant.com",
  action: "CreateDLPPolicy",
  params: {
    name: process.env.POLICY_NAME,
    conditions: {
      sitName: process.env.SIT_NAME,
      regexPattern: process.env.REGEX_PATTERN
    }
  },
  issuedAt: process.env.ISSUED_AT,
  expiresAt: process.env.EXPIRES_AT,
  signature: `dummy-signature:${process.env.CAPSULE_ID}`
};
process.stdout.write(JSON.stringify(payload));
'
)

echo "Posting capsule to ${API_URL}"

response_file="$(mktemp)"
http_code=$(curl -sS -o "${response_file}" -w "%{http_code}" -X POST "${API_URL}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${payload}")

if [[ "${http_code}" != "200" ]]; then
  echo "Request failed with HTTP ${http_code}"
  cat "${response_file}"
  rm -f "${response_file}"
  exit 1
fi

response_json="$(cat "${response_file}")"
rm -f "${response_file}"

summary=$(printf '%s' "${response_json}" | node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(0, "utf8"));
const capsuleId = data.capsuleId || "unknown";
const action = "CreateDLPPolicy";
const workerStatus = data.workerResult?.status || "unknown";
const policyName = data.workerResult?.policyName || "unknown";
console.log(`Capsule ID: ${capsuleId}, Action: ${action}`);
console.log(`Worker Result: status=${workerStatus}, policyName=${policyName}`);
')

echo "${summary}"
echo "API Response: ${response_json}"

if [[ "${SHOW_STATUS}" == "true" ]]; then
  status_response=$(curl -sS "${STATUS_BASE_URL}/${CAPSULE_ID}")
  echo "Status Endpoint: ${status_response}"
fi
