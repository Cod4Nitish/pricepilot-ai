# Visual QA

What has actually been checked so far, what has not, and a template for logging future passes. Do not record a score here unless it was measured.

## Measured so far

| Check | Result |
| --- | --- |
| Viewports captured | 390 px and 1440 px (home page). 768 px tablet not captured. |
| Horizontal overflow at 390 px (after fix) | `scrollWidth` 375 = `clientWidth` 375; 0 overflowing elements |
| Screenshots | `docs/screenshots/`: `before-home-390.png`, `before-home-1440.png`, `live-home-390.png`, `live-home-1440.png`, `qa-home-390.png`, `qa-home-1440.png`, `after-home-390.png` |

Only the home page was screenshotted. Other routes (search, discover, product, fast, battle, basket, settings, watchlist, history, assistant) have not been visually reviewed.

## Issues found and fixed

| Issue | Fix |
| --- | --- |
| Install card covered page content on mobile | `InstallPrompt` sets `data-install` on `<html>` while visible; `AppShell` adds extra bottom padding so content stays reachable |
| Sidebar mode switch (Fast Commerce / E-Commerce) was clipped | Switched to a compact variant (`ModeSwitch compact`) with short labels |
| Search placeholder truncated on mobile | Shortened the compact placeholder to "Search or speak" and moved secondary controls (paste, language) to `sm` and up |
| Mobile horizontal scrollbar | Root wrapper uses `overflow-x-clip`; offenders were removed until none remained at 390 px |

## NOT YET MEASURED

| Item | Status |
| --- | --- |
| Lighthouse performance, desktop | NOT YET MEASURED |
| Lighthouse performance, mobile | NOT YET MEASURED |
| Lighthouse accessibility | NOT YET MEASURED |
| Lighthouse best practices | NOT YET MEASURED |
| Lighthouse SEO | NOT YET MEASURED |
| Lighthouse PWA / installability | NOT YET MEASURED |
| Automated accessibility scan (axe) | NOT YET MEASURED |
| WCAG contrast of the current flat palette | NOT YET MEASURED (the ratios in the `globals.css` header describe an earlier palette) |
| Screen reader pass (NVDA, VoiceOver, TalkBack) | NOT YET DONE |
| 768 px tablet layout | NOT YET CAPTURED |
| Real-device check (iOS Safari, Android Chrome) | NOT YET DONE |

## Commands

Run against a production build, not `next dev`:

```
npm run build
npm run start            # serves http://localhost:3000
```

Lighthouse (record the numbers in the log below, with date and commit):

```
npx lighthouse http://localhost:3000 --preset=desktop --output=html --output-path=./lh-desktop.html
npx lighthouse http://localhost:3000 --form-factor=mobile --screenshot=false --output=html --output-path=./lh-mobile.html
```

Lighthouse's default run already emulates mobile; the commands above make that explicit. Keep report files out of the repo.

Accessibility with axe (CLI or Playwright):

```
npx @axe-core/cli http://localhost:3000 --exit
```

Overflow check in the browser console at 390 px:

```js
[document.documentElement.scrollWidth, document.documentElement.clientWidth]
// offenders
[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth)
```

## Checklist for each pass

- [ ] 390, 768 and 1440 px: no horizontal scroll, nothing clipped or overlapping.
- [ ] Light and dark theme both checked.
- [ ] Install card, offline banner and update toast do not cover primary content or the bottom nav.
- [ ] Bottom nav shows five items; "More" sheet opens, traps focus, closes with Escape.
- [ ] Location sheet: granted, denied, unsupported and manual-pincode paths.
- [ ] Voice search: supported browser, unsupported browser, permission denied.
- [ ] Keyboard only: skip link works, focus ring always visible, no keyboard trap.
- [ ] `prefers-reduced-motion`: headline is static, no caret, no route fade.
- [ ] Every price shows a verification label in text.
- [ ] Touch targets at least 44px.
- [ ] Browser console free of errors on load.

## Log template

Copy one block per pass.

```
### YYYY-MM-DD, <commit or build>, <tester>
Viewports:        390 / 768 / 1440
Browsers/devices: 
Routes covered:   
Overflow check:   scrollWidth / clientWidth = 
Lighthouse (desktop):  perf  a11y  best-practices  seo     (NOT MEASURED if blank)
Lighthouse (mobile):   perf  a11y  best-practices  seo     (NOT MEASURED if blank)
axe violations:   
Issues found:     
Fixed in:         
Screenshots:      docs/screenshots/<name>.png
```
