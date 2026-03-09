# SICO PoC

SICO proof-of-concept with:

- `dashboard/`: Next.js UI for Test Text Extraction
- `server/`: Node/Express API gateway (`/api/capsule`)
- `worker/`: Azure Functions PowerShell worker (`/api/textExtraction`, `/api/createDLP`)

## Frontend Direction

The legacy Vite frontend has been removed.
Use the Next.js dashboard only.

## Prerequisites

- Node.js 20+
- npm 10+
- PowerShell 7.4+
- Azure Functions Core Tools v4 (`func`)
- .NET 8 runtime/SDK for local PowerShell Functions

## Install

```bash
cd /Users/toddparker/Library/CloudStorage/OneDrive-KillerCloud/Applications/gits/SICO
npm install

cd dashboard
npm install
```

## Entra App Bootstrap

Interactive bootstrap (create/reuse app reg, set scopes, optional admin consent, and update dashboard env):

```bash
cd /Users/toddparker/Library/CloudStorage/OneDrive-KillerCloud/Applications/gits/SICO
./scripts/bootstrap-entra-app.sh
```

This updates:

- `dashboard/.env.local`
  - `NEXT_PUBLIC_AAD_CLIENT_ID`
  - `NEXT_PUBLIC_AAD_AUTHORITY`
  - `NEXT_PUBLIC_API_BASE_URL`
  - `NEXT_PUBLIC_API_SCOPE`

## Run Locally

1. Start worker:

```bash
cd /Users/toddparker/Library/CloudStorage/OneDrive-KillerCloud/Applications/gits/SICO/worker
func start
```

2. Start API:

```bash
cd /Users/toddparker/Library/CloudStorage/OneDrive-KillerCloud/Applications/gits/SICO
env MAX_JSON_BODY_MB=50 \
AAD_TENANT_ID=organizations \
ALLOW_MULTI_TENANT=true \
AAD_AUDIENCE=api://<APP_CLIENT_ID> \
REQUIRED_SCOPES=Capsule.Submit \
ALLOW_DUMMY_WORKER_FALLBACK=false \
node server/index.js
```

3. Start dashboard:

```bash
cd /Users/toddparker/Library/CloudStorage/OneDrive-KillerCloud/Applications/gits/SICO/dashboard
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Optional Helper Scripts

- macOS/Linux: `./appctl.sh start|stop|restart`
- Windows: `appctl.cmd start|stop|restart`

These orchestrate dashboard, API, and worker processes.

## HTTPS for Mobile (iOS/Android)

Microsoft sign-in in browser requires a secure context (HTTPS + Web Crypto).
Using `http://192.168.x.x:5173` on mobile will fail auth initialization.

### Local development HTTPS

`appctl` now starts the dashboard with HTTPS by default:

- macOS/Linux: `./appctl.sh start`
- Windows: `appctl.cmd start`

For macOS/Linux, a local self-signed cert is generated at:

- `.appctl/certs/dashboard-dev-cert.pem`
- `.appctl/certs/dashboard-dev-key.pem`

You can pre-generate/regenerate it manually:

```bash
./scripts/generate-dev-https-cert.sh
```

Optional flags:

```bash
DEV_CERT_FORCE=1 DEV_CERT_HOSTS="sico.local,192.168.0.168" ./scripts/generate-dev-https-cert.sh
```

### Production HTTPS (recommended)

Use a real domain and terminate TLS at a reverse proxy (Caddy/Nginx/Traefik) with Let’s Encrypt.

Example Caddyfile:

```txt
purview.example.com {
  reverse_proxy /api/* 127.0.0.1:3001
  reverse_proxy 127.0.0.1:5173
}
```

Then configure Entra app SPA redirect URIs to the exact HTTPS origin (for example `https://purview.example.com/`).

## Notes

- `func start` requires .NET + PowerShell worker runtime support.
- For text extraction parity with your direct PowerShell flow, ensure required Exchange/Purview modules are available in the worker runtime.
