# MarketX — working rules for Claude

## Workflow
- After every update or session: commit, push the working branch, and open a pull request
  against `main` (or update the existing open PR for that branch).

## Protected areas (strict)
- Never modify the analysis AI instructions or configuration: the system instruction and
  prompt text built in the `/api/market/analyze` handler in `server.ts`, the Gemini model
  list (`modelsToTry`), `getGeminiClient`, and `src/data/prompts.ts`.

## Architecture
- Firestore is storage only (via `firebase-admin` service account). Do NOT use Firebase Authentication.
- Auth is handled by this server (`server/auth.ts`, `server/session.ts`): email/password (scrypt),
  Google Identity Services ID tokens verified with `google-auth-library`, signed httpOnly session cookie,
  email verification + password reset links via Gmail SMTP.
- Credits, subscriptions, gifts, rewards and payments are only ever changed server-side inside
  Firestore transactions. `firestore.rules` denies all direct client access — keep it that way.
- Paystack plans are granted only after server verification (verify endpoint or signed webhook).

## Deployment
- Deployed on Render as a single Web Service (not a static site) on Node 22 (pinned by `.node-version`
  and `engines`; Node 25+ removed `SlowBuffer`, which breaks the Google/Firebase JWT libraries).
- Env vars are documented in `.env.example` (Gemini, Firebase, Paystack, Gmail SMTP).
- Build: `npm install && npm run build` — Start: `npm start`.
