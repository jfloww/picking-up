"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export function ErrorPage({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry?: () => void;
}) {
  const router = useRouter();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <Wordmark />
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="rounded-full px-6"
          onClick={() => router.back()}
        >
          Go back
        </Button>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="rounded-full px-6"
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : null}
        <Link href="/" className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}>
          Go to home
        </Link>
      </div>
    </div>
  );
}
