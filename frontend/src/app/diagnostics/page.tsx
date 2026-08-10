import { requestHealth } from "@/lib/api/health";
import packageJson from "../../../package.json";

export default async function DiagnosticsPage() {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA;
  const frontendCommit = commitSha ? commitSha.slice(0, 7) : "unknown";

  let backend: { version: string; commit: string; environment: string } | null = null;
  let backendError: string | null = null;
  try {
    backend = await requestHealth();
  } catch (error) {
    backendError = error instanceof Error ? error.message : "Failed to reach the backend.";
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold">Diagnostics</h1>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Frontend</dt>
          <dd className="font-mono">
            {packageJson.version} ({frontendCommit})
          </dd>
        </div>
        <div className="flex justify-between border-b border-border py-2">
          <dt className="text-muted-foreground">Backend</dt>
          <dd className="font-mono">
            {backend
              ? `${backend.version} (${backend.commit.slice(0, 7)}) · ${backend.environment}`
              : `unavailable — ${backendError}`}
          </dd>
        </div>
      </dl>
    </div>
  );
}
