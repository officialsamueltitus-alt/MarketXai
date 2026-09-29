# MarketX — working rules for Claude

## Workflow
- After every update or session: commit, push the working branch, and open a pull request
  against `main` (or update the existing open PR for that branch).

## Protected areas (strict)
- Never modify the analysis AI instructions or configuration: the system instruction and
  prompt text built in the `/api/market/analyze` handler in `server.ts`, the Gemini model
  list (`modelsToTry`), `getGeminiClient`, `src/data/prompts.ts`, and the trading strategy engine `server/strategy.ts` —
  unless the owner explicitly asks for a change to the analysis engine.

## Architecture
- Firestore is storage only (via `firebase-admin` service account). Do NOT use Firebase Authentication.
- Auth is handled by this server (`server/auth.ts`, `server/session.ts`): email/password (scrypt),
  Google Identity Services ID tokens verified with `google-auth-library`, signed httpOnly session cookie,
  email verification + password reset links via Gmail SMTP.
- Credits, subscriptions, gifts, rewards and payments are only ever changed server-side inside
  Firestore transactions. `firestore.rules` denies all direct client access — keep it that way.
- Paystack plans are granted only after server verification (verify endpoint or signed webhook).
- Daily analyses refill every day at 3:00 AM in `CREDIT_RESET_TZ` (default Africa/Lagos, `server/dailyReset.ts`), not 24h after use;
  the daily limit is a hard stop (402 `DAILY_LIMIT`) until that refill. Only exemption: X campaign credits (`credits.campaign`,
  part of `available`) keep working after the daily limit until used up; daily use never consumes them.
- Sign-up is invite-only (`server/access.ts`): a new sign-up reserves one of the batch's 50 server-generated
  pass codes, the code is emailed once, and the account is only created when `/api/access/redeem` accepts it.
  Unredeemed codes expire after 48 hours: the pending sign-up is removed and the seat returns to the batch with a
  fresh code (hourly sweep + checks at redeem/sign-in/sign-up).
  When a batch is fully allocated, new sign-ups are refused until `ACCESS_CODE_BATCH` is raised.
- Sign-up (email or Google) and every Google sign-in require `acceptTerms: true` (Terms & Privacy checkbox),
  enforced server-side. Google sign-in only works for accounts registered with that same Google account.
- Analysis strategy (owner-specified): identify high-probability institutional Supply & Demand zones, then enter with the
  Fibonacci retracement tool, on whatever timeframe is prompted. `server/strategy.ts` computes zones, freshness, the
  swing-leg Fibonacci, entry/stop/targets from real candles (`fetchCandlesForAsset` in `server.ts`: Binance, Yahoo,
  Deriv); those levels are authoritative over the model's numbers, and the model writes the thesis around them.
  Strict (owner-specified): zones only from the last `RECENT_ZONE_BARS` candles inside the current price range; a signal needs
  the zone, entry band, stop and every TP untouched since the zone formed (plus the live 24h range), else "No signal, already
  mitigated". Without a verified candle map (text analyses) the result is NO_SIGNAL, never an unverified trade.
  POI method (owner-specified): dealing range = recent swing range; its 0.50 equilibrium splits premium/discount. Demand only in
  discount, supply only in premium (range and Fib leg). POI map (`poiList`): demand order blocks, supply zones, FVGs, golden
  pocket pool, each with verified mitigation.
- Data sources are listed in `server/dataSources.ts` (given to the AI for data questions; never name the AI provider).
- Questions about trading/markets (`src/utils/promptIntent.ts`, shared by client and server) get a written answer, with the live
  price and today's news for any pair they name; only analysis requests return trade cards.
- Admin console at `/admin` (`server/admin.ts`, `src/admin/*`, lazily loaded): its own password (default, or a custom
  scrypt hash in `adminConfig/auth`), its own short-lived HMAC cookie scoped to `/api/admin`, brute-force lockout.
  Usage/activity are recorded server-side by `server/tracking.ts`; moderation status (`suspended`/`banned`) is enforced
  in `requireAuth` and at sign-in.

## Deployment
- Deployed on Render as a single Web Service (not a static site) on Node 22 (pinned by `.node-version`
  and `engines`; Node 25+ removed `SlowBuffer`, which breaks the Google/Firebase JWT libraries).
- Env vars are documented in `.env.example` (Gemini, Firebase, Paystack, Gmail SMTP).
- Build: `npm install && npm run build` — Start: `npm start`.
