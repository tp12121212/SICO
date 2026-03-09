"use client";

import { PublicClientApplication } from "@azure/msal-browser";
import { useEffect } from "react";
import { getMsalUnsupportedReason } from "@/features/testing/lib/msal-support";

const aadClientId = process.env.NEXT_PUBLIC_AAD_CLIENT_ID ?? "63eefc68-2d4b-45c0-a619-65b45c5fada9";
const aadAuthority = process.env.NEXT_PUBLIC_AAD_AUTHORITY ?? "https://login.microsoftonline.com/organizations";
const redirectProcessedKey = "sico.auth.redirect.processing";

function hasAuthHash(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hash = window.location.hash.toLowerCase();
  return (
    hash.includes("code=") ||
    hash.includes("error=") ||
    hash.includes("id_token=") ||
    hash.includes("access_token=")
  );
}

export function MsalRedirectHandler() {
  useEffect(() => {
    let disposed = false;

    void (async () => {
      if (typeof window === "undefined") {
        return;
      }

      if (!hasAuthHash()) {
        return;
      }

      // Testing pages process redirect responses themselves.
      if (window.location.pathname.startsWith("/testing/")) {
        return;
      }

      const unsupportedReason = getMsalUnsupportedReason();
      if (unsupportedReason) {
        return;
      }

      const locationSignature = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (window.sessionStorage.getItem(redirectProcessedKey) === locationSignature) {
        return;
      }
      window.sessionStorage.setItem(redirectProcessedKey, locationSignature);

      try {
        const client = new PublicClientApplication({
          auth: {
            clientId: aadClientId,
            authority: aadAuthority,
            redirectUri: window.location.origin,
            navigateToLoginRequestUrl: true
          },
          cache: {
            cacheLocation: "localStorage"
          }
        });

        await client.initialize();
        await client.handleRedirectPromise();
      } catch {
        // Swallow redirect parser errors here; page-level auth surfaces actionable status.
      } finally {
        if (!disposed) {
          window.sessionStorage.removeItem(redirectProcessedKey);
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  return null;
}
