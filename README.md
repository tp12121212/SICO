# SICO PoC

SICO proof-of-concept for Microsoft Purview-style automation:

- `dashboard/`: Next.js UI for text extraction and data classification testing
- `server/`: Node/Express API gateway (`/api/capsule`, status and stream endpoints)
- `worker/`: Azure Functions PowerShell worker (`/api/textExtraction`, `/api/dataClassification`, `/api/createDLP`)

The legacy Vite frontend has been removed. Use the Next.js dashboard only.

## Prerequisites

- Node.js 20+
- npm 10+
- PowerShell 7.4+
- Azure Functions Core Tools v4 (`func`) for local worker execution
- .NET 8 SDK/runtime for local PowerShell Azure Functions
- Azure CLI (`az`) if using Entra bootstrap script

## Install

```bash
npm install
cd dashboard && npm install
```

## Entra App Bootstrap (optional)

Interactive bootstrap to create/reuse an app registration and update dashboard env values:

```bash
./scripts/bootstrap-entra-app.sh
```

This updates `dashboard/.env.local` with:

- `NEXT_PUBLIC_AAD_CLIENT_ID`
- `NEXT_PUBLIC_AAD_AUTHORITY`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_API_SCOPE`

## Run Locally

### Option 1: appctl helper (recommended)

- macOS/Linux: `./appctl.sh start|stop|restart`
- Windows: `appctl.cmd start|stop|restart`

This orchestrates API, worker, and dashboard processes.

### Option 2: manual startup

1. Start worker:

```bash
cd worker
func start
```

2. Start API:

```bash
MAX_JSON_BODY_MB=50 \
AAD_TENANT_ID=organizations \
ALLOW_MULTI_TENANT=true \
AAD_AUDIENCE=api://<APP_CLIENT_ID> \
REQUIRED_SCOPES=Capsule.Submit \
ALLOW_DUMMY_WORKER_FALLBACK=false \
node server/index.js
```

3. Start dashboard:

```bash
cd dashboard
npm run dev
```

Open `http://localhost:5173`.

## HTTPS for Mobile Auth

Browser-based Microsoft sign-in requires HTTPS + Web Crypto on mobile browsers.
`appctl` starts dashboard HTTPS by default.

- macOS/Linux cert output:
  - `.appctl/certs/dashboard-dev-cert.pem`
  - `.appctl/certs/dashboard-dev-key.pem`

Generate/regenerate cert manually:

```bash
./scripts/generate-dev-https-cert.sh
```

Optional flags:

```bash
DEV_CERT_FORCE=1 DEV_CERT_HOSTS="sico.local,192.168.0.168" ./scripts/generate-dev-https-cert.sh
```

## Configuration

### API (`server/index.js`)

- `API_PORT` (default: `3001`)
- `MAX_JSON_BODY_MB` (default: `20`)
- `WORKER_TIMEOUT_MS` (default: `900000`)
- `AAD_TENANT_ID` (default: `common`)
- `ALLOW_MULTI_TENANT` (`true|false`, default: `false`)
- `AAD_AUDIENCE` (comma-separated; default: `api://sico-poc`)
- `REQUIRED_SCOPES` (comma-separated; default: `Capsule.Submit`)
- `WORKER_DLP_URL` (default: `http://localhost:7071/api/createDLP`)
- `WORKER_TEXT_EXTRACTION_URL` (default: `http://localhost:7071/api/textExtraction`)
- `WORKER_DATA_CLASSIFICATION_URL` (default: `http://localhost:7071/api/dataClassification`)
- `SKIP_JWT_VALIDATION` (`true|false`, dev only)
- `ALLOW_DUMMY_WORKER_FALLBACK` (`true|false`, default: `true`)

### Dashboard (`dashboard/.env.local`)

- `NEXT_PUBLIC_AAD_CLIENT_ID`
- `NEXT_PUBLIC_AAD_AUTHORITY`
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_API_SCOPE`
- `NEXT_PUBLIC_MAX_UPLOAD_MB` (optional)

## Notes and Current Caveats

- `func start` requires both Azure Functions Core Tools and .NET runtime support.
- `appctl.sh` and `appctl.cmd` currently start API with a hardcoded `AAD_AUDIENCE` value (`api://63eefc68-2d4b-45c0-a619-65b45c5fada9`). If your Entra app uses a different client ID, use manual startup for API (or adjust scripts locally).
- Some dashboard auth defaults also fall back to the same hardcoded client ID when env vars are missing; set all dashboard env vars explicitly to avoid mismatches.

## Quick Smoke Test

With API running locally, you can post a sample capsule:

```bash
./test.sh
```
