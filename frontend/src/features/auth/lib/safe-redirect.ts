export const DEFAULT_AUTH_REDIRECT = "/planner";

/** Accept only same-origin absolute paths from the user-controlled `next` parameter. */
export function safeAuthRedirect(
  candidate: string | null | undefined,
  fallback = DEFAULT_AUTH_REDIRECT,
): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return fallback;
  }

  const hasUnsafeCharacter = Array.from(candidate).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 || character === "\\";
  });
  if (hasUnsafeCharacter) return fallback;

  try {
    const base = new URL("https://picking-up.invalid");
    const target = new URL(candidate, base);
    if (target.origin !== base.origin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
