import { buttonVariants } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { cn } from "@/lib/utils";

export function SiteFooter() {
  return (
    <footer className="flex items-center justify-between border-t border-border px-6 py-6 sm:px-10">
      <Wordmark className="opacity-60" />
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground">© 2026 Picking Up</p>
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
