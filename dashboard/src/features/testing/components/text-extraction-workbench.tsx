"use client";

import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo
} from "@azure/msal-browser";
import { useEffect, useState } from "react";
import LiveExecutionTerminal from "@/features/testing/components/live-execution-terminal";
import { buildApiUrl } from "@/features/testing/lib/api-url";

type WorkerResult = {
  status?: string;
  text?: string;
  ExtractedStreamText?: string;
  StreamTextLength?: number;
  StreamId?: number;
  StreamName?: string;
  Streams?: Array<{
    StreamId?: number;
    StreamName?: string;
    StreamTextLength?: number;
    ExtractedStreamText?: string;
  }>;
  message?: string;
  extractionMethod?: string;
};

const aadClientId = process.env.NEXT_PUBLIC_AAD_CLIENT_ID ?? "63eefc68-2d4b-45c0-a619-65b45c5fada9";
const aadAuthority = process.env.NEXT_PUBLIC_AAD_AUTHORITY ?? "https://login.microsoftonline.com/organizations";
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const apiScope = process.env.NEXT_PUBLIC_API_SCOPE ?? `api://${aadClientId}/Capsule.Submit`;
const maxUploadMb = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 10);
const dataClassificationPath = "/testing/test-data-classification";
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

function createCapsule(input: { userId: string; tenant: string; fileName: string; fileContent: string }) {
  const now = new Date();
  const capsuleId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `capsule-${Date.now()}`;

  return {
    schemaVersion: "1.0",
    capsuleId,
    tenant: input.tenant,
    userId: input.userId,
    action: "TextExtraction",
    params: {
      fileName: input.fileName,
      fileContent: input.fileContent
    },
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    signature: `dummy-signature:${capsuleId}`
  };
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

function getFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0) {
    return "";
  }
  return fileName.slice(lastDot).toLowerCase();
}

function getLeafName(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || value;
}

type DisplaySection = {
  key: string;
  title: string;
  text: string;
  streamName: string;
  streamId: number;
  streamTextLength: number;
};

function buildDisplaySections(
  ext: string,
  streams: NonNullable<WorkerResult["Streams"]>
): DisplaySection[] {
  if (streams.length === 0) {
    return [];
  }

  const isMessageContainer = ext === ".msg" || ext === ".eml";
  const isArchiveContainer = ext === ".zip" || ext === ".7z" || ext === ".rar";
  const sorted = [...streams].sort((a, b) => {
    const ida = typeof a.StreamId === "number" ? a.StreamId : 0;
    const idb = typeof b.StreamId === "number" ? b.StreamId : 0;
    if (ida !== idb) {
      return ida - idb;
    }
    return (a.StreamName ?? "").localeCompare(b.StreamName ?? "");
  });

  const leafNameCounts = new Map<string, number>();
  for (const stream of sorted) {
    const rawName = stream.StreamName ?? "Stream";
    const leaf = getLeafName(rawName);
    leafNameCounts.set(leaf, (leafNameCounts.get(leaf) ?? 0) + 1);
  }

  return sorted.map((stream, index) => {
    const rawName = stream.StreamName ?? `Stream ${index + 1}`;
    let title = rawName;
    const streamId = typeof stream.StreamId === "number" ? stream.StreamId : index;
    const streamTextLength = typeof stream.StreamTextLength === "number"
      ? stream.StreamTextLength
      : (stream.ExtractedStreamText ?? "").length;

    if (isMessageContainer) {
      title = rawName === "Message Body" ? "Message Body" : getLeafName(rawName);
    } else if (isArchiveContainer) {
      const leaf = getLeafName(rawName);
      const duplicateCount = leafNameCounts.get(leaf) ?? 0;
      title = duplicateCount > 1 ? `${leaf} (${rawName})` : leaf;
    }

    return {
      key: `${rawName}-${stream.StreamId ?? index}-${index}`,
      title,
      text: stream.ExtractedStreamText ?? "",
      streamName: rawName,
      streamId,
      streamTextLength
    };
  });
}

export default function TextExtractionWorkbench() {
  const [msalReady, setMsalReady] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [runDataClassificationAfterExtraction, setRunDataClassificationAfterExtraction] = useState(false);
  const [status, setStatus] = useState("Initializing auth...");
  const [extractedText, setExtractedText] = useState("");
  const [streamName, setStreamName] = useState("Message Body");
  const [streamTextLength, setStreamTextLength] = useState(0);
  const [streamItems, setStreamItems] = useState<NonNullable<WorkerResult["Streams"]>>([]);
  const [expandedSectionKeys, setExpandedSectionKeys] = useState<string[]>([]);
  const [activeCapsuleId, setActiveCapsuleId] = useState<string | null>(null);

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

  const signIn = async (): Promise<void> => {
    if (!msalReady) {
      setStatus("Auth still initializing");
      return;
    }

    try {
      setStatus("Signing in...");
      const result = await msal.loginPopup({ scopes: ["openid", "profile", apiScope] });
      setAccount(result.account);
      setStatus("Signed in");
    } catch (error) {
      setStatus(`Sign in failed: ${formatError(error)}`);
    }
  };

  const submit = async (): Promise<void> => {
    setExtractedText("");
    setStreamTextLength(0);
    setStreamName("Message Body");
    setStreamItems([]);
    setExpandedSectionKeys([]);

    if (!account) {
      setStatus("Please sign in first");
      return;
    }

    if (!file) {
      setStatus("Please select a file");
      return;
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      setStatus(`File too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Limit: ${maxUploadMb}MB.`);
      return;
    }

    try {
      setStatus("Acquiring token...");
      const token = await getAccessToken(account);

      const fileContent = await toBase64(file);
      const capsule = createCapsule({
        userId: account.username,
        tenant: account.tenantId ?? "unknown-tenant",
        fileName: file.name,
        fileContent
      });
      setActiveCapsuleId(capsule.capsuleId);

      setStatus("Submitting extraction capsule...");
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
      const workerResult = result.workerResult ?? {};
      const text = typeof workerResult.ExtractedStreamText === "string"
        ? workerResult.ExtractedStreamText
        : (typeof workerResult.text === "string" ? workerResult.text : "");
      const extractionMethod = workerResult.extractionMethod ?? "unknown";
      const resolvedStreamName = typeof workerResult.StreamName === "string" && workerResult.StreamName.trim().length > 0
        ? workerResult.StreamName
        : "Message Body";
      const resolvedStreamLength = typeof workerResult.StreamTextLength === "number"
        ? workerResult.StreamTextLength
        : text.length;
      const streams = Array.isArray(workerResult.Streams) ? workerResult.Streams : [];

      setExtractedText(text);
      setStreamName(resolvedStreamName);
      setStreamTextLength(resolvedStreamLength);
      setStreamItems(streams);
      if (text.trim().length > 0 && runDataClassificationAfterExtraction) {
        const payload = {
          inputText: text,
          sourceFileName: file.name,
          autoRun: true,
          runAllSits: true
        };
        sessionStorage.setItem(dataClassificationPrefillStorageKey, JSON.stringify(payload));
        setStatus("Extracted text ready. Redirecting to data classification...");
        window.location.assign(dataClassificationPath);
        return;
      }

      if (text.trim().length > 0) {
        setStatus(`Text extraction complete (${extractionMethod})`);
      } else if (workerResult.message) {
        setStatus(workerResult.message);
      } else {
        setStatus(`Extraction returned empty text (${extractionMethod})`);
      }
    } catch (error) {
      setStatus(`Submit failed: ${formatError(error)}`);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border border-stroke bg-white p-6 shadow-sm dark:border-dark-3 dark:bg-dark-2">
        <h1 className="mb-1 text-2xl font-bold text-dark dark:text-white">Test Text Extraction</h1>
        <p className="mb-6 text-sm text-dark-5 dark:text-dark-6">
          Authenticate, upload a file, and run text extraction via the SICO API.
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

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  className="inline-flex rounded-lg bg-primary px-5 py-2.5 font-medium text-white hover:bg-primary/90"
                  onClick={() => void submit()}
                  type="button"
                >
                  Extract Text
                </button>

                <label className="inline-flex items-center gap-2 text-sm text-dark dark:text-white">
                  <input
                    type="checkbox"
                    checked={runDataClassificationAfterExtraction}
                    onChange={(event) => setRunDataClassificationAfterExtraction(event.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-stroke text-primary focus:ring-primary dark:border-dark-3"
                  />
                  <span>Run data classification after extraction</span>
                </label>
              </div>
            </div>
          </>
        )}

        <p className="mt-5 text-sm text-dark dark:text-white">Status: {status}</p>
        <LiveExecutionTerminal capsuleId={activeCapsuleId} apiBaseUrl={apiBaseUrl} />

        {extractedText && streamItems.length === 0 ? (
          <div className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4 dark:border-green-700 dark:bg-green-950/30">
            <p className="text-sm font-semibold text-green-900 dark:text-green-200">Extracted Text</p>
            <p className="mt-1 text-xs text-green-900/80 dark:text-green-200/80">
              {`Stream: ${streamName} | Length: ${streamTextLength}`}
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-green-800 dark:text-green-100">{extractedText}</pre>
          </div>
        ) : null}

        {streamItems.length > 0 && file ? (
          <div className="mt-4 rounded-lg border border-stroke bg-white p-4 dark:border-dark-3 dark:bg-dark">
            {(() => {
              const ext = getFileExtension(file.name);
              const isMessageContainer = ext === ".msg" || ext === ".eml";
              const isArchiveContainer = ext === ".zip" || ext === ".7z" || ext === ".rar";
              const sections = buildDisplaySections(ext, streamItems);
              const allExpanded = sections.length > 0 && expandedSectionKeys.length === sections.length;
              const headerLabel = isMessageContainer
                ? "Message Parts"
                : isArchiveContainer
                  ? "Archive Files"
                  : "Stream Parts";

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-dark dark:text-white">{headerLabel}</p>
                    <button
                      className="rounded-md border border-stroke px-3 py-1 text-xs font-medium text-dark hover:bg-gray-2 dark:border-dark-3 dark:text-white dark:hover:bg-dark-2"
                      onClick={() => {
                        if (allExpanded) {
                          setExpandedSectionKeys([]);
                          return;
                        }
                        setExpandedSectionKeys(sections.map((section) => section.key));
                      }}
                      type="button"
                    >
                      {allExpanded ? "Collapse All" : "Expand All"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {sections.map((section) => {
                      const isExpanded = expandedSectionKeys.includes(section.key);
                      return (
                        <div key={section.key} className="rounded-lg border border-stroke p-3 dark:border-dark-3">
                          <button
                            className="flex w-full items-center justify-between text-left text-sm font-medium text-dark dark:text-white"
                            onClick={() => {
                              setExpandedSectionKeys((prev) =>
                                prev.includes(section.key)
                                  ? prev.filter((key) => key !== section.key)
                                  : [...prev, section.key]
                              );
                            }}
                            type="button"
                          >
                            <span>{section.title}</span>
                            <span className="text-xs text-dark-5 dark:text-dark-6">{isExpanded ? "Hide" : "Show"}</span>
                          </button>

                          {isExpanded ? (
                            <>
                              <p className="mt-2 text-[11px] text-dark-5 dark:text-dark-6">
                                {`StreamName: ${section.streamName} | StreamId: ${section.streamId} | Length: ${section.streamTextLength}`}
                              </p>
                              <pre className="mt-2 whitespace-pre-wrap text-xs text-dark-5 dark:text-dark-6">{section.text}</pre>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
