import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const MAX_JSON_BODY_MB = Number(process.env.MAX_JSON_BODY_MB ?? 20);
const WORKER_TIMEOUT_MS = Number(process.env.WORKER_TIMEOUT_MS ?? 900000);
app.use(express.json({ limit: `${MAX_JSON_BODY_MB}mb` }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  if (
    origin === "http://localhost:5173" ||
    origin === "http://127.0.0.1:5173" ||
    origin === "http://localhost:3000"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

const PORT = Number(process.env.API_PORT ?? 3001);
const AAD_TENANT_ID = process.env.AAD_TENANT_ID ?? "common";
const ALLOW_MULTI_TENANT = process.env.ALLOW_MULTI_TENANT === "true";
const AAD_AUDIENCES = (process.env.AAD_AUDIENCE ?? "api://sico-poc")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const REQUIRED_SCOPES = (
  process.env.REQUIRED_SCOPES ??
  "Capsule.Submit"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const WORKER_DLP_URL = process.env.WORKER_DLP_URL ?? "http://localhost:7071/api/createDLP";
const WORKER_TEXT_EXTRACTION_URL =
  process.env.WORKER_TEXT_EXTRACTION_URL ?? "http://localhost:7071/api/textExtraction";
const WORKER_DATA_CLASSIFICATION_URL =
  process.env.WORKER_DATA_CLASSIFICATION_URL ?? "http://localhost:7071/api/dataClassification";
const SKIP_JWT_VALIDATION = process.env.SKIP_JWT_VALIDATION === "true";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ALLOW_DUMMY_WORKER_FALLBACK = process.env.ALLOW_DUMMY_WORKER_FALLBACK !== "false";

const JWKS = createRemoteJWKSet(
  new URL(`https://login.microsoftonline.com/${AAD_TENANT_ID}/discovery/v2.0/keys`)
);

const COMMAND_REGISTRY = {
  CreateDLPPolicy: {
    workerUrl: WORKER_DLP_URL
  },
  TextExtraction: {
    workerUrl: WORKER_TEXT_EXTRACTION_URL
  },
  DataClassification: {
    workerUrl: WORKER_DATA_CLASSIFICATION_URL
  }
};
const statusStore = new Map();

function toIsoTimestamp(now = new Date()) {
  return now.toISOString();
}

function pickAuditView(capsule) {
  const params = capsule?.params && typeof capsule.params === "object" ? { ...capsule.params } : {};
  if (typeof params.fileContent === "string") {
    params.fileContent = `<redacted-base64:${params.fileContent.length} chars>`;
  }
  if (typeof params.inputText === "string") {
    params.inputText = `<redacted-text:${params.inputText.length} chars>`;
  }
  return {
    capsuleId: capsule.capsuleId,
    action: capsule.action,
    tenant: capsule.tenant,
    userId: capsule.userId,
    params
  };
}

function pickWorkerAuditView(workerResult) {
  if (!workerResult || typeof workerResult !== "object") {
    return workerResult;
  }
  const copy = { ...workerResult };
  if (typeof copy.text === "string") {
    copy.text = `<redacted-text:${copy.text.length} chars>`;
  }
  if (typeof copy.ExtractedStreamText === "string") {
    copy.ExtractedStreamText = `<redacted-text:${copy.ExtractedStreamText.length} chars>`;
  }
  if (Array.isArray(copy.Streams)) {
    copy.Streams = `<redacted-streams:${copy.Streams.length} items>`;
  }
  return copy;
}

function parseRequiredBearerToken(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    return null;
  }
  return authorizationHeader.slice("Bearer ".length).trim();
}

function parseScopes(payload) {
  const scopeClaim = typeof payload.scp === "string" ? payload.scp : "";
  return new Set(scopeClaim.split(" ").map((scope) => scope.trim()).filter(Boolean));
}

function hasRequiredScope(payload) {
  const scopes = parseScopes(payload);
  return REQUIRED_SCOPES.some((scope) => scopes.has(scope));
}

function resolveUserPrincipalName(tokenPayload, capsule) {
  const candidates = [
    tokenPayload?.preferred_username,
    tokenPayload?.upn,
    tokenPayload?.email,
    capsule?.userId
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.includes("@")) {
      return candidate;
    }
  }

  return undefined;
}

function isValidMultiTenantIssuer(issuer, tid) {
  const normalizedTid = tid.toLowerCase();
  const issuerLower = issuer.toLowerCase();
  return (
    issuerLower === `https://login.microsoftonline.com/${normalizedTid}/v2.0` ||
    issuerLower === `https://sts.windows.net/${normalizedTid}/`
  );
}

function requireValidCapsule(capsule) {
  if (!capsule || typeof capsule !== "object") {
    return "Capsule body must be a JSON object";
  }

  const requiredTopLevel = ["capsuleId", "action", "params", "signature"];
  for (const key of requiredTopLevel) {
    if (!(key in capsule)) {
      return `Missing required field: ${key}`;
    }
  }

  if (typeof capsule.capsuleId !== "string" || capsule.capsuleId.trim() === "") {
    return "Invalid capsuleId";
  }

  if (typeof capsule.action !== "string" || capsule.action.trim() === "") {
    return "Invalid action";
  }

  if (!COMMAND_REGISTRY[capsule.action]) {
    return `Unsupported action: ${capsule.action}`;
  }

  if (!capsule.params || typeof capsule.params !== "object") {
    return "Invalid params";
  }

  if (typeof capsule.signature !== "string" || !capsule.signature.startsWith("dummy-signature")) {
    return "Invalid signature placeholder";
  }

  return null;
}

async function validateAccessToken(authorizationHeader) {
  const token = parseRequiredBearerToken(authorizationHeader);
  if (!token) {
    throw new Error("Missing bearer token");
  }

  if (SKIP_JWT_VALIDATION && !IS_PRODUCTION) {
    return {
      sub: "test-user",
      oid: "test-oid",
      tid: "test-tenant",
      scp: REQUIRED_SCOPES.join(" "),
      iss: `https://login.microsoftonline.com/${AAD_TENANT_ID}/v2.0`
    };
  }
  if (SKIP_JWT_VALIDATION && IS_PRODUCTION) {
    throw new Error("SKIP_JWT_VALIDATION is not allowed in production");
  }

  const verifyOptions = {
    audience: AAD_AUDIENCES.length === 1 ? AAD_AUDIENCES[0] : AAD_AUDIENCES
  };
  if (!ALLOW_MULTI_TENANT) {
    verifyOptions.issuer = [
      `https://login.microsoftonline.com/${AAD_TENANT_ID}/v2.0`,
      `https://sts.windows.net/${AAD_TENANT_ID}/`
    ];
  }

  const { payload } = await jwtVerify(token, JWKS, verifyOptions);

  if (ALLOW_MULTI_TENANT) {
    const issuer = typeof payload.iss === "string" ? payload.iss : "";
    const tid = typeof payload.tid === "string" ? payload.tid : "";
    if (tid.length !== 36 || !isValidMultiTenantIssuer(issuer, tid)) {
      throw new Error("Invalid issuer or tenant claim for multi-tenant token");
    }
  }

  if (!hasRequiredScope(payload)) {
    throw new Error(`Missing required scope. Need one of: ${REQUIRED_SCOPES.join(", ")}`);
  }

  return payload;
}

async function invokeWorker(capsule) {
  const workerUrl = COMMAND_REGISTRY[capsule.action].workerUrl;
  const workerRequest =
    capsule.action === "TextExtraction" || capsule.action === "DataClassification"
      ? {
          action: capsule.action,
          params: capsule.params,
          ...capsule.params
        }
      : capsule.params;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS);
    let workerResponse;
    try {
      workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workerRequest),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await workerResponse.text();
    let parsed = {};
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { rawText };
      }
    }

    if (!workerResponse.ok) {
      throw new Error(`Worker call failed: ${workerResponse.status}`);
    }

    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Worker call timed out after ${WORKER_TIMEOUT_MS}ms`);
    }
    if (!ALLOW_DUMMY_WORKER_FALLBACK) {
      throw error;
    }

    console.warn("Worker unavailable, returning dummy PoC result", {
      capsuleId: capsule.capsuleId,
      action: capsule.action
    });

    return {
      status:
        capsule.action === "TextExtraction"
          ? "extracted"
          : capsule.action === "DataClassification"
            ? "classified"
            : "created",
      policyName: capsule.params?.name,
      text: capsule.params?.fileContent ? "<dummy-text-extraction-result>" : undefined,
      mode: "dummy-fallback",
      message: "Worker not reachable; returned PoC dummy result"
    };
  }
}

function saveStatus(capsuleId, state) {
  statusStore.set(capsuleId, {
    ...state,
    updatedAt: toIsoTimestamp()
  });
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/status/:capsuleId", (req, res) => {
  const { capsuleId } = req.params;
  const result = statusStore.get(capsuleId);
  if (!result) {
    res.status(404).json({
      capsuleId,
      status: "not_found"
    });
    return;
  }

  res.status(200).json({
    capsuleId,
    ...result
  });
});

app.post("/api/capsule", async (req, res) => {
  try {
    const tokenPayload = await validateAccessToken(req.headers.authorization);
    console.log("Token validated", {
      oid: tokenPayload.oid,
      tid: tokenPayload.tid,
      iss: tokenPayload.iss,
      scp: tokenPayload.scp
    });

    const capsuleError = requireValidCapsule(req.body);
    if (capsuleError) {
      res.status(400).json({ status: "error", error: capsuleError });
      return;
    }

    const capsule = req.body;
    const userPrincipalName = resolveUserPrincipalName(tokenPayload, capsule);
    const workerCapsule =
      capsule.action === "TextExtraction" || capsule.action === "DataClassification"
        ? {
            ...capsule,
            params: {
              ...capsule.params,
              ...(userPrincipalName ? { userPrincipalName } : {})
            }
          }
        : capsule;

    saveStatus(capsule.capsuleId, { status: "processing" });
    console.log("Received capsule", pickAuditView(workerCapsule));

    const workerResult = await invokeWorker(workerCapsule);
    const auditRecord = {
      capsuleId: capsule.capsuleId,
      action: capsule.action,
      workerStatus: workerResult.status,
      workerResult: pickWorkerAuditView(workerResult)
    };
    console.log("Audit record", auditRecord);
    saveStatus(capsule.capsuleId, { status: "success", workerResult });

    res.status(200).json({
      capsuleId: capsule.capsuleId,
      status: "success",
      processedAt: toIsoTimestamp(),
      workerResult
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    const status =
      message.includes("Missing") ||
      message.includes("scope") ||
      message.includes("issuer") ||
      message.includes("tenant")
        ? 401
        : 500;

    console.error("Capsule processing failed", { error: message });
    res.status(status).json({ status: "error", error: message });
  }
});

app.use((error, _req, res, _next) => {
  if (error?.type === "entity.too.large") {
    res.status(413).json({
      status: "error",
      error: `Payload too large. Increase MAX_JSON_BODY_MB (current: ${MAX_JSON_BODY_MB}mb).`
    });
    return;
  }

  res.status(500).json({
    status: "error",
    error: "Unhandled API error"
  });
});

app.listen(PORT, () => {
  console.log(`SICO API gateway listening on http://localhost:${PORT}`);
});
