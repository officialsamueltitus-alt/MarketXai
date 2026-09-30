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
  Confirmation (owner-specified, every timeframe, market and session): RSI(14) is the leading entry indicator (no buy into
  RSI 70+, no sell into RSI 30-; a market entry also needs RSI on the right side of 50 or a divergence) and EMA(50) is the
  crosscheck (no trade against a clearly sloping EMA unless an RSI divergence confirms the reversal). Proximity guard: price
  must be under half-way from the entry to TP1, at least 1.5 ATR and 1R from TP1 (buy entry at/below price, TP far above; sells
  mirror; limit and market alike), clear of the stop, and must not have already turned
  just short of the entry; else "No signal, already moved, close to TP" (or "close to the stop loss"), `alreadyMoved` on the
  result. `evaluateSignalExecutionStatus` applies the same half-way rule to every served trade. The client activity shows
  "Finding tools" then "Using tools" (RSI, EMA, zones from `strategy.toolsUsed`) before the other steps.
  RDM timeframe (composer option `RDM`): the analyze handler (`scanAllTimeframes` in `server.ts`) builds the map on every
  supported timeframe, keeps plans scoring 75+, serves the strongest (slight edge to higher timeframes) and tags the result
  `timeframeScan` + an "RDM scan" note; a timeframe named in the prompt still wins; no valid setup anywhere = NO_SIGNAL.
  POI method (owner-specified): dealing range = recent swing range; its 0.50 equilibrium splits premium/discount. Demand only in
  discount, supply only in premium (range and Fib leg). POI map (`poiList`): demand order blocks, supply zones, FVGs, golden
  pocket pool, each with verified mitigation.
- "Explain MarketX" campaign (`server/campaigns.ts`, page `/campaigns/explain-marketx`, open until 30 Oct 2026 Lagos time):
  users submit an X post link; credits are NEVER automatic. An admin approves (+50 campaign credits, notification + email)
  or declines with a reason in Admin, Campaign. One reward per person (email hash). It is listed only as a card in the
  notification Rewards tab (next to the 10 credit Share on X card); nobody is notified about the campaign itself.
- Every coin and meme (owner-specified): `server/cryptoUniverse.ts` loads the USDT spot lists of Binance, Bybit and MEXC (every 6h,
  per worker) and resolves on-chain tokens by ticker or contract address via DexScreener (most liquid pool, `MIN_DEX_LIQUIDITY_USD`
  default $20k) with GeckoTerminal candles (series shared across timeframes, 60s cache). `detectCryptoTicker` in
  `src/utils/cryptoTicker.ts` (shared) finds cashtags, pairs, addresses, meme names (`CRYPTO_ALIASES`, incl. Ansem) and tickers;
  `extractAssetInfo` runs it after majors/forex/stocks, `resolveAssetInfo` (async) finishes on-chain lookups. A coin listed nowhere
  returns 404 `UNKNOWN_ASSET` (credit refunded), never a placeholder price. Prices below one cent keep 4 significant digits
  (`priceDecimals`, `src/utils/formatPrice.ts`).
- Brand (owner-specified): the site says SI / Super Intelligence, never AI ("MarketX SI", "Ask SI", "SI credits"). X handle
  is @_MarketX (`MARKETX_X_URL` / `MARKETX_X_HANDLE` in `src/utils/campaign.ts`). Telegram buttons link to `/go/telegram`, a
  server redirect to `TELEGRAM_INVITE_URL` (t.me only), so the invite link never ships in the page or bundle.
- Data sources are listed in `server/dataSources.ts` (given to the AI for data questions; never name the AI provider).
- Questions about trading/markets (`src/utils/promptIntent.ts`, shared by client and server) get a written answer, with the live
  price and today's news for any pair they name; only analysis requests return trade cards.
- Price alerts (`/price-alerts`, `server/priceAlerts.ts`, `src/components/PriceAlertsPanel.tsx`): the trader approves alerts once
  (`users.alerts.enabled`), then taps "Get price alert" on a LONG/SHORT result. Every signal served is recorded as an
  `alertOffers` doc (levels server-side, via `alertOfferMiddleware` wrapping res.json; the analysis itself is untouched), and
  alerts (`priceAlerts`, id `al_{offerId}`) only ever use those stored levels. Only the lead worker monitors: active alerts in
  memory, one cached 1-minute candle series per symbol per 15s cycle, candle high/low checks, hits written in transactions
  (entry zone, TP1-3, stop, or MISSED if a target comes before entry), then a notification + activity email. Unused signals get
  one "Want a price alert?" email after 15 minutes, at most one per trader every 6 hours. Clients poll notifications every 30s
  only while they have an active alert and the tab is visible.
- Admin console at `/admin` (`server/admin.ts`, `src/admin/*`, lazily loaded): its own password (`ADMIN_DEFAULT_PASSWORD` env, 12+ chars, never
  hard-coded; or a custom scrypt hash in `adminConfig/auth`; with neither, admin sign-in is disabled), its own short-lived HMAC cookie scoped to `/api/admin`, brute-force lockout.
  Usage/activity are recorded server-side by `server/tracking.ts`; moderation status (`suspended`/`banned`) is enforced
  in `requireAuth` and at sign-in.

## Deployment
- Deployed on Render as a single Web Service (not a static site) on Node 22 (pinned by `.node-version`
  and `engines`; Node 25+ removed `SlowBuffer`, which breaks the Google/Firebase JWT libraries).
- Env vars are documented in `.env.example` (Gemini, Firebase, Paystack, Gmail SMTP).
- Build: `npm install && npm run build` — Start: `npm start`. The server bundle builds to `server-dist/` (never inside the
  public `dist/`); the static server 404s `.map`, `.cjs`, `.ts`, dotfiles and `/server*` paths so source never ships.
- Mobile resilience: on-demand screens use `lazyWithReload` (`src/utils/lazyReload.ts`): preloaded in idle time, and a tab left
  open across a deploy reloads onto the new version instead of breaking. Missing `/assets/*` or file paths return 404, never
  the app page. Analyses time out on the client (110s text, 180s chart) and Recheck after 45s, so nothing loads forever.
