"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo
} from "@azure/msal-browser";
import { useEffect, useMemo, useRef, useState } from "react";

type ClassificationMatch = Record<string, unknown>;

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
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const apiScope = process.env.NEXT_PUBLIC_API_SCOPE ?? `api://${aadClientId}/Capsule.Submit`;
const maxUploadMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10);
const dataClassificationPrefillStorageKey = "sico.testing.dataClassification.prefill";

const msal = new PublicClientApplication({
  auth: {
    clientId: aadClientId,
    authority: aadAuthority,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"
  },
  cache: {
    cacheLocation: "sessionStorage"
  }
});

async function getAccessToken(account: AccountInfo): Promise<string> {
  try {
    const result = await msal.acquireTokenSilent({
      account,
      scopes: ["openid", "profile", apiScope]
    });
    return result.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const result = await msal.acquireTokenPopup({ scopes: ["openid", "profile", apiScope] });
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

function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="text-dark-5 dark:text-dark-6">null</span>;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="break-words text-dark dark:text-white">{String(value)}</span>;
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
  const autoRunTriggeredRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        await msal.initialize();
        const existingAccounts = msal.getAllAccounts();
        if (existingAccounts.length > 0) {
          setAccount(existingAccounts[0]);
          setStatus(`Signed in as ${existingAccounts[0].username}`);
        } else {
          setStatus("Ready");
        }
        setMsalReady(true);
      } catch (error) {
        setStatus(`Auth init failed: ${formatError(error)}`);
      }
    })();
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

  const totalMatches = typeof workerResult?.totalMatches === "number" ? workerResult.totalMatches : matches.length;

  const signIn = async (): Promise<void> => {
    if (!msalReady) {
      setStatus("Auth still initializing");
      return;
    }

    try {
      setStatus("Signing in...");
      const result = await msal.loginPopup({ scopes: ["openid", "profile", apiScope] });
      setAccount(result.account);
      setStatus(`Signed in as ${result.account?.username ?? "user"}`);
    } catch (error) {
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
      setStatus("Acquiring token...");
      const token = await getAccessToken(account);

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

      setStatus("Submitting data classification capsule...");
      const response = await fetch(`${apiBaseUrl}/api/capsule`, {
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

        {workerResult ? (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark">
              <p className="text-sm font-semibold text-dark dark:text-white">Classification Summary</p>
              <div className="mt-2 grid gap-2 text-xs text-dark-5 dark:text-dark-6 md:grid-cols-2">
                <p>{`Input Mode: ${workerResult.inputMode ?? "unknown"}`}</p>
                <p>{`Method: ${workerResult.classificationMethod ?? "unknown"}`}</p>
                <p>{`Total Matches: ${totalMatches}`}</p>
                <p>{`File: ${workerResult.fileName ?? prefillSourceFileName ?? "n/a"}`}</p>
              </div>
            </div>

            {matches.length > 0 ? (
              <div className="space-y-3">
                {matches.map((match, index) => {
                  const entries = Object.entries(match).sort(([a], [b]) => a.localeCompare(b));
                  return (
                    <article key={`match-${index}`} className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30">
                      <h2 className="text-sm font-semibold text-green-900 dark:text-green-200">{getMatchTitle(match, index)}</h2>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {entries.map(([key, value]) => (
                          <div key={`${index}-${key}`} className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">{key}</p>
                            <div className="mt-1 text-sm">{renderValue(value)}</div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-stroke bg-white p-4 text-sm text-dark-5 dark:border-dark-3 dark:bg-dark dark:text-dark-6">
                No matches returned.
              </div>
            )}

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
