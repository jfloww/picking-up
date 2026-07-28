"use client";

import { useEffect } from "react";

import { ErrorPage } from "@/components/error-page";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorPage
      title="Something went wrong"
      description="An unexpected error occurred. You can try again, or head back to where you were."
      onRetry={reset}
    />
  );
}
