import { apiRequest } from "@/lib/api/server";
import { getAccessToken } from "@/lib/auth/cookies";

import type { CurrentUser, TokenPair } from "../types";

export function requestLogin(credentials: { email: string; password: string }) {
  return apiRequest<TokenPair>("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function requestRegister(credentials: { email: string; password: string }) {
  return apiRequest<CurrentUser>("/api/auth/register/", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function requestCurrentUser() {
  return apiRequest<CurrentUser>("/api/auth/me/", {
    authenticated: true,
  });
}

export async function getCurrentUserOrNull(
  fetchUser: () => Promise<CurrentUser> = requestCurrentUser,
): Promise<CurrentUser | null> {
  if (fetchUser === requestCurrentUser && !(await getAccessToken())) {
    return null;
  }

  try {
    return await fetchUser();
  } catch {
    return null;
  }
}
