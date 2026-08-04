import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "./cookies";

// Split out of cookies.ts: next/headers requires the per-request Node
// context Server Components/Route Handlers get, and is not available to
// Edge Middleware. middleware.ts imports cookie names and setters from
// cookies.ts directly — keeping this next/headers usage in its own module
// means that import graph never pulls next/headers into the Edge bundle.
export async function getAccessToken() {
  const cookieStore = await cookies();
  return cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
}

export async function getRefreshToken() {
  const cookieStore = await cookies();
  return cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;
}
