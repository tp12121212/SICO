"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type PublicClientApplication as PublicClientApplicationType
} from "@azure/msal-browser";
import { useEffect, useMemo, useRef, useState } from "react";
import LiveExecutionTerminal from "@/features/testing/components/live-execution-terminal";
import { buildApiUrl } from "@/features/testing/lib/api-url";
import {
  getMsalUnsupportedReason,
  shouldFallbackToRedirect,
  shouldUseRedirectAuthFlow
} from "@/features/testing/lib/msal-support";

type ClassificationMatch = Record<string, unknown>;
type DisplayField = {
  key: string;
  label: string;
  value: unknown;
};

type DisplayDetection = {
  key: string;
  title: string;
  subtitle: string;
  fields: DisplayField[];
  matchedText?: string;
};

type DisplayResultGroup = {
  key: string;
  title: string;
  subtitle?: string;
  metadata: DisplayField[];
  detections: DisplayDetection[];
};

type WorkerResult = {
  status?: string;
  classificationMethod?: string;
  inputMode?: string;
  fileName?: string;
  totalMatches?: number;
  hasMatches?: boolean;
  matches?: ClassificationMatch[];
  result?: unknown;
  message?: string;
};

type PrefillPayload = {
  inputText?: string;
  sourceFileName?: string;
  autoRun?: boolean;
  runAllSits?: boolean;
};

const aadClientId = process.env.NEXT_PUBLIC_AAD_CLIENT_ID ?? "63eefc68-2d4b-45c0-a619-65b45c5fada9";
const aadAuthority = process.env.NEXT_PUBLIC_AAD_AUTHORITY ?? "https://login.microsoftonline.com/organizations";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const apiScope = process.env.NEXT_PUBLIC_API_SCOPE ?? `api://${aadClientId}/Capsule.Submit`;
const maxUploadMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10);
const dataClassificationPrefillStorageKey = "sico.testing.dataClassification.prefill";

function getRedirectStartPage(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.location.href;
}

async function getAccessToken(
  msalClient: PublicClientApplicationType,
  account: AccountInfo,
  useRedirectFlow: boolean
): Promise<string> {
  try {
    const result = await msalClient.acquireTokenSilent({
      account,
      scopes: ["openid", "profile", apiScope]
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      if (useRedirectFlow) {
        await msalClient.acquireTokenRedirect({
          scopes: ["openid", "profile", apiScope],
          redirectStartPage: getRedirectStartPage()
        });
        throw new Error("Redirecting to Microsoft sign-in...");
      }
      const result = await msalClient.acquireTokenPopup({ scopes: ["openid", "profile", apiScope] });
      return result.accessToken;
    }
    throw error;
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

function createCapsule(input: {
  action: "DataClassification";
  userId: string;
  tenant: string;
  params: Record<string, unknown>;
}) {
  const now = new Date();
  const capsuleId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `capsule-${Date.now()}`;

  return {
    schemaVersion: "1.0",
    capsuleId,
    tenant: input.tenant,
    userId: input.userId,
    action: input.action,
    params: input.params,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    signature: `dummy-signature:${capsuleId}`
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractMatches(value: unknown): ClassificationMatch[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is ClassificationMatch => isRecord(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidateKeys = ["matches", "Matches", "detections", "Detections", "results", "Results", "items", "Items"];
  for (const key of candidateKeys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is ClassificationMatch => isRecord(item));
    }
  }

  return [];
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function getFirstValue(record: ClassificationMatch, keys: string[]): unknown {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const value = record[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && value.trim().length === 0) {
      continue;
    }
    return value;
  }
  return undefined;
}

function getFirstString(record: ClassificationMatch, keys: string[]): string | undefined {
  const value = getFirstValue(record, keys);
  if (typeof value !== "string") {
    return undefined;
  }
  return value.trim();
}

function toDisplayFields(record: ClassificationMatch, excludedKeys: Set<string>): DisplayField[] {
  return Object.entries(record)
    .filter(([key, value]) => !excludedKeys.has(key) && value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      label: humanizeKey(key),
      value
    }));
}

function extractDetectionCandidates(value: unknown): ClassificationMatch[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is ClassificationMatch => isRecord(item));
  }

  if (!isRecord(value)) {
    return [];
  }

  const candidateKeys = [
    "matches",
    "Matches",
    "detections",
    "Detections",
    "results",
    "Results",
    "items",
    "Items",
    "SensitiveInformation",
    "SensitiveInformationTypes",
    "Classifications"
  ];

  for (const key of candidateKeys) {
    const candidate = value[key];
    if (Array.isArray(candidate)) {
      return candidate.filter((item): item is ClassificationMatch => isRecord(item));
    }
  }

  return [];
}

function getMatchTitle(match: ClassificationMatch, index: number): string {
  const preferredKeys = [
    "sitName",
    "SITName",
    "name",
    "Name",
    "sensitiveInformationType",
    "SensitiveInformationType",
    "patternName",
    "PatternName",
    "streamName",
    "StreamName",
    "id",
    "Id"
  ];

  for (const key of preferredKeys) {
    const value = match[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return `Match ${index + 1}`;
}

function normalizeDetection(
  record: ClassificationMatch,
  index: number,
  groupKey: string
): DisplayDetection {
  const title = getMatchTitle(record, index);
  const confidence = getFirstValue(record, [
    "Confidence",
    "confidence",
    "ConfidenceLevel",
    "confidenceLevel",
    "ConfidenceScore",
    "confidenceScore"
  ]);
  const count = getFirstValue(record, [
    "Count",
    "count",
    "MatchCount",
    "matchCount",
    "Occurrences",
    "occurrences",
    "Hits",
    "hits"
  ]);
  const location = getFirstValue(record, [
    "Location",
    "location",
    "Locations",
    "locations",
    "StreamName",
    "streamName"
  ]);
  const matchedTextValue = getFirstValue(record, [
    "MatchedText",
    "matchedText",
    "ExtractedText",
    "extractedText",
    "Snippet",
    "snippet",
    "Text",
    "text",
    "Value",
    "value"
  ]);
  const matchedText = typeof matchedTextValue === "string" && matchedTextValue.trim().length > 0
    ? matchedTextValue.trim()
    : undefined;

  const summaryParts: string[] = [];
  if (confidence !== undefined) {
    summaryParts.push(`Confidence: ${String(confidence)}`);
  }
  if (count !== undefined) {
    summaryParts.push(`Count: ${String(count)}`);
  }
  if (location !== undefined) {
    summaryParts.push(`Location: ${typeof location === "string" ? location : JSON.stringify(location)}`);
  }

  const excludedKeys = new Set([
    "MatchedText",
    "matchedText",
    "ExtractedText",
    "extractedText",
    "Snippet",
    "snippet",
    "Text",
    "text",
    "Value",
    "value"
  ]);
  const fields = toDisplayFields(record, excludedKeys);

  return {
    key: `${groupKey}-det-${index}`,
    title,
    subtitle: summaryParts.join(" | "),
    matchedText,
    fields
  };
}

function normalizeResultGroups(matches: ClassificationMatch[]): DisplayResultGroup[] {
  const result: DisplayResultGroup[] = [];

  matches.forEach((match, index) => {
    const groupKey = `group-${index}`;
    const title = getFirstString(match, ["Name", "StreamName", "SourceFile", "FileName"]) ?? `Result Item ${index + 1}`;
    const kind = getFirstString(match, ["Kind", "Mode"]);
    const streamIndex = getFirstValue(match, ["StreamIndex", "streamIndex"]);
    const subtitleParts: string[] = [];
    if (kind) {
      subtitleParts.push(kind);
    }
    if (streamIndex !== undefined) {
      subtitleParts.push(`Stream ${String(streamIndex)}`);
    }

    const nestedCandidates = extractDetectionCandidates(match.Result ?? match.result ?? match.DataClassification);
    const hasDirectDetectionIdentity = getMatchTitle(match, -1) !== "Match 0";
    const detectionsSource = nestedCandidates.length > 0
      ? nestedCandidates
      : (hasDirectDetectionIdentity ? [match] : []);

    const detections = detectionsSource.map((item, detectionIndex) =>
      normalizeDetection(item, detectionIndex, groupKey)
    );

    const metadataExcludedKeys = new Set(["Result", "result", "DataClassification"]);
    const metadata = toDisplayFields(match, metadataExcludedKeys).filter((field) => {
      return field.key !== "Result" && field.key !== "result" && field.key !== "DataClassification";
    });

    result.push({
      key: groupKey,
      title,
      subtitle: subtitleParts.join(" | "),
      metadata,
      detections
    });
  });

  return result;
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function renderPrimitive(value: string | number | boolean) {
  if (typeof value === "string" && isUrl(value)) {
    return (
      <a className="break-all text-primary underline" href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  return <span className="break-words text-dark dark:text-white">{String(value)}</span>;
}

function renderValue(value: unknown, depth = 0) {
  if (value === null || value === undefined) {
    return <span className="text-dark-5 dark:text-dark-6">null</span>;
  }

  if (isPrimitiveValue(value)) {
    return renderPrimitive(value);
  }

  if (depth > 2) {
    return (
      <pre className="max-h-56 overflow-auto rounded-lg border border-stroke bg-gray-1 p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark dark:text-dark-6">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-dark-5 dark:text-dark-6">none</span>;
    }

    if (value.every((item) => isPrimitiveValue(item))) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span
              key={`value-${index}-${String(item)}`}
              className="rounded-full border border-stroke bg-white px-2 py-0.5 text-xs text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6"
            >
              {String(item)}
            </span>
          ))}
        </div>
      );
    }

    if (value.every((item) => isRecord(item))) {
      return (
        <div className="space-y-2">
          {value.map((item, index) => {
            const title = getFirstString(item, ["name", "Name", "title", "Title", "id", "Id"]) ?? `Item ${index + 1}`;
            const fields = Object.entries(item)
              .filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined)
              .sort(([a], [b]) => a.localeCompare(b));
            return (
              <div key={`${title}-${index}`} className="rounded border border-stroke bg-white/70 p-2 dark:border-dark-3 dark:bg-dark/60">
                <p className="text-xs font-semibold text-dark dark:text-white">{title}</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {fields.map(([fieldKey, fieldValue]) => (
                    <div key={`${fieldKey}-${index}`}>
                      <p className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">{humanizeKey(fieldKey)}</p>
                      <div className="mt-1 text-sm">{renderValue(fieldValue, depth + 1)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <pre className="max-h-56 overflow-auto rounded-lg border border-stroke bg-gray-1 p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark dark:text-dark-6">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined);
    if (entries.length === 0) {
      return <span className="text-dark-5 dark:text-dark-6">empty object</span>;
    }

    return (
      <div className="space-y-2">
        {entries
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([fieldKey, fieldValue]) => (
            <div key={fieldKey} className="rounded border border-stroke bg-white/70 p-2 dark:border-dark-3 dark:bg-dark/60">
              <p className="text-[11px] uppercase tracking-wide text-dark-5 dark:text-dark-6">{humanizeKey(fieldKey)}</p>
              <div className="mt-1 text-sm">{renderValue(fieldValue, depth + 1)}</div>
            </div>
          ))}
      </div>
    );
  }

  return (
    <pre className="max-h-56 overflow-auto rounded-lg border border-stroke bg-gray-1 p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark dark:text-dark-6">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default function TestDataClassificationPage() {
  const [msalReady, setMsalReady] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [inputText, setInputText] = useState("");
  const [status, setStatus] = useState("Initializing auth...");
  const [workerResult, setWorkerResult] = useState<WorkerResult | null>(null);
  const [autoRunPending, setAutoRunPending] = useState(false);
  const [prefillSourceFileName, setPrefillSourceFileName] = useState<string | null>(null);
  const [activeCapsuleId, setActiveCapsuleId] = useState<string | null>(null);
  const [preferRedirectAuth, setPreferRedirectAuth] = useState(false);
  const autoRunTriggeredRef = useRef(false);
  const msalRef = useRef<PublicClientApplicationType | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const unsupportedReason = getMsalUnsupportedReason();
        if (unsupportedReason) {
          if (!cancelled) {
            setMsalReady(false);
            setStatus(`Auth unavailable: ${unsupportedReason}`);
          }
          return;
        }

        const preferRedirect = shouldUseRedirectAuthFlow();
        setPreferRedirectAuth(preferRedirect);
        const cacheLocation = preferRedirect ? "localStorage" : "sessionStorage";

        const client = new PublicClientApplication({
          auth: {
            clientId: aadClientId,
            authority: aadAuthority,
            redirectUri: window.location.origin,
            navigateToLoginRequestUrl: true
          },
          cache: {
            cacheLocation
          }
        });
        msalRef.current = client;

        await client.initialize();
        const redirectResult = await client.handleRedirectPromise();
        const existingAccounts = redirectResult?.account
          ? [redirectResult.account]
          : client.getAllAccounts();
        if (cancelled) {
          return;
        }

        if (existingAccounts.length > 0) {
          setAccount(existingAccounts[0]);
          setStatus(`Signed in as ${existingAccounts[0].username}`);
        } else {
          setStatus("Ready");
        }
        setMsalReady(true);
      } catch (error) {
        if (!cancelled) {
          setStatus(`Auth init failed: ${formatError(error)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
      msalRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.sessionStorage.getItem(dataClassificationPrefillStorageKey);
    if (!raw) {
      return;
    }

    try {
      const payload = JSON.parse(raw) as PrefillPayload;
      if (typeof payload.inputText === "string" && payload.inputText.trim().length > 0) {
        setInputText(payload.inputText);
      }
      if (typeof payload.sourceFileName === "string" && payload.sourceFileName.trim().length > 0) {
        setPrefillSourceFileName(payload.sourceFileName);
      }
      if (payload.autoRun === true) {
        setAutoRunPending(true);
        setStatus("Prefilled extracted text. Running data classification...");
      }
    } catch {
      // Ignore malformed prefill payload.
    } finally {
      window.sessionStorage.removeItem(dataClassificationPrefillStorageKey);
    }
  }, []);

  const matches = useMemo(() => {
    if (!workerResult) {
      return [];
    }

    if (Array.isArray(workerResult.matches)) {
      return workerResult.matches;
    }

    return extractMatches(workerResult.result);
  }, [workerResult]);

  const displayGroups = useMemo(() => normalizeResultGroups(matches), [matches]);
  const detailedDetectionCount = useMemo(() => {
    return displayGroups.reduce((sum, group) => sum + group.detections.length, 0);
  }, [displayGroups]);

  const totalMatches = typeof workerResult?.totalMatches === "number" ? workerResult.totalMatches : matches.length;

  const signIn = async (): Promise<void> => {
    const msalClient = msalRef.current;
    if (!msalReady || !msalClient) {
      setStatus("Auth unavailable. Use HTTPS and a browser with Web Crypto support.");
      return;
    }

    try {
      setStatus("Signing in...");
      if (preferRedirectAuth) {
        await msalClient.loginRedirect({
          scopes: ["openid", "profile", apiScope],
          redirectStartPage: getRedirectStartPage()
        });
        return;
      }

      const result = await msalClient.loginPopup({ scopes: ["openid", "profile", apiScope] });
      if (result.account) {
        setAccount(result.account);
        setStatus(`Signed in as ${result.account.username}`);
      } else {
        setStatus("Signed in");
      }
    } catch (error) {
      if (!preferRedirectAuth && shouldFallbackToRedirect(error)) {
        try {
          setStatus("Popup not supported on this device. Redirecting to sign-in...");
          await msalClient.loginRedirect({
            scopes: ["openid", "profile", apiScope],
            redirectStartPage: getRedirectStartPage()
          });
          return;
        } catch (redirectError) {
          setStatus(`Sign in failed: ${formatError(redirectError)}`);
          return;
        }
      }
      setStatus(`Sign in failed: ${formatError(error)}`);
    }
  };

  const submitClassification = async (options?: {
    overrideInputText?: string;
    overrideSourceFileName?: string | null;
  }): Promise<void> => {
    setWorkerResult(null);

    if (!account) {
      setStatus("Please sign in first");
      return;
    }

    const effectiveText = (options?.overrideInputText ?? inputText).trim();

    if (!file && effectiveText.length === 0) {
      setStatus("Provide a file upload or paste text to classify");
      return;
    }

    if (file && file.size > maxUploadMb * 1024 * 1024) {
      setStatus(`File too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Limit: ${maxUploadMb}MB.`);
      return;
    }

    try {
      const msalClient = msalRef.current;
      if (!msalClient) {
        setStatus("Auth unavailable. Use HTTPS and sign in again.");
        return;
      }

      setStatus("Acquiring token...");
      const token = await getAccessToken(msalClient, account, preferRedirectAuth);

      const params: Record<string, unknown> = {
        runAllSits: true
      };

      if (file) {
        params.fileName = file.name;
        params.fileContent = await toBase64(file);
      } else {
        params.inputText = effectiveText;
        params.fileName = options?.overrideSourceFileName ?? "pasted-text.txt";
      }

      const capsule = createCapsule({
        action: "DataClassification",
        userId: account.username,
        tenant: account.tenantId ?? "unknown-tenant",
        params
      });
      setActiveCapsuleId(capsule.capsuleId);

      setStatus("Submitting data classification capsule...");
      const response = await fetch(buildApiUrl(apiBaseUrl, "/api/capsule"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(capsule)
      });

      if (!response.ok) {
        const body = await response.text();
        setStatus(`Submit failed: ${response.status} ${body}`);
        return;
      }

      const result = (await response.json()) as { workerResult?: WorkerResult };
      const resolvedWorkerResult = result.workerResult ?? {};
      setWorkerResult(resolvedWorkerResult);

      const matchCount =
        typeof resolvedWorkerResult.totalMatches === "number"
          ? resolvedWorkerResult.totalMatches
          : (Array.isArray(resolvedWorkerResult.matches) ? resolvedWorkerResult.matches.length : extractMatches(resolvedWorkerResult.result).length);

      if (matchCount > 0) {
        setStatus(`Data classification complete: ${matchCount} match(es)`);
      } else {
        setStatus("Data classification complete: no SIT matches");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Redirecting to Microsoft sign-in")) {
        setStatus(error.message);
        return;
      }
      setStatus(`Submit failed: ${formatError(error)}`);
    }
  };

  useEffect(() => {
    if (!autoRunPending || autoRunTriggeredRef.current) {
      return;
    }

    if (!msalReady || !account) {
      return;
    }

    if (inputText.trim().length === 0) {
      return;
    }

    autoRunTriggeredRef.current = true;
    void submitClassification({
      overrideInputText: inputText,
      overrideSourceFileName: prefillSourceFileName
    });
    setAutoRunPending(false);
  }, [autoRunPending, msalReady, account, inputText, prefillSourceFileName]);

  return (
    <div className="mx-auto w-full max-w-4xl">
      <div className="rounded-2xl border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <h1 className="mb-1 text-2xl font-bold text-dark dark:text-white">Test Data Classification</h1>
        <p className="mb-6 text-sm text-dark-5 dark:text-dark-6">
          Authenticate, upload a file or paste text, then run data classification against all SITs.
        </p>

        {!account ? (
          <button
            className="inline-flex rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary/90"
            onClick={() => void signIn()}
            type="button"
            disabled={!msalReady}
          >
            Sign In
          </button>
        ) : (
          <>
            <p className="mb-4 text-sm text-dark dark:text-white">Signed in as {account.username}</p>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">Upload File</label>
                <input
                  className="w-full rounded-lg border border-stroke px-3 py-2 dark:border-dark-3 dark:bg-dark"
                  type="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-dark dark:text-white">Or Paste Text</label>
                <textarea
                  className="min-h-[180px] w-full rounded-lg border border-stroke px-3 py-2 text-sm dark:border-dark-3 dark:bg-dark"
                  placeholder="Paste text to run against all SITs"
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                />
              </div>

              <button
                className="inline-flex rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary/90"
                onClick={() => void submitClassification()}
                type="button"
              >
                Run Data Classification
              </button>
            </div>
          </>
        )}

        <p className="mt-5 text-sm text-dark dark:text-white">Status: {status}</p>
        <LiveExecutionTerminal capsuleId={activeCapsuleId} apiBaseUrl={apiBaseUrl} />

        {workerResult ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark">
              <p className="text-sm font-semibold text-dark dark:text-white">Classification Summary</p>
              <div className="mt-2 grid gap-2 text-xs text-dark-5 dark:text-dark-6 md:grid-cols-2">
                <p>{`Input Mode: ${workerResult.inputMode ?? "unknown"}`}</p>
                <p>{`Method: ${workerResult.classificationMethod ?? "unknown"}`}</p>
                <p>{`Total Matches: ${totalMatches}`}</p>
                <p>{`Detailed Detections: ${detailedDetectionCount}`}</p>
                <p>{`File: ${workerResult.fileName ?? prefillSourceFileName ?? "n/a"}`}</p>
              </div>
            </div>

            {displayGroups.length > 0 ? (
              <div className="space-y-3">
                {displayGroups.map((group) => {
                  return (
                    <article key={group.key} className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30">
                      <h2 className="text-base font-semibold text-green-900 dark:text-green-200">{group.title}</h2>
                      {group.subtitle ? (
                        <p className="mt-1 text-xs text-green-900/80 dark:text-green-200/80">{group.subtitle}</p>
                      ) : null}

                      {group.metadata.length > 0 ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {group.metadata.map((field) => (
                            <div key={`${group.key}-${field.key}`} className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">{field.label}</p>
                              <div className="mt-1 text-sm">{renderValue(field.value)}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {group.detections.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {group.detections.map((detection) => (
                            <section key={detection.key} className="rounded border border-green-200 bg-white/80 p-3 dark:border-green-900 dark:bg-dark/70">
                              <h3 className="text-sm font-semibold text-green-900 dark:text-green-200">{detection.title}</h3>
                              {detection.subtitle ? (
                                <p className="mt-1 text-xs text-green-900/80 dark:text-green-200/80">{detection.subtitle}</p>
                              ) : null}
                              {detection.matchedText ? (
                                <div className="mt-2 rounded border border-green-200 bg-green-50/70 p-2 dark:border-green-800 dark:bg-green-900/20">
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Matched Text</p>
                                  <pre className="mt-1 whitespace-pre-wrap text-xs text-green-900 dark:text-green-200">{detection.matchedText}</pre>
                                </div>
                              ) : null}

                              {detection.fields.length > 0 ? (
                                <div className="mt-3 grid gap-2 md:grid-cols-2">
                                  {detection.fields.map((field) => (
                                    <div key={`${detection.key}-${field.key}`} className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">{field.label}</p>
                                      <div className="mt-1 text-sm">{renderValue(field.value)}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </section>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-green-900/80 dark:text-green-200/80">No detailed detections returned for this item.</p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-stroke bg-white p-4 text-sm text-dark-5 dark:border-dark-3 dark:bg-dark dark:text-dark-6">
                No matches returned.
              </div>
            )}

            {matches.length > 0 ? (
              <details className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark">
                <summary className="cursor-pointer text-sm font-semibold text-dark dark:text-white">Normalized Match Objects</summary>
                <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-stroke bg-gray-1 p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                  {JSON.stringify(matches, null, 2)}
                </pre>
              </details>
            ) : null}

            <details className="rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark">
              <summary className="cursor-pointer text-sm font-semibold text-dark dark:text-white">Raw Classification Result</summary>
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-stroke bg-gray-1 p-3 text-xs text-dark dark:border-dark-3 dark:bg-dark-2 dark:text-dark-6">
                {JSON.stringify(workerResult.result ?? workerResult, null, 2)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
