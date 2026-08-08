"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// No general visibility filtering: within a single trap's container, every
// candidate that matches the selector is conditionally *rendered* (JSX),
// never CSS-hidden-while-present — the drawer's covered-but-still-mounted
// footer lives in a different container (the drawer's own) than the one
// scoped by the panel's trap while the panel is open, so this never needs
// to skip a same-container element for being hidden. (jsdom also always
// reports `offsetParent: null` regardless of real visibility, so an
// offsetParent-based check would silently break under test anyway.)
//
// The explicit tabIndex/aria-hidden filter below IS still needed:
// `:not([tabindex="-1"])` in FOCUSABLE_SELECTOR only guards its own
// `[tabindex]` alternative, not the tag-based ones — so e.g. Base UI's
// Checkbox renders a visually-hidden native `<input type="checkbox"
// tabindex="-1" aria-hidden="true">` shim that would otherwise match via
// the plain `input:not([disabled])` clause despite being deliberately
// excluded from the tab order.
function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex !== -1 && el.getAttribute("aria-hidden") !== "true",
  );
}

// Bounds Tab/Shift+Tab cycling to the elements inside `containerRef` while
// `active` is true. Keyboard-only: a mouse click on something outside the
// container is a separate, CSS-stacking concern (the Subtask Detail panel
// visually covers the drawer's footer, which is what stops a click from
// reaching it — this hook only closes the keyboard-Tab gap).
//
// Deliberately split from useRestoreFocusOnUnmount below: `active` toggles
// on and off multiple times over one mount when a nested trap (the panel)
// opens and closes without the outer container (the drawer) ever
// unmounting, and none of those toggles should re-trigger an initial-focus
// jump — only a real mount should do that.
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const focusable = focusableElements(container!);
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const current = document.activeElement;
      if (e.shiftKey) {
        if (current === first || !container!.contains(current)) {
          e.preventDefault();
          last.focus();
        }
      } else if (current === last || !container!.contains(current)) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", onKeyDown);
    return () => container.removeEventListener("keydown", onKeyDown);
  }, [containerRef, active]);
}

// Moves focus into `containerRef` once when this component mounts (unless
// focus is already inside it — matters when a nested trap, e.g. the
// Subtask Detail panel, unmounts and hands focus back to something inside
// this same container, so this hook doesn't then yank it back to the first
// element) and restores focus to whatever was focused immediately before
// mount once this component unmounts. `initialFocusRef`, when given, is
// focused first if present instead of the container's first focusable
// element in DOM order — e.g. so the Subtask Detail panel can land focus
// on its title field, the element someone opening it almost certainly
// wants, rather than its close button, which merely happens to come first.
export function useRestoreFocusOnUnmount(
  containerRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (container && !container.contains(document.activeElement)) {
      const target = initialFocusRef?.current ?? focusableElements(container)[0] ?? container;
      target.focus();
    }

    return () => {
      if (
        previouslyFocused &&
        document.body.contains(previouslyFocused) &&
        typeof previouslyFocused.focus === "function"
      ) {
        previouslyFocused.focus();
      }
    };
    // Mount/unmount-scoped by design, not tied to any prop — see the
    // module comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
