export function getMsalUnsupportedReason(): string | null {
  if (typeof window === "undefined") {
    return "Authentication is unavailable outside the browser runtime.";
  }

  const hostname = window.location.hostname.toLowerCase();
  const isLoopbackHost =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (!window.isSecureContext && !isLoopbackHost) {
    return "Microsoft sign-in requires HTTPS on mobile and non-localhost hosts. Open this app over HTTPS.";
  }

  const cryptoApi = window.crypto;
  const hasGetRandomValues = !!cryptoApi && typeof cryptoApi.getRandomValues === "function";
  const hasSubtle = !!cryptoApi && typeof cryptoApi.subtle !== "undefined";
  if (!hasGetRandomValues || !hasSubtle) {
    return "Web Crypto is unavailable in this browser context. Sign-in cannot start.";
  }

  return null;
}

export function shouldUseRedirectAuthFlow(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const ua = window.navigator.userAgent.toLowerCase();
  const isIpadDesktopUa =
    window.navigator.platform === "MacIntel" && typeof window.navigator.maxTouchPoints === "number"
      ? window.navigator.maxTouchPoints > 1
      : false;

  return /android|iphone|ipad|ipod|mobile|iemobile|opera mini/.test(ua) || isIpadDesktopUa;
}

export function shouldFallbackToRedirect(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("popup") ||
    message.includes("user_cancelled") ||
    message.includes("monitor_window_timeout") ||
    message.includes("interaction_in_progress")
  );
}
