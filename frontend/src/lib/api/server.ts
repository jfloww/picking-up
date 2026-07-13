import { getAccessToken } from "@/lib/auth/cookies";

const API_BASE_URL = process.env.DJANGO_API_BASE_URL ?? "http://localhost:8000";

type ApiRequestOptions = RequestInit & {
  authenticated?: boolean;
};

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
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) {
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
