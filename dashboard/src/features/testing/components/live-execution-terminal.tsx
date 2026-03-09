"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildApiUrl } from "@/features/testing/lib/api-url";

type TerminalLogLevel = "info" | "warn" | "error" | "success";

type TerminalEvent = {
  capsuleId: string;
  eventId: number;
  timestamp: string;
  level: TerminalLogLevel;
  phase: string;
  message: string;
  data?: unknown;
  done?: boolean;
};

type Props = {
  capsuleId: string | null;
  apiBaseUrl: string;
  title?: string;
};

function stringifyData(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatEventLine(event: TerminalEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const level = event.level.toUpperCase().padEnd(7, " ");
  const phase = event.phase.toUpperCase();
  const details = stringifyData(event.data);
  const suffix = details.length > 0 ? ` ${details}` : "";
  return `${time} [${level}] [${phase}] ${event.message}${suffix}`;
}

function compareEvents(a: TerminalEvent, b: TerminalEvent): number {
  if (a.eventId !== b.eventId) {
    return a.eventId - b.eventId;
  }
  return a.timestamp.localeCompare(b.timestamp);
}

export default function LiveExecutionTerminal({
  capsuleId,
  apiBaseUrl,
  title = "Live Execution Terminal"
}: Props) {
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "closed">("idle");
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const seenIdsRef = useRef<Set<number>>(new Set());
  const localEventIdRef = useRef(-1);

  useEffect(() => {
    setEvents([]);
    seenIdsRef.current = new Set();
    localEventIdRef.current = -1;
    if (!capsuleId) {
      setConnectionState("idle");
      return;
    }

    let disposed = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let source: EventSource | null = null;

    const eventsUrl = buildApiUrl(apiBaseUrl, `/api/capsule/${encodeURIComponent(capsuleId)}/events`);
    const streamUrl = buildApiUrl(apiBaseUrl, `/api/capsule/${encodeURIComponent(capsuleId)}/stream`);
    setConnectionState("connecting");

    const ingest = (incoming: TerminalEvent | TerminalEvent[]) => {
      const list = Array.isArray(incoming) ? incoming : [incoming];
      setEvents((previous) => {
        const next = [...previous];
        for (const event of list) {
          if (!event || typeof event.eventId !== "number") {
            continue;
          }
          if (seenIdsRef.current.has(event.eventId)) {
            continue;
          }
          seenIdsRef.current.add(event.eventId);
          next.push(event);
        }
        next.sort(compareEvents);
        return next;
      });
    };

    const appendLocalMessage = (level: TerminalLogLevel, phase: string, message: string) => {
      ingest({
        capsuleId,
        eventId: localEventIdRef.current--,
        timestamp: new Date().toISOString(),
        level,
        phase,
        message
      });
    };

    const fetchSnapshot = async () => {
      try {
        const response = await fetch(eventsUrl, { cache: "no-store" });
        if (!response.ok) {
          return false;
        }
        const payload = (await response.json()) as { events?: TerminalEvent[] };
        const snapshotEvents = payload.events ?? [];
        ingest(snapshotEvents);

        const hasDone = snapshotEvents.some((event) => event?.done === true);
        if (hasDone) {
          setConnectionState("closed");
          if (source) {
            source.close();
            source = null;
          }
          if (pollHandle) {
            clearInterval(pollHandle);
            pollHandle = null;
          }
        }
        return true;
      } catch {
        return false;
      }
    };

    void (async () => {
      const ok = await fetchSnapshot();
      if (!ok) {
        appendLocalMessage("warn", "terminal", "Unable to fetch capsule events snapshot yet. Waiting for stream...");
      }
    })();

    pollHandle = setInterval(() => {
      if (disposed) {
        return;
      }
      void fetchSnapshot();
    }, 1000);

    try {
      source = new EventSource(streamUrl);
    } catch {
      appendLocalMessage("warn", "terminal", "SSE stream unavailable. Using polling fallback.");
      setConnectionState("connecting");
      return () => {
        disposed = true;
        if (pollHandle) {
          clearInterval(pollHandle);
        }
        setConnectionState("closed");
      };
    }

    source.onopen = () => {
      setConnectionState("connected");
    };

    source.addEventListener("ready", () => {
      setConnectionState("connected");
    });

    source.addEventListener("snapshot", (event) => {
      try {
        const payload = JSON.parse(event.data) as { events?: TerminalEvent[] };
        ingest(payload.events ?? []);
      } catch {
        // Ignore malformed payloads.
      }
    });

    source.addEventListener("log", (event) => {
      try {
        ingest(JSON.parse(event.data) as TerminalEvent);
      } catch {
        // Ignore malformed payloads.
      }
    });

    source.addEventListener("done", (event) => {
      try {
        ingest(JSON.parse(event.data) as TerminalEvent);
      } catch {
        // Ignore malformed payloads.
      }
      setConnectionState("closed");
      if (source) {
        source.close();
        source = null;
      }
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    });

    source.onerror = () => {
      // Keep the stream open and allow EventSource auto-reconnect behavior.
      setConnectionState("connecting");
      appendLocalMessage("warn", "terminal", "Stream reconnecting...");
    };

    return () => {
      disposed = true;
      if (source) {
        source.close();
      }
      if (pollHandle) {
        clearInterval(pollHandle);
      }
      setConnectionState("closed");
    };
  }, [capsuleId, apiBaseUrl]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [events]);

  const connectionLabel = useMemo(() => {
    if (!capsuleId) {
      return "No active request";
    }
    if (connectionState === "connecting") {
      return "Connecting...";
    }
    if (connectionState === "connected") {
      return "Live";
    }
    if (connectionState === "closed") {
      return "Closed";
    }
    return "Idle";
  }, [capsuleId, connectionState]);

  return (
    <section className="mt-5 rounded-lg border border-stroke bg-gray-1 p-4 dark:border-dark-3 dark:bg-dark">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-dark dark:text-white">{title}</p>
          <p className="text-[11px] text-dark-5 dark:text-dark-6">
            {capsuleId ? `Capsule: ${capsuleId}` : "Submit a test run to start streaming execution logs."}
          </p>
        </div>
        <span
          className={[
            "rounded-full px-2.5 py-1 text-[11px] font-medium",
            connectionState === "connected"
              ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200"
              : connectionState === "connecting"
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200"
                : "bg-gray-200 text-gray-700 dark:bg-dark-2 dark:text-dark-6"
          ].join(" ")}
        >
          {connectionLabel}
        </span>
      </div>

      <div
        ref={terminalRef}
        className="max-h-72 overflow-auto rounded-md border border-dark-3 bg-[#050b16] p-3 font-mono text-xs text-green-200"
      >
        {events.length > 0 ? (
          <div className="space-y-1">
            {events.map((event) => (
              <p key={event.eventId} className="whitespace-pre-wrap break-words">
                {formatEventLine(event)}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-green-200/70">$ waiting for execution logs...</p>
        )}
      </div>
    </section>
  );
}
