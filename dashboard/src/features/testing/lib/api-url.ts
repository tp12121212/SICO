export function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");

  if (trimmedBase.length === 0) {
    return normalizedPath;
  }

  if (trimmedBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${trimmedBase}${normalizedPath.slice(4)}`;
  }

  return `${trimmedBase}${normalizedPath}`;
}
