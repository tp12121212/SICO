"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
  type PublicClientApplication as PublicClientApplicationType
} from "@azure/msal-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LiveExecutionTerminal from "@/features/testing/components/live-execution-terminal";
import { buildApiUrl } from "@/features/testing/lib/api-url";
import {
  getMsalUnsupportedReason,
  shouldFallbackToRedirect,
  shouldUseRedirectAuthFlow
} from "@/features/testing/lib/msal-support";
import {
  normalizeClassificationView,
  type NormalizedClassificationResult,
  type NormalizedMatchGroup
} from "./normalization";

type WorkerResult = {
  status?: string;
  classificationMethod?: string;
  inputMode?: string;
  fileName?: string;
  totalMatches?: number;
  hasMatches?: boolean;
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

function renderMatchValue(value: string) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded border border-green-200 bg-white/70 p-2 text-xs text-green-900 dark:border-green-900 dark:bg-dark/60 dark:text-green-200">
      {value}
    </pre>
  );
}

function renderMatchGroup(matchGroup: NormalizedMatchGroup, index: number, resultKey: string) {
  return (
    <div key={`${resultKey}-match-${index}`} className="rounded border border-green-200 bg-white/80 p-3 dark:border-green-900 dark:bg-dark/70">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Primary Element Match</p>
      <div className="mt-1">{renderMatchValue(matchGroup.primaryMatch)}</div>

      {matchGroup.supportingMatches.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Supporting Element Matches</p>
          <div className="mt-1 space-y-2">
            {matchGroup.supportingMatches.map((supportingMatch, supportingIndex) => (
              <div key={`${resultKey}-match-${index}-support-${supportingIndex}`}>{renderMatchValue(supportingMatch)}</div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderResultSummary(result: NormalizedClassificationResult) {
  const confidenceLabel = result.confidenceLevel !== null ? String(result.confidenceLevel) : "n/a";
  const streamLabel = result.streamName.length > 0 ? result.streamName : "n/a";

  return (
    <div className="mt-3 grid gap-2 md:grid-cols-2">
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Classification Name</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-green-900 dark:text-green-200">{result.classificationName}</p>
      </div>
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Confidence Level</p>
        <p className="mt-1 text-sm text-green-900 dark:text-green-200">{confidenceLabel}</p>
      </div>
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Count</p>
        <p className="mt-1 text-sm text-green-900 dark:text-green-200">{String(result.count)}</p>
      </div>
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Classifier Type</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-green-900 dark:text-green-200">{result.classifierType}</p>
      </div>
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Stream Name</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-green-900 dark:text-green-200">{streamLabel}</p>
      </div>
      <div className="rounded border border-green-200 bg-white/70 p-2 dark:border-green-900 dark:bg-dark/60">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">Source File</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-green-900 dark:text-green-200">{result.sourceFile ?? "n/a"}</p>
      </div>
    </div>
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
  const [expandedResultKeys, setExpandedResultKeys] = useState<Record<string, boolean>>({});
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

  const normalizedView = useMemo(() => {
    return normalizeClassificationView({
      result: workerResult?.result,
      workerFileName: workerResult?.fileName ?? null,
      fallbackSourceFileName: prefillSourceFileName
    });
  }, [workerResult, prefillSourceFileName]);

  useEffect(() => {
    setExpandedResultKeys((current) => {
      const next: Record<string, boolean> = {};
      normalizedView.results.forEach((result) => {
        next[result.key] = current[result.key] ?? false;
      });
      return next;
    });
  }, [normalizedView.results]);

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

  const submitClassification = useCallback(async (options?: {
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

      const normalized = normalizeClassificationView({
        result: resolvedWorkerResult.result,
        workerFileName: resolvedWorkerResult.fileName,
        fallbackSourceFileName: options?.overrideSourceFileName ?? prefillSourceFileName
      });

      const matchCount = normalized.summary.totalReportedMatchCount;
      if (matchCount > 0) {
        setStatus(`Data classification complete: ${matchCount} reported match(es)`);
      } else if (normalized.summary.renderedMatchGroups > 0) {
        setStatus(`Data classification complete: ${normalized.summary.renderedMatchGroups} rendered match group(s)`);
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
  }, [account, file, inputText, prefillSourceFileName, preferRedirectAuth]);

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
  }, [autoRunPending, msalReady, account, inputText, prefillSourceFileName, submitClassification]);

  const expandAllResults = () => {
    const next: Record<string, boolean> = {};
    normalizedView.results.forEach((result) => {
      next[result.key] = true;
    });
    setExpandedResultKeys(next);
  };

  const collapseAllResults = () => {
    const next: Record<string, boolean> = {};
    normalizedView.results.forEach((result) => {
      next[result.key] = false;
    });
    setExpandedResultKeys(next);
  };

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
                <p>{`Classification Results: ${normalizedView.summary.totalClassificationResults}`}</p>
                <p>{`Total Reported Match Count: ${normalizedView.summary.totalReportedMatchCount}`}</p>
                <p>{`Unique Classifications: ${normalizedView.summary.uniqueClassificationNames}`}</p>
                <p>{`Confidence Tiers: ${normalizedView.summary.confidenceTierCount}`}</p>
                <p>{`Rendered Match Groups: ${normalizedView.summary.renderedMatchGroups}`}</p>
                <p>{`File: ${normalizedView.sourceFileName ?? "n/a"}`}</p>
              </div>
            </div>

            {normalizedView.results.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex rounded border border-stroke bg-white px-3 py-1.5 text-xs font-medium text-dark hover:bg-gray-1 dark:border-dark-3 dark:bg-dark dark:text-white dark:hover:bg-dark-3"
                    type="button"
                    onClick={expandAllResults}
                  >
                    Expand all
                  </button>
                  <button
                    className="inline-flex rounded border border-stroke bg-white px-3 py-1.5 text-xs font-medium text-dark hover:bg-gray-1 dark:border-dark-3 dark:bg-dark dark:text-white dark:hover:bg-dark-3"
                    type="button"
                    onClick={collapseAllResults}
                  >
                    Collapse all
                  </button>
                </div>

                {normalizedView.results.map((result, index) => {
                  const isExpanded = expandedResultKeys[result.key] ?? false;
                  const confidenceLabel = result.confidenceLevel !== null ? `${result.confidenceLevel}` : "n/a";

                  return (
                    <details
                      key={result.key}
                      open={isExpanded}
                      onToggle={(event) => {
                        const target = event.currentTarget;
                        setExpandedResultKeys((current) => ({
                          ...current,
                          [result.key]: target.open
                        }));
                      }}
                      className="rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30"
                    >
                      <summary className="cursor-pointer list-none pr-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h2 className="text-base font-semibold text-green-900 dark:text-green-200">{result.classificationName}</h2>
                            <p className="mt-1 text-xs text-green-900/80 dark:text-green-200/80">{`Result ${index + 1} | Confidence ${confidenceLabel} | Count ${result.count}`}</p>
                          </div>
                          <span className="text-xs font-semibold uppercase tracking-wide text-green-900/80 dark:text-green-200/80">
                            {isExpanded ? "Expanded" : "Collapsed"}
                          </span>
                        </div>
                      </summary>

                      {renderResultSummary(result)}

                      {result.matchGroups.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {result.matchGroups.map((matchGroup, matchIndex) => renderMatchGroup(matchGroup, matchIndex, result.key))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-green-900/80 dark:text-green-200/80">No match groups returned for this classification result.</p>
                      )}
                    </details>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-stroke bg-white p-4 text-sm text-dark-5 dark:border-dark-3 dark:bg-dark dark:text-dark-6">
                No classification results returned.
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
