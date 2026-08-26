// Titles double as link holders: a URL pasted straight into a subtask or task
// title is a normal way to park a reference ("compare these two rings"). This
// finds the first http(s) URL inside such a title so the row can offer an
// "open in a new tab" control beside it.
//
// http/https only, and always re-parsed through `new URL` rather than trusted
// as-is — a title is arbitrary user text, and letting something like a
// `javascript:` URL reach an <a href> would turn a checklist row into an XSS
// vector.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

const CLOSER_TO_OPENER: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const TRAILING_PUNCTUATION = ".,;:!?";

function countOf(text: string, char: string): number {
  return text.split(char).length - 1;
}

export function firstLinkIn(title: string): string | undefined {
  const match = URL_PATTERN.exec(title);
  if (!match) return undefined;

  // Trailing punctuation nearly always belongs to the sentence, not to the
  // URL ("see https://example.com/a." / "(https://example.com/a)"), so it's
  // peeled off before parsing. A closing bracket is peeled only when the URL
  // doesn't open one itself, which keeps links that legitimately contain
  // brackets — https://en.wikipedia.org/wiki/Ring_(jewellery) — intact.
  let candidate = match[0];
  while (candidate.length > 0) {
    const last = candidate[candidate.length - 1];
    const opener = CLOSER_TO_OPENER[last];
    const unbalanced = opener !== undefined && countOf(candidate, opener) < countOf(candidate, last);
    if (!TRAILING_PUNCTUATION.includes(last) && !unbalanced) break;
    candidate = candidate.slice(0, -1);
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}
