import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

import packageJson from "../../package.json";

export function SiteFooter({ compact = false }: { compact?: boolean } = {}) {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const versionLabel = commitSha
    ? `v${packageJson.version} (${commitSha.slice(0, 7)})`
    : `v${packageJson.version}`;

  return (
    <footer className={cn("flex items-center justify-between border-t border-border px-6 py-6 sm:px-10", compact && "mx-auto h-11 w-full max-w-[1600px] shrink-0 py-1 sm:px-6")}>
      <Wordmark className="opacity-60" />
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">
          © 2026 JFLOWW ·{" "}
          <Link href="/diagnostics" className="hover:text-foreground hover:underline">
            {versionLabel}
          </Link>
        </p>
        <a
          href="https://github.com/jfloww"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub profile"
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "rounded-full",
          )}
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
