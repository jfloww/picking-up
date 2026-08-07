# RF-020: Task list semantic ownership

- Date: 2026-08-06
- Issue: RF-020
- Priority: P2
- Status: Resolved

## Problem

`ScopeTasks` rendered each draggable Weekly row as an outer `<li>`, while
`TaskItem` independently rendered its own `<li>` root. The result was invalid
`<li><div><li>...</li></div></li>` markup. React reported a hydration/DOM
nesting warning, list accessibility semantics were ambiguous, and Weekly drag
tests contained comments explaining how to work around the inner list item.

## Resolution

`TaskItem` still owns its list-item root by default for all existing callers.
It now accepts a narrow `rootElement` option (`"li"` or `"div"`). When
`ScopeTasks` adds a draggable row wrapper, that wrapper owns the only `<li>` and
renders `TaskItem` with a `<div>` root.

This keeps semantic ownership explicit without changing the visual card,
pointer handlers, or item-ref geometry used by drag/reorder behavior.

## Regression coverage

- `TaskItem` proves it can yield list-item ownership and emits no descendant
  `<li>` in that mode.
- Weekly drag coverage asserts the rendered day column contains no nested
  `li li` structure.
- Existing reorder tests continue to measure the wrapper registered in
  `itemRefs` and exercise the same pointer flow.

Verification at this checkpoint:

```text
TaskItem + WeeklyView: 30/30 tests passed
TypeScript: clean
```

The full frontend suite is rerun before the PR checkpoint; the counts above are
the focused evidence for this semantic change.
