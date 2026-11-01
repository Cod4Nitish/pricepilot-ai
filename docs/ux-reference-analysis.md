# UX reference analysis: BuyHatke

Public-UX analysis of a price-comparison site we used as a reference point while designing PricePilot AI. It records observed patterns only. No competitor assets, copy, logos or screenshots are reused or published in this repository.

## Method

- Site: https://buyhatke.com (public home page, signed out).
- Observed live on 2026-11-01 with Playwright at two viewports: 390 px (mobile) and 1440 px (desktop).
- The 768 px tablet viewport was not captured, so nothing here describes the tablet layout.
- Console output on load contained errors (not investigated further).

## Observed: desktop (1440 px)

- Left-aligned headline of the form "Compare & Find Best Prices for <category>", where the category rotates with a typing cursor; a sub-line sits under it.
- Two calls to action: Watch Demo and Add to Chrome (browser-extension install).
- Award laurel badges and a five-star Web Store rating row as trust signals.
- A product mock-up card on the right with per-store price rows, a "BEST DEAL" tag, "22% Cheaper" chips and a green "You save" pill (an illustrative saving of about 19,000 rupees).
- A stats strip: 8M+ active users, 10K CR cash saved, 100K+ trusted stores.
- Seasonal (Diwali) decorative artwork and a patterned background.

## Observed: mobile (390 px)

- A thin banner strip above the header.
- Header with logo, a Download App button and a hamburger menu.
- A full-width search bar directly under the header, with a voice microphone and the prompt "Search for any product or paste any link".
- Rotating category hero (Flights was showing) with a product mock-up carousel and a dot pager.
- Watch Demo and Login buttons, then a full-width Download App button.
- Play Store 4.7 and App Store 4.5 rating badges.
- Footer with SEO link groups (Price History, Compare prices, Gift Cards, Deals, Tools) and social links.

## Strengths worth learning from

- Search-first on mobile: the search field is the first interactive element under the header.
- Paste-a-link and voice input lower the effort of starting a comparison.
- A concrete price-comparison mock-up shows the product's value before any interaction.
- Several trust signals in view (ratings, awards, usage numbers).
- One clear primary call to action per viewport.

## Weaknesses to avoid

- Decorative clutter: seasonal artwork and a patterned background compete with the content.
- Low-contrast small text in secondary areas.
- Auto-rotating hero and carousel with no visible pause control.
- Heavy seasonal art that dates the page and adds visual weight.
- On desktop, conversion is install-first (extension and demo) rather than putting a search and results in front of the visitor.
- No visible price-verification transparency: nothing tells the visitor how a shown price was obtained or how fresh it is.
- Errors in the console on load.

## How PricePilot differs

| Topic | Reference pattern | PricePilot |
| --- | --- | --- |
| Primary action | Install / demo | Search, directly in the hero (`HeroSearch` + `SmartSearch`) |
| Rotating headline | Rotates, no visible pause | Types and pauses on hover or focus, has an explicit pause button, static under `prefers-reduced-motion` |
| Price mock-up | Illustrative figures presented as a deal | `HeroVisual` is labelled "Example layout / Not live data" and uses placeholder amounts |
| Trust | Ratings, awards, user counts | Verification label beside every price (Verified, Agent verified, Snippet only, Unverified), never colour alone |
| Visual style | Seasonal art, patterned background | Flat, calm, no gradients or glow; see `design-system.md` |
| Mobile navigation | Hamburger and install button | Header search below the logo row, five-item bottom nav, "More" sheet; see `mobile-ux.md` |
| Location | n/a observed | Asked like a ride app, only when quick-delivery results need it |

## Screenshots

All files below are PricePilot's own screenshots in `docs/screenshots/`. Competitor screenshots were taken only for private analysis and are not published in the repo.

| File | What it shows |
| --- | --- |
| `before-home-390.png` | PricePilot home at 390 px before the redesign |
| `before-home-1440.png` | PricePilot home at 1440 px before the redesign |
| `live-home-390.png` | Home at 390 px during iteration |
| `live-home-1440.png` | Home at 1440 px during iteration |
| `qa-home-390.png` | Home at 390 px captured for visual QA (see `visual-qa.md`) |
| `qa-home-1440.png` | Home at 1440 px captured for visual QA |
| `after-home-390.png` | Home at 390 px after the redesign; no 1440 px "after" capture exists yet |
