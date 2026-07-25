# Extractable Components

## SiteHeader
- Source: `frontend/src/components/site-header.tsx`
- Category: layout
- Description: Shared top bar with brand, theme action, user identity, and auth action.
- Extractable props: `isAuthenticated` (boolean, default: false), `displayName` (string, default: "Jaehoon")
- Hardcoded: wordmark, Sign in / Sign out labels, theme icons, routes, Tailwind classes

## SiteFooter
- Source: `frontend/src/components/site-footer.tsx`
- Category: layout
- Description: Shared footer with wordmark, copyright, and GitHub action.
- Extractable props: none
- Hardcoded: all text, URLs, layout, and styling

## AuthLayout
- Source: `frontend/src/components/auth-layout.tsx`
- Category: layout
- Description: Authentication shell with a compact header and centered form column.
- Extractable props: none; use a content slot for the form body
- Hardcoded: wordmark, theme toggle, width, spacing, and background

## ViewSwitcher
- Source: `frontend/src/features/tasks/components/view-switcher.tsx`
- Category: layout
- Description: Calendar-scale tabs and previous/today/next navigation controls.
- Extractable props: `currentTab` (string, default: "daily")
- Hardcoded: Daily/Weekly/Monthly/Yearly labels, Today label, chevron icons, styling

## TaskCalendar
- Source: `frontend/src/features/tasks/components/task-calendar.tsx`
- Category: layout
- Description: Main task-planner shell that owns view and anchor state and renders the active calendar view.
- Extractable props: `currentTab` (string, default: "daily")
- Hardcoded: date heading placement, toolbar structure, and view container structure

## Wordmark
- Source: `frontend/src/components/wordmark.tsx`
- Category: basic
- Description: Picking Up wordmark with brand-colored UP suffix.
- Extractable props: `homeHref` (string, default: "/")
- Hardcoded: text, tracking, type styling, and brand treatment

## ThemeToggle
- Source: `frontend/src/components/theme-toggle.tsx`
- Category: basic
- Description: Round icon action for light/dark mode.
- Extractable props: `isDark` (boolean, default: true)
- Hardcoded: Sun/Moon icons and all styling

## Button
- Source: `frontend/src/components/ui/button.tsx`
- Category: basic
- Description: Semantic action primitive with six visual variants and seven sizes.
- Extractable props: none for DraftComponent use
- Hardcoded: variant recipes, sizes, focus, disabled, and active styling

## Card
- Source: `frontend/src/components/ui/card.tsx`
- Category: basic
- Description: Rounded semantic card with composable content slots.
- Extractable props: none; use content slots
- Hardcoded: surface, ring, radius, spacing, and slot styling

## Checkbox
- Source: `frontend/src/components/ui/checkbox.tsx`
- Category: basic
- Description: Compact Base UI checkbox used for tasks and subtasks.
- Extractable props: `isActive` (boolean, default: false)
- Hardcoded: Lucide check icon and all state styling
