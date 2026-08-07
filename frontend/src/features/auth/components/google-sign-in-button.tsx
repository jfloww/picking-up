"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { safeAuthRedirect } from "../lib/safe-redirect";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme: string; size: string; width?: number },
          ) => void;
        };
      };
    };
  }
}

export async function submitGoogleCredential(
  credential: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : "Google sign-in failed.",
    };
  }

  return { ok: true };
}

export function GoogleSignInButton() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!scriptLoaded || !clientId || !window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response) => {
        setError(undefined);
        const result = await submitGoogleCredential(response.credential);

        if (!result.ok) {
          setError(result.error);
          return;
        }

        router.replace(safeAuthRedirect(searchParams.get("next")));
        router.refresh();
      },
    });
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      width: 320,
    });
  }, [scriptLoaded, router, searchParams]);

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;

  return (
    <>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          // onReady (not onLoad): next/script only fires onLoad the first
          // time this script ever loads in the tab's session. After
          // logout does a client-side nav back to /login, this component
          // remounts with the script already cached — onLoad never fires
          // again, so the button silently never (re-)initializes. onReady
          // fires on every mount once the script is ready, covering both
          // the first load and every later remount.
          onReady={() => setScriptLoaded(true)}
        />
        <div ref={containerRef} />
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : null}
      </div>
    </>
  );
}
