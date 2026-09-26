# MarketX — working rules for Claude

## Workflow
- After every update or session: commit, push the working branch, and open a pull request
  against `main` (or update the existing open PR for that branch).

## Protected areas (strict)
- Never modify the analysis AI instructions or configuration: the system instruction and
  prompt text built in the `/api/market/analyze` handler in `server.ts`, the Gemini model
  list (`modelsToTry`), `getGeminiClient`, and `src/data/prompts.ts`.

## Deployment
- Deployed on Render as a single Web Service (not a static site).
- Required env vars: `GEMINI_API_KEY`, `NODE_ENV=production`.
- Build: `npm install && npm run build` — Start: `npm start`.
