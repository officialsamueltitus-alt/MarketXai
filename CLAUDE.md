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
  The model can't veto a verified plan either: if the map has a plan and the write-up says NO_SIGNAL (or the other side), the
  verified plan is served with the map thesis, so the watchlist (same `buildStructureMap`) and the analysis always agree. A
  high-impact release within 2 hours (`imminentHighImpact` in `server/news.ts`) adds a "News heads-up" line, never a veto.
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
  Every prompt sent for analysis or a question opens with three client-side steps (`App.tsx`, `INTRO_MS` 10s): "Starting…" 2s,
  "Waking up MarketX engine" 5s, "Looking at prompt" 3s. The request is sent first and runs during them (no added server time); the
  result waits for the intro; Stop works during it.
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
  returns 404 `UNKNOWN_ASSET` (credit refunded), never a placeholder price.
- Prices (owner-specified): every pair price shows exactly as its source sends it, never rounded. The server passes feed prices
  through untouched (Yahoo, forex, Deriv, crypto), and every display uses `exactPrice` / `formatMarketPrice` in
  `src/utils/formatPrice.ts` (thousands separators only, tiny prices written out in full, never e-notation). Money (P/L, plan
  prices) and percentages are not prices and keep 2 decimals.
- Logo (owner-specified): the glossy ball mark (gradient X with a widened gap between the chevron and the two right legs,
  wrapped on a dark glass sphere with the rainbow ring as its rim). Site sizes live in `public/brand/` (`marketx-logo-{32..512}.png`,
  `apple-touch-icon.png`, `marketx-maskable-512.png`, `/favicon.ico`), referenced with `?v=3` (bump `LOGO_V` in `MarketXIcon.tsx`
  and every other `?v=` ref when the files change). Render any size with `python3 brand/logo-ball.py OUT.png --size N [--no-shadow]`;
  master `brand/marketx-logo-ball-1080.png`, flat mark `brand/marketx-logo-flat-512.png`.
- SEO (`index.html`): link previews use `public/brand/marketx-share-2026.jpg` (og:image + twitter:image + JSON-LD, with size/alt tags;
  `marketx-og-1200x630.jpg` holds the same picture for old links; a new image gets a NEW file name so social caches refetch;
  design: "Ask any market. Get the trade." + live XAU/USD trade card);
  JSON-LD is an @graph of Organization (logo, sameAs X), WebSite and SoftwareApplication; `public/site.webmanifest` lists the icons.
- Videos (owner-specified): every MarketX video shows the logo SPINNING, never static. Render it with
  `python3 brand/logo-spin.py OUT_DIR [--size N] [--frames 120] [--transparent]` (seamless loop, one turn per 120 frames).
- Brand (owner-specified): the site says SI / Super Intelligence, never AI ("MarketX SI", "Ask SI", "SI credits"). X handle
  is @_MarketX (`MARKETX_X_URL` / `MARKETX_X_HANDLE` in `src/utils/campaign.ts`). Telegram buttons link to `/go/telegram`, a
  server redirect to `TELEGRAM_INVITE_URL` (t.me only), so the invite link never ships in the page or bundle.
- Data sources are listed in `server/dataSources.ts` (given to the AI for data questions; never name the AI provider).
- Questions about trading/markets (`src/utils/promptIntent.ts`, shared by client and server) get a written answer, with the live
  price, market details (`assetDetailLines` in `server.ts`: type, venue, and for on-chain tokens chain, DEX, contract, liquidity,
  volume, market cap, pool age) and today's news for any pair they name; info wording ("tell me about", "info", "market cap",
  "price") is a question. Only analysis requests return trade cards. A bare pair ("EURUSD", "gold", "$WIF") is intent `clarify`:
  the client answers locally with "Analyze X" / "Info about X" buttons (`ChatMessage.choices`) and the server's `clarifyBarePair`
  (before `chargeAnalysisCredit`) does the same, so asking never costs a credit.
- Answer reuse (`server/answerCache.ts`): engine-written answers to questions are stored (memory + Firestore `answerCache`,
  hourly sweep) keyed by the normalized question; general 7 days, time-sensitive wording 20 min, pair questions keyed to the
  symbol and the reader's calendar day (6h, 1h if time-sensitive). A pair replay always fetches the live price and shows it
  first ("Live now"), with the time the explanation was written. Analyses are never reused.
- Web research for questions (`server/webResearch.ts`): the chat engine runs with web search on (falls back to a plain answer if
  search is unavailable), answers the exact question first, and the response carries `research` (web searched, queries, source
  site names only, live data used, cached). Sources are listed under the answer; the provider's redirect links and name never
  ship. The client shows "Checking live X data" and "Searching the web" steps, then "Searched the web · N sources" (or
  "Found an earlier answer" / "Web search not needed"). The user's text never goes into the chat system instruction.
  Question answers share one engine budget (`CHAT_BUDGET_MS`, default 85s, under the client's 110s). If the engine can't answer, a
  pair question gets its live details, a matching canned lesson is used, else 503 `ANSWER_UNAVAILABLE` (credit refunded), never a
  generic greeting. Chat Markdown opens only http(s)/relative links (new tab, noopener) and never loads remote images.
- Detailed pair answers (owner-specified): question answers are in depth, never one-liners (pair questions 350 to 700 words: what it
  is, live picture, drivers, sessions, behaviour, today, risks, approach). `server/pairKnowledge.ts` holds background facts for forex
  (about 40 currencies), metals, energy, indices, stocks, coins, DEX tokens and synthetics: `pairKnowledge` feeds the chat engine
  ("MARKETX KNOWLEDGE" in `marketContext`), `pairBriefing` is the no-engine answer, and short engine replies get a knowledge top-up.
  `answerKey` is versioned (`v2|`) so older short answers are never replayed.
- Notification deep links: every notification and email opens the exact item. Analyses/answers carry `open_chat` with
  `{sessionId, messageId}` (the client sends `ref` with each analyze request; emails link `/?chat=&msg=`), alerts
  `/?alerts=1&focus=al_…`, watchlist `/?watchlist=1&focus=wl_…`. `handleUpdateNotificationAction` in `App.tsx` is the one router
  (notification center, toasts and URL params all use it); the panels ring and scroll to `focusId`.
- Anti-scam (`server/trust.ts`): usernames and display names that read as MarketX or its staff (admin, support, official, moderator,
  staff, help desk, refund, recovery…, look-alike spellings folded) are refused at sign-up and on rename (`RESERVED_NAME`), and an
  email-derived name like that becomes a neutral `trader…` name; unlimited staff accounts are exempt. Gift notes refuse links, contacts,
  socials, emails/handles, phone numbers and scam wording (`NOTE_REFUSED`), hidden control characters are stripped, and a sender can
  gift at most 10 times a day, 3 to the same trader (`GIFT_LIMIT`).
- On-chain lookups are budgeted per worker (`DEX_SEARCH_PER_MIN` default 60, `GECKO_CALLS_PER_MIN` default 12).
- Guide screenshots live in `public/guide/*.webp` (demo account, no real user data, at most 2 per section via `shots`).
- The public guide (`src/blog/BlogPage.tsx`) never discloses internals: no settings/env names, admin paths, code formats, limits,
  anti-abuse rules, providers or keys.
- Price alerts (`/price-alerts`, `server/priceAlerts.ts`, `src/components/PriceAlertsPanel.tsx`): the trader approves alerts once
  (`users.alerts.enabled`), then taps "Get price alert" on a LONG/SHORT result. Auto / Manual (owner-specified): approving asks once
  (`users.alerts.mode`, kept when alerts are switched off and on; `POST /api/alerts/mode` changes it, switch in the panel). Auto: every
  signal served afterwards starts its alert by itself inside `alertOfferMiddleware` (`startAlert`, the same path as the tap, so the journal,
  track record and notices follow it; Pro/free period only; result waits at most 2.5s; card shows "Alert on · Auto"). Manual: as before. Every signal served is recorded as an
  `alertOffers` doc (levels server-side, via `alertOfferMiddleware` wrapping res.json; the analysis itself is untouched), and
  alerts (`priceAlerts`, id `al_{offerId}`) only ever use those stored levels. Only the lead worker monitors: active alerts in
  memory, one cached 1-minute candle series per symbol per 15s cycle, candle high/low checks, hits written in transactions
  (entry zone, TP1-3, stop, or MISSED if a target comes before entry), then a notification + activity email. Unused signals get
  one "Want a price alert?" email after 15 minutes, at most one per trader every 6 hours. Clients poll notifications every 30s
  only while they have an active alert and the tab is visible. The panel has a Refresh button: `GET /api/alerts?live=1` reloads the alerts and
  returns the live price of each market with an active alert (`deps.getQuote`, 5s cap, 12 markets); each active card shows the live
  price, today's change and where price sits (distance to the entry zone, or P/L from entry, % to the next TP and to the SL).
- Watchlist (`/watchlist`, `server/watchlist.ts`, `src/components/WatchlistPanel.tsx`): the trader approves it once (`users.watchlist.enabled`);
  a pair (`watchItems`, max 12) is added only after the server confirms a live quote and 40+ candles on its timeframe (1H for RDM). The lead
  worker scans pairs on its own with `buildStructureMap` only (no AI calls, no credits): READY = a plan scoring 60+ (RDM 75+, every timeframe),
  BUILDING = a fresh zone in the right half of the range within 2.5 ATR, else WAITING. Each setup key notifies once (in-app `open_watchlist` +
  email, link `/?watchlist=1`); the notice never carries the levels, "Get the plan" runs a normal analysis. A new notice also plays a
  chime while the site is open (`src/utils/notifySound.ts`, Web Audio, no file; brighter for ready than building; short vibration on phones;
  unlocked on the first tap; per-device switch "Sound when a setup is found" in the panel, localStorage `mx.watchSound`).
- Web push (`server/webPush.ts`, `public/sw.js`, `src/utils/push.ts`, `PushToggle.tsx` in the sidebar Settings → Notifications card, owner-specified): phone/desktop
  notifications with the device's own sound, even when MarketX is closed. No SDK: VAPID ES256 JWT + RFC 8291 aes128gcm with Node crypto
  (verified against http_ece / web-push). Keys: `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` if set, else generated once and kept in Firestore
  `adminConfig/webPush` (never sent to clients except the public key; changing keys invalidates every subscription). Subscriptions
  `pushSubs/{sha256(endpoint)}` (max 8 per trader, a device belongs to whoever signed in last, unlinked on sign-out; 404/410/403 deletes).
  The server only POSTs to allowlisted push hosts (FCM, Mozilla, Apple, Windows; https, no port/credentials). Watchlist setups and alert hits
  (one per alert per cycle) are pushed, not capped by the email budget; the payload carries the exact deep link (`/?watchlist=1&focus=`,
  `/?alerts=1&focus=`). The service worker has NO fetch handler (no caching), is served `no-cache`, skips the popup when MarketX is focused
  (except Apple, which revokes silent pushes) and posts `mx-push` (refresh now) / `mx-open` (route the tapped link) to the app. iPhone/iPad
  need Add to Home Screen (iOS 16.4+); the toggle explains it.
- Market email budget (owner-specified, to stay clear of Gmail limits): price alerts and the watchlist share ONE allowance of
  `MARKET_MAIL_PER_DAY` (default 5) emails per trader per day (site time zone day, `claimMarketMail` / `nextMarketMail` in
  `server/account.ts`, counter `users.marketMail`). Site notifications are never capped. Hits found in the same alert cycle go out
  as one email; "Want a price alert?" invitations only use the allowance while 2 emails are still left for real hits. These emails
  stay short: one or two lines, at most 3 rows, no long notes.
- Preference Mode (`/preference`, `server/preferences.ts`, shared `src/utils/preferences.ts`, `PreferencePanel.tsx`, free): `users.preferences`
  {timeframe, slMode, accountSize, currency USD/NGN/EUR/GBP, riskPct 0.1 to 10, view DETAILED/SIMPLE, homeMarket}, validated, autosaved
  (`PUT /api/preferences`, `reset`). Applies to the composer defaults, the trade card money strip (`PositionStrip`: risk and each TP in money; units
  only for USD-priced crypto/stock/commodity with a USD account), Simple view (write-up folded), the Markets tab and the calculator. Never
  changes the analysis. Listed under Tools in `ConnectorsModal` and opens from the slash menu. Backtest was removed (owner-specified): no
  `/backtest` command, routes, panel or history fetcher.
  Trade calculator (owner-specified, in Preference Mode, `TradeCalculator.tsx`, math in `src/utils/tradeCalc.ts`): "Find my lot size" (account,
  risk %, stop) or "Check my lot" (lots → money and % at risk). Risk = lots × contract size × stop distance × FX (quote → account currency);
  lots rounded DOWN to 0.01, under 0.01 flagged, shown in trader terms (owner-specified): lot type (Standard 1.00, Mini 0.10, Micro 0.01,
  `lotBreakdown`), e.g. "1 mini + 6 micro lots", and a Standard/Mini/Micro row with the pip value of each. Stop by entry/stop/target prices
  (direction from the stop) or in pips as MT4/MT5 count them (`pipSize`: forex 0.0001, JPY 0.01, gold 0.10, silver and oil 0.01) / points
  (1.00 price move) for indices, crypto, stocks and synthetics. Contract presets (forex 100k, gold 100, silver 5k, oil 1k, index/crypto/stock/synthetic 1) and quote currency
  are guessed from the symbol and editable. Live FX from `GET /api/fx` (`server/fx.ts`, open.er-api.com USD table, 1h cache) or typed by hand.
  Trade cards have a "Lot size" button that opens it filled with that trade (`calcSeed`).
- Solana (owner-specified, free to run): `server/solana.ts` (no SDK: base58, JSON-RPC via `SOLANA_RPC_URL` default public mainnet, never
  logged beyond its host; `SOLANA_PROOF_SECRET_KEY` proof wallet, JSON array or base58, never logged/returned; legacy Memo tx built and
  signed with Node ed25519, byte-identical to @solana/web3.js).
  Token safety (`server/tokenSafety.ts`, `TokenSafetyCard.tsx`): for on-chain Solana tokens (`asset.dex.chainId === 'solana'`),
  `startTokenSafety(res, asset)` runs in parallel with the analysis or question and `tokenSafetyMiddleware` attaches `tokenSafety` (body +
  strategy, waits ≤2.5s, never alters the analysis). Chain reads: mint/freeze authority, Token-2022 extensions, largest holders with
  program/pool-owned accounts set apart (owner not System-owned); RugCheck: LP lock, rugged, mutable metadata, extra danger flags;
  DexScreener: liquidity, pool age. Verdict LOW_RISK / CAUTION / HIGH_RISK / UNKNOWN (never "safe"), score 0-100. Cached 10 min, shared
  lookups, per-worker budgets (`SAFETY_RPC_PER_MIN` 60, `RUGCHECK_PER_MIN` 30). `GET /api/token-safety/:mint` public, 12/min per IP.
  Signal proofs (`server/signalProof.ts`, `ProofBadge`, `/proof/<id>` page `src/proof/ProofPage.tsx`): `signalProofMiddleware` seals every
  LONG/SHORT served (`strategy.proof` {id, hash}): SHA-256("marketx-signal-v1\n" + canonical JSON of symbol, timeframe, side, execution,
  entry, stop, targets, issuedAt), stored in `signalProofs` (no identity). Lead worker every `PROOF_BATCH_MS` (6h): Merkle batch
  (`proofBatches`, leaf SHA-256(0x00‖hash), node SHA-256(0x01‖L‖R)), memo "MarketX proof v1 <batch> <root> n=<count>" sent from the proof
  wallet (one tx per batch, ~0.000005 SOL); no wallet / low balance / failure = waits and retries every `PROOF_RETRY_MS`
  (10 min; batching stays on the 6h cycle). A sent but unconfirmed tx is stored and looked up first (`memoStatus`), so a batch is
  never written twice; batching and sending run under a Firestore lease (`adminConfig/proofLease`), one worker at a time. Each
  batch keeps `anchor.lastError` / `tries` / `lastTryAt`; Admin, Overview → "Solana signal proofs" (`/api/admin/proofs`) shows the
  proof wallet address + balance, RPC host, waiting batches with their reason, the last anchored txs (Solscan) and "Anchor now". `GET /api/proofs/:id` public (30/min per
  IP); the page recomputes the hash and Merkle path in the browser and links Solscan / Solana Explorer.
- Trade journal (`/trade-journal`, `server/journal.ts`, `journalTrades`) and track record (`/track-record`): trades are validated server-side
  (stop/target side checked, R and WIN/LOSS/BE scored on close). Auto + manual (owner-specified): turning on a price alert logs the trade
  (`openAutoJournal`, id `autoJournalId(alertId)`, `source: 'AUTO'`, `auto.state` TRACKING); when the alert ends, `closeAutoJournal` scores it
  ONCE (WIN at the furthest TP reached, LOSS at the stop, NO_FILL if never entered, not in stats) and it is DONE (notes only after that). If the
  alert ends while in the trade with no TP/SL it is HANDED_OVER and the trader closes it by hand. Manual trades work as before. The track record is built only from price alerts: `archiveAlertOutcome`
  writes `trackRecord/{alertId}` when an alert ends (WIN once any TP is hit, LOSS if the stop came first, MISSED); MarketX-wide stats cached 10 min.
- Pro gate (owner-specified, `server/proAccess.ts`): the four commands and the RDM timeframe are free for everyone until 1 Nov 2026 00:00 Lagos
  (`PRO_GATE_AT`), then Pro only (paid plan not expired, or unlimited staff). After that: command routes return 402 `PRO_REQUIRED` (turning off
  and deleting still work), RDM analyses get 402 before any credit is charged (`rdmProGate`; a timeframe in the prompt or a question is not
  gated), `pluginStates` reports all off, and the lead-worker sweep (`sweepFreeAccounts`, every 15 min) pauses alerts + watchlist of free or
  lapsed accounts and tells them once. Data is kept. Client: `profile.proAccess`/`proFreeUntil`, RDM chip locked, commands open pricing.
- Connectors / Plugins (`server/plugins.ts`, `src/utils/plugins.ts`): alerts, watchlist, journal, trackRecord. Every command turned on is listed
  in Settings, Connectors / Plugins (2 shown, expand icon opens `ConnectorsModal`; the composer's Connectors button opens it too, with a
  count of commands on) with open and switch-off; `POST /api/plugins/:id` uses the
  same helpers as inside each command (`setAlertsEnabled`, `setWatchlistEnabled`). Turning one off keeps its data.
- Emails (`server/mailer.ts`, the only template): light design (owner-specified): soft white page, white card with a violet to cyan
  top bar, dark readable text, violet button, footer with marketx.world, @_MarketX and Support; tables with `bgcolor` and
  `color-scheme: light only` so mail apps keep it light.
- Admin console at `/admin` (`server/admin.ts`, `src/admin/*`, lazily loaded): its own password (`ADMIN_DEFAULT_PASSWORD` env, 12+ chars, never
  hard-coded; or a custom scrypt hash in `adminConfig/auth`; with neither, admin sign-in is disabled), its own short-lived HMAC cookie scoped to `/api/admin`, brute-force lockout.
  Usage/activity are recorded server-side by `server/tracking.ts`; moderation status (`suspended`/`banned`) is enforced
  in `requireAuth` and at sign-in.

## Deployment
- `package.json` `overrides` pins `uuid` to ^11.1.1 (patched advisory inside Firebase's storage client; `npm audit` is clean).
- Deployed on Render as a single Web Service (not a static site) on Node 22 (pinned by `.node-version`
  and `engines`; Node 25+ removed `SlowBuffer`, which breaks the Google/Firebase JWT libraries).
- Env vars are documented in `.env.example` (Gemini, Firebase, Paystack, Gmail SMTP).
- Build: `npm install && npm run build` — Start: `npm start`. The server bundle builds to `server-dist/` (never inside the
  public `dist/`); the static server 404s `.map`, `.cjs`, `.ts`, dotfiles and `/server*` paths so source never ships.
- Mobile resilience: on-demand screens use `lazyWithReload` (`src/utils/lazyReload.ts`): preloaded in idle time, and a tab left
  open across a deploy reloads onto the new version instead of breaking. Missing `/assets/*` or file paths return 404, never
  the app page. Analyses time out on the client (110s text, 180s chart) and Recheck after 45s, so nothing loads forever.
