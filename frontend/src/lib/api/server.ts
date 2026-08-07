import { getAccessToken } from "@/lib/auth/server-cookies";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

type ApiRequestOptions = RequestInit & {
  authenticated?: boolean;
};

// Thrown only for a 401 on an `authenticated: true` call — i.e. the bearer
// token we sent was rejected as invalid/expired, as opposed to a 401/400 a
// credential-check endpoint like login returns for a bad password. Callers
// with access to a NextResponse (route handlers) can catch this specifically
// to clear the now-stale auth cookies and signal the client to re-authenticate.
export class ApiUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized.");
    this.name = "ApiUnauthorizedError";
  }
}

export class ApiResponseError extends Error {
  readonly status: number;
  readonly retryAfter?: string;

  constructor(message: string, status: number, retryAfter?: string) {
    super(message);
    this.name = "ApiResponseError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<TResponse> {
  const headers = new Headers(options.headers);

  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (options.authenticated) {
    const accessToken = await getAccessToken();

    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    if (options.authenticated && response.status === 401) {
      throw new ApiUnauthorizedError();
    }
    const message = await readErrorMessage(response);
    throw new ApiResponseError(
      message,
      response.status,
      response.headers.get("Retry-After") ?? undefined,
    );
  }

  // 204: standard no-content. 205: Django's logout endpoint returns this on
  // success and also sends no body.
  if (response.status === 204 || response.status === 205) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

async function readErrorMessage(response: Response) {
  try {
    const data = await response.json();

    if (typeof data.detail === "string") {
      return data.detail;
    }

    if (typeof data.error === "string") {
      return data.error;
    }

    return "Request failed.";
  } catch {
    return "Request failed.";
  }
}
