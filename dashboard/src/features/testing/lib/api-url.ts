function resolveImplicitApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }

  if (window.location.protocol !== "http:") {
    return "";
  }

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://localhost:3001";
  }

  return "";
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const effectiveBase = trimmedBase.length > 0 ? trimmedBase : resolveImplicitApiBase();

  if (effectiveBase.length === 0) {
    return normalizedPath;
  }

  if (effectiveBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${effectiveBase}${normalizedPath.slice(4)}`;
  }

  return `${effectiveBase}${normalizedPath}`;
}
