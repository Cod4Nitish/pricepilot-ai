# Contributing

1. Fork and create a branch from `main`.
2. `npm install`, copy `.env.example` to `.env.local` and use your own keys.
3. Make focused changes. Run before opening a PR:
   ```bash
   npm run typecheck && npm run lint && npm test && npm run build
   ```
4. Open a PR using the template. CI must pass.

Rules:
- Never commit secrets or `.env` files.
- Never add fabricated, sample or placeholder prices. Missing data stays missing.
- Keep verification levels honest (`verified`, `agent_verified`, `snippet_only`, `unverified`).
- Any fetch of user-supplied URLs must follow the SSRF policy in SECURITY.md.
- Update docs when the API changes.
