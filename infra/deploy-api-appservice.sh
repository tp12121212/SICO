#!/usr/bin/env bash
set -euo pipefail

: "${AZ_SUBSCRIPTION_ID:?Set AZ_SUBSCRIPTION_ID}"
: "${AZ_LOCATION:?Set AZ_LOCATION, e.g. australiaeast}"
: "${AZ_RESOURCE_GROUP:?Set AZ_RESOURCE_GROUP}"
: "${AZ_APP_SERVICE_PLAN:?Set AZ_APP_SERVICE_PLAN}"
: "${AZ_WEBAPP_NAME:?Set AZ_WEBAPP_NAME (globally unique)}"
: "${AAD_TENANT_ID:?Set AAD_TENANT_ID (use organizations for multi-tenant)}"
: "${AAD_AUDIENCE:?Set AAD_AUDIENCE (API app ID URI or client ID)}"
: "${WORKER_DLP_URL:?Set WORKER_DLP_URL}"

REQUIRED_SCOPES="${REQUIRED_SCOPES:-PurviewPolicy.ReadWrite.All,Content.Process.User,ProtectionScopes.Compute.User}"
ALLOW_DUMMY_WORKER_FALLBACK="${ALLOW_DUMMY_WORKER_FALLBACK:-false}"
ALLOW_MULTI_TENANT="${ALLOW_MULTI_TENANT:-true}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_ARCHIVE="$(mktemp -t sico-api-deploy.XXXXXX).zip"

az account set --subscription "${AZ_SUBSCRIPTION_ID}"

az group create \
  --name "${AZ_RESOURCE_GROUP}" \
  --location "${AZ_LOCATION}" \
  --output none

az appservice plan create \
  --name "${AZ_APP_SERVICE_PLAN}" \
  --resource-group "${AZ_RESOURCE_GROUP}" \
  --location "${AZ_LOCATION}" \
  --is-linux \
  --sku B1 \
  --output none

if ! az webapp show --name "${AZ_WEBAPP_NAME}" --resource-group "${AZ_RESOURCE_GROUP}" >/dev/null 2>&1; then
  az webapp create \
    --name "${AZ_WEBAPP_NAME}" \
    --resource-group "${AZ_RESOURCE_GROUP}" \
    --plan "${AZ_APP_SERVICE_PLAN}" \
    --runtime "NODE|20-lts" \
    --output none
fi

az webapp config appsettings set \
  --name "${AZ_WEBAPP_NAME}" \
  --resource-group "${AZ_RESOURCE_GROUP}" \
  --settings \
    NODE_ENV=production \
    API_PORT=8080 \
    AAD_TENANT_ID="${AAD_TENANT_ID}" \
    ALLOW_MULTI_TENANT="${ALLOW_MULTI_TENANT}" \
    AAD_AUDIENCE="${AAD_AUDIENCE}" \
    REQUIRED_SCOPES="${REQUIRED_SCOPES}" \
    WORKER_DLP_URL="${WORKER_DLP_URL}" \
    ALLOW_DUMMY_WORKER_FALLBACK="${ALLOW_DUMMY_WORKER_FALLBACK}" \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
  --output none

az webapp config set \
  --name "${AZ_WEBAPP_NAME}" \
  --resource-group "${AZ_RESOURCE_GROUP}" \
  --startup-file "node server/index.js" \
  --output none

cd "${ROOT_DIR}"
zip -r "${DEPLOY_ARCHIVE}" package.json package-lock.json server >/dev/null

az webapp deploy \
  --resource-group "${AZ_RESOURCE_GROUP}" \
  --name "${AZ_WEBAPP_NAME}" \
  --src-path "${DEPLOY_ARCHIVE}" \
  --type zip \
  --output none

API_URL="https://${AZ_WEBAPP_NAME}.azurewebsites.net"

echo "Deployment complete"
echo "API URL: ${API_URL}"
echo "Health check: ${API_URL}/healthz"

rm -f "${DEPLOY_ARCHIVE}"
