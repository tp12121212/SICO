#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_ENV_PATH="${ROOT_DIR}/dashboard/.env.local"
GRAPH_APP_ID="00000003-0000-0000-c000-000000000000"

DEFAULT_APP_NAME="SICOApp"
DEFAULT_REDIRECT_URI="http://localhost:5173"
DEFAULT_SCOPE_VALUES="User.Read,Content.Process.User,ProtectionScopes.Compute.User"
DEFAULT_SIGN_IN_AUDIENCE="AzureADMultipleOrgs"
DEFAULT_API_SCOPE_VALUE="Capsule.Submit"
DEFAULT_API_SCOPE_ADMIN_CONSENT_NAME="Submit SICO capsules"
DEFAULT_API_SCOPE_ADMIN_CONSENT_DESC="Allows the app to submit SICO capsules to the API gateway."
STRICT_PREREQS=false

prompt_with_default() {
  local label="$1"
  local default_value="$2"
  local answer=""
  read -r -p "${label} [${default_value}]: " answer
  if [[ -z "${answer}" ]]; then
    printf '%s' "${default_value}"
  else
    printf '%s' "${answer}"
  fi
}

prompt_yes_no() {
  local label="$1"
  local default_choice="$2"
  local answer=""
  local default_prompt="Y/n"
  if [[ "${default_choice}" == "no" ]]; then
    default_prompt="y/N"
  fi
  read -r -p "${label} (${default_prompt}): " answer
  if [[ -z "${answer}" ]]; then
    [[ "${default_choice}" == "yes" ]] && return 0 || return 1
  fi
  case "${answer}" in
    y|Y|yes|YES) return 0 ;;
    n|N|no|NO) return 1 ;;
    *)
      echo "Please answer yes or no."
      prompt_yes_no "${label}" "${default_choice}"
      return $? ;;
  esac
}

retry_admin_consent() {
  local app_id="$1"
  local max_attempts=5
  local delay_seconds=6
  local attempt=1
  while (( attempt <= max_attempts )); do
    if az ad app permission admin-consent --id "${app_id}" >/dev/null 2>&1; then
      return 0
    fi
    if (( attempt == max_attempts )); then
      return 1
    fi
    echo "Admin consent attempt ${attempt} failed; retrying in ${delay_seconds}s..."
    sleep "${delay_seconds}"
    attempt=$((attempt + 1))
  done
  return 1
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

version_ge() {
  local actual="$1"
  local minimum="$2"
  [[ "$(printf '%s\n' "${minimum}" "${actual}" | sort -V | head -n1)" == "${minimum}" ]]
}

check_prereqs() {
  require_command az
  require_command node
  require_command npm
  require_command pwsh
  if command -v func >/dev/null 2>&1; then
    has_func=true
  else
    has_func=false
  fi
  if command -v dotnet >/dev/null 2>&1; then
    has_dotnet=true
  else
    has_dotnet=false
  fi

  local node_version npm_version pwsh_version func_version dotnet_version
  node_version="$(node -p "process.versions.node")"
  npm_version="$(npm --version)"
  pwsh_version="$(pwsh -NoLogo -NoProfile -Command '$PSVersionTable.PSVersion.ToString()')"
  func_version="not-installed"
  dotnet_version="not-installed"
  if [[ "${has_func}" == "true" ]]; then
    func_version="$(func --version | head -n1)"
  fi
  if [[ "${has_dotnet}" == "true" ]]; then
    dotnet_version="$(dotnet --version)"
  fi

  if ! version_ge "${node_version}" "20.0.0"; then
    echo "Node.js 20+ required. Found ${node_version}" >&2
    exit 1
  fi
  if ! version_ge "${npm_version}" "10.0.0"; then
    echo "npm 10+ required. Found ${npm_version}" >&2
    exit 1
  fi
  if ! version_ge "${pwsh_version}" "7.4.0"; then
    echo "PowerShell 7.4+ required. Found ${pwsh_version}" >&2
    exit 1
  fi
  if [[ "${has_func}" == "true" ]] && ! version_ge "${func_version}" "4.0.0"; then
    echo "Azure Functions Core Tools v4+ required when installed. Found ${func_version}" >&2
    exit 1
  fi
  if [[ "${has_func}" == "true" && "${has_dotnet}" == "false" ]]; then
    if [[ "${STRICT_PREREQS}" == "true" ]]; then
      echo "dotnet SDK is required when func is installed. Install with: brew install --cask dotnet-sdk" >&2
      exit 1
    fi
    echo "warning: dotnet SDK not installed; PowerShell Azure Functions cannot run until dotnet is installed"
    echo "         install with: brew install --cask dotnet-sdk"
  fi
  if [[ "${has_func}" == "false" && "${STRICT_PREREQS}" == "true" ]]; then
    echo "Azure Functions Core Tools v4+ required in strict mode. Install with: npm i -g azure-functions-core-tools@4 --unsafe-perm true" >&2
    exit 1
  fi

  echo "Prerequisites check passed"
  echo "  node: ${node_version}"
  echo "  npm: ${npm_version}"
  echo "  pwsh: ${pwsh_version}"
  echo "  func: ${func_version}"
  echo "  dotnet: ${dotnet_version}"
  if [[ "${has_func}" == "false" ]]; then
    echo "  warning: func not installed; this is fine for Entra app bootstrap, but required to run local Azure Functions worker"
  fi
}

ensure_az_login() {
  if ! az account show >/dev/null 2>&1; then
    echo "No active Azure CLI session found. Running az login..."
    az login >/dev/null
  fi
}

main() {
  if [[ "${1:-}" == "--strict-prereqs" ]]; then
    STRICT_PREREQS=true
  fi
  check_prereqs
  ensure_az_login

  local tenant_id subscription_id subscription_name
  tenant_id="$(az account show --query tenantId -o tsv)"
  subscription_id="$(az account show --query id -o tsv)"
  subscription_name="$(az account show --query name -o tsv)"

  echo "Detected Azure context"
  echo "  tenantId: ${tenant_id}"
  echo "  subscription: ${subscription_name} (${subscription_id})"

  local app_name sign_in_audience redirect_uri
  app_name="$(prompt_with_default "App registration display name" "${DEFAULT_APP_NAME}")"
  sign_in_audience="$(prompt_with_default "Sign-in audience (AzureADMultipleOrgs or AzureADMyOrg)" "${DEFAULT_SIGN_IN_AUDIENCE}")"

  redirect_uri="$(prompt_with_default "SPA redirect URI" "${DEFAULT_REDIRECT_URI}")"

  local app_id app_object_id
  app_id="$(az ad app list --display-name "${app_name}" --query "[?displayName=='${app_name}'] | [0].appId" -o tsv)"

  if [[ -n "${app_id}" ]]; then
    echo "Found existing app '${app_name}' with appId ${app_id}"
    if ! prompt_yes_no "Use existing app registration" "yes"; then
      app_id=""
    fi
  fi

  if [[ -z "${app_id}" ]]; then
    app_id="$(az ad app create --display-name "${app_name}" --sign-in-audience "${sign_in_audience}" --query appId -o tsv)"
    echo "Created app registration with appId ${app_id}"
  fi

  app_object_id="$(az ad app show --id "${app_id}" --query id -o tsv)"
  az ad sp create --id "${app_id}" >/dev/null 2>&1 || true

  local api_identifier_uri
  api_identifier_uri="api://${app_id}"

  local api_scope_value api_scope_name api_scope_description api_scope_id
  api_scope_value="$(prompt_with_default "Custom API scope value" "${DEFAULT_API_SCOPE_VALUE}")"
  api_scope_name="$(prompt_with_default "Custom API admin consent display name" "${DEFAULT_API_SCOPE_ADMIN_CONSENT_NAME}")"
  api_scope_description="$(prompt_with_default "Custom API admin consent description" "${DEFAULT_API_SCOPE_ADMIN_CONSENT_DESC}")"

  api_scope_id="$(az ad app show --id "${app_id}" --query "api.oauth2PermissionScopes[?value=='${api_scope_value}'] | [0].id" -o tsv)"
  if [[ -z "${api_scope_id}" ]]; then
    api_scope_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  fi

  local api_patch_file
  api_patch_file="$(mktemp)"
  cat > "${api_patch_file}" <<JSON
{
  "signInAudience": "${sign_in_audience}",
  "spa": {
    "redirectUris": ["${redirect_uri}"]
  },
  "identifierUris": ["${api_identifier_uri}"],
  "api": {
    "oauth2PermissionScopes": [
      {
        "id": "${api_scope_id}",
        "type": "User",
        "isEnabled": true,
        "value": "${api_scope_value}",
        "adminConsentDisplayName": "${api_scope_name}",
        "adminConsentDescription": "${api_scope_description}",
        "userConsentDisplayName": "${api_scope_name}",
        "userConsentDescription": "${api_scope_description}"
      }
    ]
  }
}
JSON

  az rest --method PATCH \
    --uri "https://graph.microsoft.com/v1.0/applications/${app_object_id}" \
    --headers "Content-Type=application/json" \
    --body @"${api_patch_file}" >/dev/null
  rm -f "${api_patch_file}"

  local scope_values_csv
  scope_values_csv="$(prompt_with_default "Microsoft Graph delegated scopes (comma-separated)" "${DEFAULT_SCOPE_VALUES}")"

  IFS=',' read -r -a scope_values <<< "${scope_values_csv}"

  local -a graph_scope_json_items=()
  local -a resolved_scope_values_for_grant=()
  local graph_scope_id trimmed_scope
  for scope_value in "${scope_values[@]}"; do
    trimmed_scope="$(echo "${scope_value}" | xargs)"
    [[ -z "${trimmed_scope}" ]] && continue

    graph_scope_id="$(az ad sp show --id "${GRAPH_APP_ID}" --query "oauth2PermissionScopes[?value=='${trimmed_scope}' && isEnabled].id | [0]" -o tsv)"
    if [[ -z "${graph_scope_id}" ]]; then
      echo "Warning: scope '${trimmed_scope}' not found in tenant Graph service principal; skipping"
      continue
    fi

    graph_scope_json_items+=("{\"id\":\"${graph_scope_id}\",\"type\":\"Scope\"}")
    resolved_scope_values_for_grant+=("${trimmed_scope}")
  done

  if [[ ${#graph_scope_json_items[@]} -eq 0 ]]; then
    echo "No valid Graph scopes resolved. Aborting to avoid wiping requiredResourceAccess." >&2
    exit 1
  fi

  local graph_scope_array_json
  graph_scope_array_json="[$(IFS=,; echo "${graph_scope_json_items[*]}")]"

  local rra_patch_file
  rra_patch_file="$(mktemp)"
  cat > "${rra_patch_file}" <<JSON
{
  "requiredResourceAccess": [
    {
      "resourceAppId": "${GRAPH_APP_ID}",
      "resourceAccess": ${graph_scope_array_json}
    }
  ]
}
JSON

  az rest --method PATCH \
    --uri "https://graph.microsoft.com/v1.0/applications/${app_object_id}" \
    --headers "Content-Type=application/json" \
    --body @"${rra_patch_file}" >/dev/null
  rm -f "${rra_patch_file}"

  if prompt_yes_no "Grant admin consent now (requires admin privileges)" "yes"; then
    # explicit delegated grant first to avoid portal showing "Not granted" when admin-consent races
    local resolved_scope_values
    resolved_scope_values="$(printf '%s\n' "${resolved_scope_values_for_grant[@]}" | awk '!seen[$0]++' | tr '\n' ' ' | xargs)"
    if [[ -n "${resolved_scope_values}" ]]; then
      az ad app permission grant \
        --id "${app_id}" \
        --api "${GRAPH_APP_ID}" \
        --scope "${resolved_scope_values}" >/dev/null || true
    fi

    if retry_admin_consent "${app_id}"; then
      echo "Admin consent granted"
    else
      echo "Warning: admin consent failed after retries; run manually:"
      echo "  az ad app permission admin-consent --id ${app_id}"
    fi
  else
    echo "Skipped admin consent"
  fi

  local authority
  if [[ "${sign_in_audience}" == "AzureADMultipleOrgs" ]]; then
    authority="https://login.microsoftonline.com/organizations"
  else
    authority="https://login.microsoftonline.com/${tenant_id}"
  fi

  python3 - "${DASHBOARD_ENV_PATH}" "${app_id}" "${authority}" "${api_identifier_uri}/${api_scope_value}" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
client_id = sys.argv[2].strip()
authority = sys.argv[3].strip()
api_scope = sys.argv[4].strip()

desired = {
    "NEXT_PUBLIC_AAD_CLIENT_ID": client_id,
    "NEXT_PUBLIC_AAD_AUTHORITY": authority,
    "NEXT_PUBLIC_API_BASE_URL": "http://localhost:3001",
    "NEXT_PUBLIC_API_SCOPE": api_scope,
}

existing = {}
if path.exists():
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        existing[key.strip()] = value.strip()

existing.update(desired)
ordered_keys = sorted(existing.keys())
content = "\n".join(f"{k}={existing[k]}" for k in ordered_keys) + "\n"
path.write_text(content, encoding="utf-8")
PY

  echo "Updated ${DASHBOARD_ENV_PATH}"

  echo "Summary"
  echo "  App name: ${app_name}"
  echo "  App ID: ${app_id}"
  echo "  Tenant ID: ${tenant_id}"
  echo "  Sign-in audience: ${sign_in_audience}"
  echo "  Redirect URI: ${redirect_uri}"
  echo "  API identifier URI: ${api_identifier_uri}"
  echo "  API scope: ${api_scope_value}"

  echo "Run next: npm install"
}

main "$@"
