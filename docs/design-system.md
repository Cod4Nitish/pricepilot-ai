# Design system: PRICEPILOT MIDNIGHT COMMERCE

The single source of truth is `src/app/globals.css`. This document explains it; if they disagree, the CSS wins.

## Naming note

The name "Midnight Commerce" was set for an earlier, darker and more decorative direction (gradients, glow, grid background). After user feedback the visual direction was simplified to a flat, calm, professional style. The name is kept so existing references stay valid; the look is now simple.

Current direction:

- Light theme by default, dark theme as an option.
- One solid primary colour. No gradients, no glow.
- Inter only.
- Semantic colours carry meaning; decoration is minimal.

Leftover names from the earlier direction still exist as aliases and now resolve to flat values: `.gradient-bg` (solid primary background), `.gradient-text` (solid primary text), `.bg-grid` (hidden), `--btn-from/--btn-to` (both primary), `--glow-primary` (a small shadow), `--hero-a/--hero-b/--grid-line` (transparent). Do not add new gradient styling.

## Tokens

Tokens are CSS custom properties on `:root` (light) and `.dark` (dark), exposed to Tailwind 4 through `@theme inline` (for example `bg-surface`, `text-muted`, `border-line`).

### Colour

| Token | Tailwind name | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `--surface-0` (`--bg`) | `bg-bg` | #f6f7f9 | #0f1115 | Page background |
| `--surface-1` (`--surface`) | `bg-surface` | #ffffff | #16191f | Cards, header, sidebar |
| `--surface-2` | `bg-surface2` | #f0f2f5 | #1d2128 | Inputs, inset areas |
| `--surface-3` | `bg-surface3` | #e6e9ee | #262b34 | Raised or hover |
| `--border` | `border-line` | #e2e5ea | #2b3039 | Hairlines |
| `--border-strong` | `border-line-strong` | #c9ced6 | #3d4452 | Inputs, controls |
| `--fg` | `text-fg` | #14181f | #eceef2 | Body text |
| `--muted` | `text-muted` | #566070 | #a0a8b6 | Secondary text |
| `--primary` / `--accent` | `text-primary`, `bg-primary` | #1d4ed8 | #7ba3ff | Actions, links, focus |
| `--on-primary` | n/a | #ffffff | (inherits) | Text on primary |
| `--good` | `text-good`, `text-verified` | #15803d | #4ade80 | Verified, success |
| `--warn` | `text-warn`, `text-caution` | #92400e | #fbbf24 | Caution |
| `--bad` | `text-bad`, `text-danger` | #b91c1c | #f87171 | Danger, errors |

Notes:

- `--on-primary` is only defined in `:root`; in dark mode the primary is a light blue, so check text-on-primary contrast when touching the dark primary button.
- The `color-scheme` property follows the theme (`light` on `html`, `dark` on `html.dark`).
- Translucent tints use Tailwind opacity on the semantic colours (for example `bg-good/10`, `border-bad/40`).

### Contrast

The header comment in `globals.css` records computed WCAG 2.x ratios, but they were computed for the earlier palette (for example light primary #2750d6, dark primary #6b97ff, a button gradient). They are reproduced here as history only and do not match the current hex values:

- Dark: muted on elevation 0/1/2/3 = 9.23 / 8.75 / 7.97 / 6.99; primary = 7.13 / 6.77 / 6.16 / 5.40; verified >= 7.87; caution >= 9.07; danger >= 5.62.
- Light: muted on 0/1/2/3 = 6.75 / 7.36 / 6.41 / 5.95; primary = 6.01 / 6.55 / 5.70 / 5.30; verified >= 4.9; caution >= 5.73; danger >= 5.08.
- White text on the old button gradient = 5.26 / 5.76.

Ratios for the current flat palette (#1d4ed8, #7ba3ff, #15803d, #92400e, #b91c1c and the muted values above) have NOT been re-recorded. Re-compute them and update the header comment before claiming a WCAG level.

### Type

Inter only, loaded in `src/app/layout.tsx` and mapped to `--font-sans` and `--font-display` (so `font-display` classes render Inter). The layout still also loads Space Grotesk as `--font-display-var`, but nothing references it; it is an unused font download that can be removed.

Fluid scale (`@theme inline`, `clamp()`):

| Token | Range | Line height | Letter spacing |
| --- | --- | --- | --- |
| `text-display` | 1.875rem to 2.875rem | 1.12 | -0.02em |
| `text-h1` | 1.625rem to 2.25rem | 1.15 | n/a |
| `text-h2` | 1.25rem to 1.625rem | 1.25 | n/a |
| `text-body` | 0.9375rem to 1rem | 1.55 | n/a |

`body` uses `text-body`, line-height 1.55 and `optimizeLegibility`. Use `.tabular` (tabular numerals) for prices and counts. Form fields are 16px (`text-base`) on mobile and 14px from `sm` up, which also stops iOS zoom-on-focus.

### Spacing and grid

4/8pt scale tokens: `--space-1` 0.25rem, `-2` 0.5rem, `-3` 0.75rem, `-4` 1rem, `-6` 1.5rem, `-8` 2rem, `-12` 3rem, `-16` 4rem. In practice components use Tailwind spacing utilities that fall on this scale.

Layout: content is centred at `max-w-6xl` with `px-4` (`sm:px-6`). From `lg` (1024px) a fixed 16rem sidebar replaces the bottom nav and the page is offset with `lg:pl-64`. `scroll-padding-top` is 5rem to clear the sticky header.

### Elevation

Four surface levels (`--surface-0` to `-3`) do most of the work. Shadows are subtle:

| Token | Light | Dark |
| --- | --- | --- |
| `--shadow-1` (`shadow-card`) | 0 1px 2px, 5% | 0 1px 2px, 40% |
| `--shadow-2` (`shadow-pop`) | 0 4px 12px -4px, 12% | 0 6px 18px -6px, 50% |
| `--shadow-3` | 0 12px 32px -12px, 20% | 0 16px 40px -16px, 60% |

`shadow-glow` is aliased to `--glow-primary`, which is now just a 1px shadow.

### Radius

`--radius-sm` 0.5rem, `-md` 0.75rem, `-lg` 0.75rem, `-xl` 1rem. Components currently apply Tailwind radii directly (`rounded-xl` controls, `rounded-2xl` cards, `rounded-3xl` sheets and hero panels), so the radius tokens are only partly used.

### Motion

| Token | Value |
| --- | --- |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) |
| `--dur-fast` | 120ms |
| `--dur-base` | 220ms |
| `--dur-slow` | 420ms |

Animations in use: `float-in` (dialogs, 10px rise and fade), `shimmer` (skeletons), `blink` (the typing caret), and a 220ms route fade in `AppShell` (via `motion/react`).

Reduced motion: under `prefers-reduced-motion: reduce` the global rule shrinks every animation and transition to 0.001ms, disables smooth scrolling and hides the caret. `AppShell` skips the route fade, and `HeroSearch` shows a static word with no pause button.

### Focus

Global `:focus-visible` gives a 2px solid primary outline with 2px offset and a 6px radius (inputs use offset 0). In dark mode the outline is #9fbcff. A `.skip-link` ("Skip to main content") appears at the top on keyboard focus and targets `#main-content`.

### Touch targets

`--tap: 2.75rem` (44px). Buttons are `h-10` (sm) to `h-12`; icon buttons, header controls, nav links and chips use `min-h-11` or `h-11 w-11`. Bottom-nav items are `min-h-14`. Treat 44px as the minimum for new interactive elements.

## Accessibility patterns

- Landmarks: one `main#main-content`, `nav` elements with distinct `aria-label` ("Main", "Primary", "Shopping mode"), a `role="search"` form.
- Current page uses `aria-current="page"` (mode switch uses `aria-current="true"`).
- Dialogs and sheets (`ui/dialog.tsx`): `role="dialog"`, `aria-modal`, labelled title, focus trap, Escape closes, focus returns to the trigger, body scroll locked.
- Status messages use `role="status"` with `aria-live="polite"`; errors use `role="alert"`.
- Icons are `aria-hidden`; icon-only buttons have an `aria-label`.
- Invalid inputs set `aria-invalid` and an `aria-describedby` message.
- Pausable motion: the hero headline animation can be paused; nothing auto-advances otherwise.
- Meaning is never carried by colour alone (see below).

## Verification badge semantics

Rendered by `VerificationBadge` from `VERIFICATION_META`. Each state has an icon, a visible text label and a tone, so colour is never the only signal.

| State | Label | Tone | Icon | Meaning | Eligible for "best verified" |
| --- | --- | --- | --- | --- | --- |
| `verified` | Verified | good (green) | BadgeCheck | Price read from the retailer product page | Yes |
| `agent_verified` | Agent verified | brand (primary blue) | Bot | Price read by a web agent on the live page | Yes |
| `snippet_only` | Snippet only | warn (amber/brown) | FileText | Seen in a search snippet; page not confirmed | No |
| `unverified` | Unverified | neutral (muted) | HelpCircle | Could not be confirmed | No |

Pass `detail` to print the explanation as visible text instead of relying on the `title` tooltip (tooltips are not available on touch).

## Themes

Light is the default. The dark theme is the `.dark` class on `<html>`, toggled by the header `ThemeToggle` and persisted in `localStorage` under `pricepilot:theme`. An inline script in `<head>` applies the saved class before paint to avoid a flash. The viewport `themeColor` is fixed at #ffffff and does not switch with the theme.

## Known drift

- `src/components/pwa/InstallPrompt.tsx` and `RegisterSW.tsx` (update toast) still use hard-coded navy (#0F1A3A) and blue-purple gradient classes instead of tokens, so they ignore the flat style and the light theme.
- `ui/dialog.tsx` backdrop is a fixed black overlay in both themes.
- `HeroVisual` still renders a blurred gradient halo behind the card.
