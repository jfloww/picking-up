"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertTitle } from "@/components/ui/alert";

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

        router.replace(searchParams.get("next") ?? "/planner");
        router.refresh();
      },
    });
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      width: 320,
    });
  }, [scriptLoaded, router, searchParams]);

  return (
    <div className="flex flex-col items-center gap-2">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div ref={containerRef} />
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      ) : null}
    </div>
  );
}
