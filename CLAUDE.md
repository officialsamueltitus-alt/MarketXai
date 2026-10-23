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
  the daily limit is a hard stop (402 `DAILY_LIMIT`) until that refill. Campaign credits (owner-specified, `credits.campaign`, part of
  `available`, `campaignPool`; Free and Pro alike) are spent FIRST: while any are left the daily analyses are paused (not spent, and
  `normalizeUser` skips the 3:00 AM refill); the last campaign credit sets `lastDailyReset` to now, so the daily analyses left carry on
  and the next refill is the following 3:00 AM. Campaign credits can't be gifted (only `available - campaign` is giftable).
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
  Stop loss modes (owner-specified, `planForZone`): Normal SL = breathing space past the invalidation (0.3 ATR beyond the zone's distal line,
  at least 1 ATR risk); Tight SL = just past each zone on its own timeframe (0.08 ATR beyond the distal line, 0.5 ATR floor = the Tighten SL floor), so it follows
  the zone. The stop is always beyond the far edge of the entry band.
  The result's `currentPrice` is always the live feed price (the chart's own price only in chart mode), never the write-up's number, and
  any error after the map is built serves that verified map (`res.locals.verifiedFallback`), never a blind NO_SIGNAL.
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
  "Waking up MarketX engine" 5s, "Looking at prompt" 3s. Owner-specified: the analysis only begins AFTER them (the request is sent,
  and the client time limit starts, right after "Looking at prompt"); Stop during the intro sends nothing and uses no credit.
  RDM timeframe (composer option `RDM`): the analyze handler (`scanAllTimeframes` in `server.ts`) builds the map on every
  timeframe the trader chose for RDM (`users.preferences.rdmTimeframes`, [] = all, `rdmTimeframesFor`), keeps plans scoring 75+, serves the
  strongest (slight edge to higher timeframes) and tags the result `timeframeScan` (+ `frames`) + an "RDM scan" note naming a narrowed choice;
  a timeframe named in the prompt still wins; no valid setup anywhere = NO_SIGNAL.
  RDM timeframes (owner-specified): ONE setting in Preference Mode, shared picker `RdmTimeframePicker.tsx` (All or any timeframes, at least
  one) shown in Preference Mode (always), and closed by default under RDM in the composer's timeframe pop-up and the watchlist (add form, a
  pair's timeframe edit): owner-specified, it opens ONLY when RDM is tapped (a second tap, Save or Cancel folds it away; draft mode, Save stores); a change anywhere saves the preference and is used everywhere. Shared helpers
  `normalizeRdmTimeframes` / `rdmFrames` / `rdmLabel` in `src/utils/preferences.ts` (every timeframe ticked is stored as []).
  Analysis mode (owner-specified, Preference Mode `users.preferences.analysisMode` NORMAL default / CONFIRMATION, two cards in
  `PreferencePanel.tsx` + "How confirmation works", an emerald dot on the composer's Tools button when on, a note in the watchlist): NORMAL is the engine
  above, untouched. CONFIRMATION (`server/confirmation.ts`, `applyConfirmation` inside `buildStructureMap` when the mode is passed; reads
  the lower timeframe `confirmationTimeframe` alongside, e.g. 1H→5m, 4H→30m, 1D→2H): candidate zones = right territory, displacement
  FVG, first or second touch (a tapped zone can confirm), Fib confluence (`planForZone`, exported only). No trade until price touches the
  zone in the recent window (3 HTF candles of LTF bars) and an LTF candle at/after the reaction extreme shows a confirmation that closes
  in the zone's upper half (sells mirrored): liquidity sweep / false breakout (wick through the distal, close back inside), local-low sweep,
  engulfing, pin bar, morning/evening star, structure break; RSI(14) on the LTF not 70+ for buys / 30- for sells, divergence adds score.
  Price closing through the zone = no trade; confirmation older than 2 HTF candles = played out. Then: MARKET entry at the live price,
  stop beyond the reaction extreme wick (+0.4 LTF ATR, tight 0.2; min risk 0.8 / 0.5 LTF ATR), targets from the engine's ladder (TP1 ≥ 1R),
  score ≥ `CONFIRM_MIN_SCORE` 70; "already moved" is judged from the confirmation close against the TP1 that paid 1R from there (a target
  hit since, or half-way = no trade). Otherwise NO_SIGNAL with "Setup found, waiting for confirmation" (WAITING_TAP: valid zone ahead;
  WAITING_PATTERN: price at the zone). The analyze handler tags results `analysisMode` + `confirmationRead` {state, ltf, zone, patterns,
  sweptZone}, prepends a "> **Confirmation analysis:**" note and rewrites the entry/stop rationales for confirmed trades (prompt text
  untouched; card tag "Confirmed · 5m" / "Waiting for confirmation"). Watchlist items carry `analysisMode` (scan key includes it): READY
  only when confirmed (`setup.confirmation`, "confirmed" notices), BUILDING = waiting for confirmation; `syncWatchPrefs` moves a trader's
  pairs when the mode or RDM timeframes change.
  Strategy Builder + Confirmation (owner-specified, every strategy): with CONFIRMATION on, `runUserStrategy` (`opts.confirm` {ltf, ltfName}) only
  serves a setup once price reached its zone and the LTF confirmed it (`readZoneConfirmation` / `confirmWords` from `server/confirmation.ts`, same
  rules and windows; RANGE_SWEEP = the range low down to the sweep wick, SESSION_BREAKOUT = the broken range high, thin levels get 0.25 ATR): MARKET
  entry, stop also beyond the reaction wick (+0.4 / 0.2 LTF ATR), mitigation + half-way measured from the confirming LTF candle, `signal.confirmation`;
  else NO_SIGNAL "Setup found, waiting for confirmation" (`confirmationRead` WAITING_TAP / WAITING_PATTERN). `serveUserStrategyAnalysis` (`mode`) and
  the watchlist strategy scan fetch the LTF too and tag/scan like the general engine (READY = confirmed, BUILDING = waiting, keys RSC / CS).
  Trade type (owner-specified, Preference Mode `users.preferences.tradeStyle` ANY default / SCALP / DAY / SWING, shared `src/utils/tradeStyle.ts`,
  cards in `PreferencePanel.tsx`, a dot on the composer's Tools button, watchlist note, card tag "Day trade · close by 9:00 PM WAT"): every analysis runs on a timeframe of
  the type (SCALP 1m to 15m, DAY 15m to 2H, SWING 4H to 1W; another timeframe moves to the nearest, `fitTimeframe`; RDM scans only the type's,
  `styleRdmFrames`), whatever strategy is on (Strategy Builder: its own timeframes inside the type first, else the type's, `styleStrategyFrames`);
  the watchlist scans the same way (items carry `tradeStyle`, `syncWatchPrefs` moves them).
  Trade type timeframes (owner-specified, `users.preferences.styleTimeframes` {SCALP, DAY, SWING}, each [] = all of the type's,
  `normalizeStyleFrames` / `styleFrames(style, custom)`; chips under the trade type cards in `PreferencePanel.tsx`, at least one on, "Use
  all"): while that type is on, the kept timeframes override every other timeframe on the site: the composer pick moves to the nearest
  kept one (`fitTimeframe`), RDM scans exactly them instead of the RDM choice (`styleRdmFrames`), the Strategy Builder runs inside them
  (`styleStrategyFrames`) and watchlist items carry `styleFrames` (`syncWatchPrefs` moves them on change); All types switches it off and
  each type's choice is remembered. `tagTradeStyle` in `server.ts` tags each result
  `strategy.tradeStyle` {style, label, closeBy, closeByText, askedTimeframe} and prepends a note (prompt text untouched). DAY trades close at 9:00 PM
  WAT the same day (issued under 30 min before = next day), SWING at Friday 9:00 PM WAT (under 24h before = next Friday), `closeDeadline`; SCALP has
  no forced close. The close time rides on the offer, the price alert (heads-up 30 min before, `warnClose`; at the close an END hit at the last
  candle's price, `endedReason` ENDED, "close your trade now"), the auto journal (closed at that price, scored by P/L), the track record (outcome
  ENDED with its R, counted in totalR, not a win or loss, `stats.ended`), the checker and the Solana record (proof `style`/`closeBy` outside the
  seal; result ENDED / NOT_TRIGGERED decided at the close; memo "(day trade)").
  POI method (owner-specified): dealing range = recent swing range; its 0.50 equilibrium splits premium/discount. Demand only in
  discount, supply only in premium (range and Fib leg). POI map (`poiList`): demand order blocks, supply zones, FVGs, golden
  pocket pool, each with verified mitigation.
- Back-tested edge + setup quality (owner-specified, Oct 2026, from the walk-forward back-tests): `server/edge.ts` lists, per market and
  timeframe, the combinations switched OFF (no signal, with a plain reason: Normal `NORMAL_OFF` e.g. EUR/USD 4H + 1D, USD/JPY 1D, NAS100 4H + 1D,
  gold 1D; Confirmation `CONFIRM_OFF`: gold on 4H and above, NAS100 4H) and the WEAK ones (a "> **Heads-up:**" line, `edgeNote`), plus the
  prior R used by the score. `setupQuality` in `server/strategy.ts` grades every plan 20-95 from the traits that predicted results (prior,
  trend, zone age, base candles, volatility percentile, distance, zone width, confluence, divergence, departure); it is the card's
  "Quality N/100" (`confidenceScore`), the RDM and watchlist ranking, and a floor: under `MIN_SIGNAL_QUALITY` 45 = no signal (env
  override for tests only). Market entries are refused in a hot market (ATR percentile ≥ 0.67) or deep in the zone. Tight SL is never used on
  1D/1W, crypto or Confirmation (Normal SL with a "> **Stop loss:**" note, `slNote`). Forex 1D/1W zones use looser leg rules and forex
  daily candles are built from 60m bars (`FOREX_DAILY_PLAN`, Sundays folded into Monday): the daily feed was flat. Confirmation tuning
  `CONFIRM_TUNING` (back-test grid: TP1 ≥ 2R, quality ≥ 45; extra stop room and a measured TP1 tested worse, so off). Strategy Builder signals use
  `ruleSetupQuality` (same 20-95 scale). Every LONG/SHORT card carries the risk note "Expect losing streaks… Risk 0.5% … or less".
- Volume confluence (owner-requested, Oct 2026, back-tested): candles carry `v` (traded volume) when the feed has a real one
  (Binance/Bybit/MEXC/GeckoTerminal `r[5]`, Yahoo `volume`; never spot forex or Deriv), summed by `aggregateCandles` / `foldSundays`.
  `volumeProfile` (point of control + 70% value area of the last 120 candles, only when 60%+ of them have volume) and `volumeFlow`
  (volume-weighted close location, who has been in charge) in `server/strategy.ts`; the map carries `volume` {poc, valueLow,
  valueHigh, flow6, flow24} and the write-up a "**Volume profile:**" line (the flow part says "information only": it did NOT hold
  up in the back-tests). The POC distance feeds `setupQuality` (`poc`) and, on charts up to 2H only, is a gate: a buy's entry must
  sit at least `VOLUME_POC_MIN_R` (1R) below the POC, a sell above it (`volumeBlocked`, "No signal… where most volume traded");
  on 4H and above it tested worse, so there it is information only. Back-test (BTC, ETH, gold, Nasdaq 1H): 31.0% → 32.9% won,
  +1.54R → +1.68R, max drawdown 64R → 55R. The Buyers vs Sellers meter (`server/pressure.ts`) stays information only.
- Institutional zone rules (owner-requested review, Oct 2026): zones are leg-in → base (1-3 basing candles, or the last opposite candle)
  → explosive leg-out (RBR/DBR/RBD/DBD), with FVG, break of structure and freshness, entered with the Fibonacci band inside the zone.
  Stricter textbook variants were back-tested via `ZONE_RULES` in `server/strategy.ts` (strictBase, minLegIn, legOutCandles, entry BASE)
  and all did worse (e.g. all strict together 21.0% won / +1.09R vs 30.7% / +1.34R), so they stay OFF; change them only with a new back-test.
- Steady mode (owner-specified option C, Preference Mode `users.preferences.steadyMode`, off by default, Normal analysis only; a switch under
  the Analysis mode cards, a lime dot on the composer's Tools button, Tools sheet "Active now", a note in the watchlist): internally the engine
  mode `STEADY` (`EngineMode` / `engineModeOf` in `src/utils/preferences.ts`; watch items store it in `analysisMode`, the client sees NORMAL +
  `steady`). `applySteady` in `server/strategy.ts` (after `buildMarketMap`, inside `buildStructureMap`): limit entries only, 1H/4H only
  (`STEADY_FRAMES`; the handler moves the timeframe to the nearest with `steadyTimeframe`, inside the trade type's timeframes, RDM scans only
  them; none allowed = a Normal analysis saying so), no hot market (ATR percentile ≥ 0.67), stop moved to `STEADY_STOP_MULT` 3 × its normal
  distance (same entry and price targets, R recomputed) and untouched since the zone formed; else "No signal (Steady mode)…". Results carry
  `strategy.steadyMode` and a "> **Stop loss:** Steady mode…" note. Strategy Builder and Confirmation ignore it.
- Secure half (owner-specified, Preference Mode `users.preferences.secureHalf`, off by default): at +1R take half off and move the stop to
  entry. The card shows the +1R price (`TradeNotes` in `ChatFeed.tsx`); a price alert started while it is on stores `secureHalf` (the +1R
  price, `secureHalfPrice`) and `evaluateBars` adds HALF (+1R, notice "secure half now") then treats entry as the stop from the next candle
  (BE = the rest closed at entry, alert ended `BE`). Journal and track record score it 0.5 × 1R + 0.5 × the rest (`withHalf`; HALF then BE =
  +0.5R, a WIN; `trackRecord.secureHalf`). Public seals / Solana records stay on the signal's own levels.
- Removed for good (owner-specified): the "One trade at a time" trade lock (`server/signalLock.ts`, its Preference Mode switch,
  the before/after-engine checks, the watchlist hold, the held-trade card and the credit give-back) is deleted. Every analysis can
  give a trade, whatever trades the trader already has. Never bring it back or add anything like it. Stored `preferences.tradeLock`
  / `tradeLockChosenAt` are dropped by `withDefaults` and deleted from storage the first time `GET /api/preferences` reads them.
- Strategy Builder (owner-specified, Option B: rules in code, the engine for words; called "Strategy Builder on/off" to traders, never "Strategy mode"):
  `/strategy-builder` (`StrategyBuilderPanel.tsx`, slash command live; library + My strategies + on/off; build = 1 Explain (free text, guiding questions) → 2 Guided (setup, direction,
  timeframes, markets, trend/RSI/session filters, stop, targets, min R, params) → 3 Review (plain rules + "Not automated" list, name, Save / Save and
  use)). Shared rules `src/utils/strategyRules.ts` (`StrategyRules`, 10 setups `SETUPS`: SMC_OB_RETEST, ICT_SWEEP_FVG, EMA_PULLBACK,
  BREAKOUT_RETEST, RSI_DIVERGENCE, MA_CROSS, SR_BOUNCE, BOLLINGER_REVERSION, SESSION_BREAKOUT, RANGE_SWEEP; 11 `STRATEGY_TEMPLATES`, none is the
  general engine's S&D + Fibonacci; `normalizeRules` clamps everything; `describeRules`, `shortSummary`). Rules engine `server/userStrategy.ts`
  (`runUserStrategy`: setup on the latest candles, sells on the mirrored chart; filters; STRUCTURE/ATR stop; R + structure targets in price
  order, TP1 ≥ 1R, final ≥ minRR; market entries rejected if TP1 hit since the trigger or price half-way to it; limit entries ahead of price;
  "already mitigated" (owner-specified): no candle since the setup formed may have reached the stop or any TP, or traded into a limit entry band).
  Words engine `server/strategyAi.ts` (owner-specified: API 2 removed, ONE key): uses the general engine's connection (`useMainEngine(getGeminiClient)`
  in `server.ts`, same `GEMINI_API_KEY` and the same three models; `getGeminiClient`/`modelsToTry` are only called, never changed), but every request
  carries only the Strategy Builder's own instructions, never the general engine's prompts (and vice versa); with the builder off it never runs;
  `compileStrategy` (free text + guided → rules JSON; guided-only = no call; the trader's text only ever in the user message, fenced and
  labelled untrusted, never in a system instruction; reply validated/clamped; `notSupported` listed) and `explainTrade` (write-up of a found
  trade; levels never changed; provider names scrubbed). Storage `server/strategyBuilder.ts`: `userStrategies/{st_…}` (max 10, names via
  `giftNoteProblem`), `users.strategyMode {enabled, strategyId}`, routes `GET/POST /api/strategies`, `/compile` (20/h per trader), `PUT/DELETE
  /api/strategies/:id`, `POST /api/strategies/mode`; build/save/switch-on are Pro after `PRO_GATE_AT` (off and delete always work).
  Analysis: `strategyProGate` (402 before credits for a locked mode) then, after the normal credit charge, `serveUserStrategyAnalysis` in
  `server.ts` replaces the general engine for analyses (not questions, not chart screenshots): candles → rules (RDM = RDM choice ∩ strategy
  timeframes, strongest wins), market/timeframe the strategy doesn't trade = NO_SIGNAL saying so, same result shape (`strategyEngine.method`
  USER_STRATEGY, `userStrategy`, no S&D/Fib fields), a trade's write-up from the words engine (models staggered: the next starts after 6s, 30s cap; owner-requested fix:
  if it can't answer, the trade is still served with `rulesWriteUp`, written from the rules and levels, never the general engine), a no-signal explained from the rules; proofs, alert offers, journal follow as usual. A found trade
  gets ONLY the hard checks (`personalStrategyStatus` / `enforcePersonalStrategyCheck`: stop/targets on the right side and not reached, a
  limit entry not traded through), never the general engine's "already moved" proximity guard (the trader's rules govern the entry); the
  watchlist's strategy scan applies the same check, so a "setup ready" there is what the analysis serves. Offers/alerts/track
  record carry `userStrategy` and MarketX-wide stats exclude it. Watchlist items carry `strategyId` (`syncWatchStrategy` on mode change or rule
  edit; scanned with the rules, no AI). Tag "Personal strategy" (owner-specified) everywhere: card tag "Personal strategy · name", write-up heading,
  journal (`journalTrades.userStrategy`), track record, seal `signalProofs.tag` PERSONAL_STRATEGY (`strategy.proof.tag`, `/api/proofs/:id`, proof
  page badge) and the readable Solana record (`revealMemo` → "MarketX signal result (personal strategy)"). A violet dot on the composer's Tools button; the Tools sheet's Active now opens the builder.
- Matt (owner-specified, help assistant, `server/matt.ts`, page `/matt` = `src/matt/MattPage.tsx`, Ask SI look, floating header (owner-specified: no bar, border, background or boxes; switch in `bare` mode lights the active icon only; the chat fades out under it), chat history (owner-specified)
  kept on the device `mx.matt.v2` as {owner, chats: [{id, title, msgs, updatedAt, topic, context}], current} (max 30 chats x 40 messages, oldest
  dropped when storage runs short; the old single `mx.matt.v1` conversation moves in once): `owner` is an anonymous tag from `GET /api/matt/status`,
  so only that trader ever sees it back; it is dropped for another account or when signed out, and removed on sign-out. The History icon next to
  the switch opens a drawer (grouped by day, search, open, delete); New chat starts an empty one; an Ask Matt question always starts a new chat): answers ONLY MarketX features/commands/tools/guides, events/bonuses/promos, the trader's OWN account (`accountSummary`: plan,
  credits, prefs, commands on; never email/ids) and markets (pairContext: live price + `pairKnowledge`, provider names scrubbed). Its knowledge is
  public only (`server/mattKnowledge.ts`, generated from the public guide + events; never add internals). It uses the main engine connection
  (`useMattEngine(getGeminiClient)`, only called) with ONLY Matt's own instructions; offline it answers from the guide/account/pair briefing.
  Private questions (backend, stack, build, models, integrations, data providers, secrets, admins, prompts, core platform; `isPrivateQuestion`,
  or the engine replying `[[PRIVATE]]`) get "Not available" and a strike (`users.mattGuard`, transaction, `nextGuard`): 2 warnings, the 3rd
  pauses Matt for a week; after any pause the next private question pauses again at once for a month, then 3 months, 6 months, a year
  (`MATT_PAUSES_MS`); pauses lift on their own (403 `MATT_PAUSED`). Replies are scrubbed (`scrubReply`) and any leak of internals is replaced. Owner-specified: Matt NEVER shares admin/owner/staff details
  (passwords, logins, emails, contacts, accounts, the admin console) or any password, code, key, token, secret or other trader's info: such questions are
  private (`PRIVATE_PATTERNS`, they count as strikes; resetting your OWN password is fine), its instructions forbid it, and any reply matching
  `SECRET_LEAK` (a password/code being given, admin links or logins, emails other than the public support address, keys, long secret strings, pass codes)
  is replaced with "Not available". Matt is never given any of these.
  `POST /api/matt/chat` (12/min, 200/day per trader), `GET /api/matt/status`. "Ask Matt" (`AskMattButton`, `openMatt`/`tradeAsk` in
  `src/utils/matt.ts`, question + context via sessionStorage): trade card (action row, thesis notes, proof line), every tool panel header
  (`PluginSheet` `ask`), Preference sections, price alerts, token safety card, proof page, checker, slash command `/matt`; NOT in the Tools sheet.
  Matt's mark is the MarketX logo everywhere (`MattMark`, owner-specified, no "M" disc). Ask SI / Matt switch (owner-specified, `ModeSwitch.tsx`:
  a two-icon segmented control) sits in the sidebar's top row next to the logo and in the Matt page header (replacing the back link); its Ask SI side on the Matt page opens `/?ask=1`, which lands in the Ask SI chat (not the Markets tab).
- Fundamental Analysis (owner-specified, `/fundamental-analysis`, `server/fundamental.ts`, shared types `src/utils/fundamental.ts`, panel
  `FundamentalPanel.tsx` (on/off, topics, this week's high-impact releases), card `FundamentalCard.tsx`, a sky dot on the composer's Tools
  button, listed in the Tools sheet): a command the trader switches on (`users.fundamentalMode {enabled, at}`, `GET /api/fundamental`, `POST /api/fundamental/mode`).
  Owner-specified: it NEVER changes normal analyses. Only a prompt that starts with the command (`fundamentalTopic` in `src/utils/fundamental.ts`:
  "/fundamental-analysis CPI", alias "/ch-fd CPI") goes to `POST /api/fundamental/analyze` (`runFundamental` in `App.tsx`, same 10s intro; the
  command is stripped, the topic is asked); with the command off it opens the panel. Every other prompt, on or off, is a normal analysis or question.
  Picking the command in the slash menu while on puts "/fundamental-analysis " in the input. "Check fundamental" (ch-fd) button on every analysis
  card whose news indicator shows (`isNewsCurrent(strategy.newsBrief)`, `onCheckFundamental` in `ChatFeed.tsx`): reads today's high-impact
  releases for that pair (switches the command on if needed). "Recheck" on the card (owner-specified, `POST /api/fundamental/recheck`,
  `recheckFundamental` in `App.tsx`): reads the same question again now (never the 10-min cache; the question rides on the read as `question`),
  and `compareReads` in `src/utils/fundamental.ts` sets `recheck` {state STILL_VALID / CHANGED / RELEASED, headline, lines, dueAt}: released or
  not (actual vs forecast), forecast changed, most likely outcome changed, pair biases flipped, against the earlier read the app sends back
  (`readPrevious` keeps only short cleaned fields). Live data on a recheck (owner-specified): the engine is told it is a RECHECK of the earlier
  read and must search the latest information (released figure into `data.actual` + status RELEASED, else actual empty; `whatsNew` = "Update: …"
  line), the live calendar's released figure (`actual` in `getFullCalendar`) is given to it and fills a missing actual when exactly one matching
  line is out, and headlines since the earlier read ride on `recheck.news`. Card: Actual = the figure (sky tile, "just out", above/below/in line with
  forecast), else Pending ("Awaiting figure" once the time has passed). The card updates in place with a banner; one credit, refunded on failure. Save / share (owner-specified, `src/utils/fundamentalShare.ts`, buttons on the card):
  "Save image" draws the card picture (canvas 1080x1350 @2x: forecast, or the result once `data.actual` is in, username, marketx.world; drawn ahead on
  hover/touch, `prepareFundamentalCard`) and downloads it (iPhone: share sheet → Save Image to Photos); "Share" sends picture + brief text via the share
  sheet (else copies the text and saves the picture); "Post on X" opens `openXPost(buildFundamentalShareText)`: key points only, ≤ 280. Every read is kept (owner-specified):
  the sidebar History has a Fundamentals tab (`fundamentalReads` in `Sidebar.tsx`, from the chats' `fundamental` messages, opens the read via
  `openChatMessage`), and each read or recheck sends its own notification + email (`fundamentalAlert` in `server/account.ts`: release, most likely
  with odds, effect, actual/forecast/previous, pairs for/against, confidence, recheck result; button = `/?chat=&msg=` of that read; `important`
  = sent at once, never paced out, still only with activity emails on). The analysis engine and `/api/market/analyze` are untouched. One credit
  (`chargeAnalysisCredit`, after the on-check); refunded on 422 `NOT_FUNDAMENTAL` (engine replies NOT_FUNDAMENTAL), 503 `FUNDAMENTAL_UNAVAILABLE`, 409
  `FUNDAMENTAL_OFF` before any charge. Its own instructions only (`FUNDAMENTAL_SYSTEM`; the engine connection is only called via
  `useFundamentalEngine(getGeminiClient)`, web search on, same three models, shared `aiGate`); the trader's text only in the user message, fenced and
  labelled untrusted. Context: this week's matching calendar lines (`calendarMatches`, exact titles, figures given to the engine, release time kept),
  headlines from the last 4 days (`relevantHeadlines`: BBC Business + CNBC Economy RSS fetched here only, plus the MarketWatch wires). Engine calls (`askEngine`): every reply is checked
  by the caller's `accept` (a report `parseReport` can read, or NOT_FUNDAMENTAL in any form, `isNotFundamental`); an unreadable one moves on to the
  next engine; the web-search read gets a fast backup started alongside it after `FUNDAMENTAL_HEDGE_MS` (30s: no search, JSON only, still with the
  live calendar + headlines); first usable answer wins; `extractJson` repairs small slips. 503 only when every engine failed. Reply = one JSON
  object, validated (`parseReport`): 2-4 scenarios normalised to 100, most likely = the top scenario, confidence ≤ 90, pairs folded to MarketX symbols
  (`normalizePairSymbol`), bias FOR (the most likely outcome favours the pair rising) / AGAINST / NEUTRAL, provider names scrubbed. The engine never
  writes prices: each pair's live price is fetched at serve time (`deps.quote` → `livePriceFor`, none = none shown). Same question reused 10 min (prices
  still fetched fresh, credit still used). Response {message (Markdown for notifications), fundamental, research}; chat history keeps `fundamental`.
- "Explain MarketX" campaign (`server/campaigns.ts`, page `/campaigns/explain-marketx`, open until 30 Oct 2026 Lagos time):
  users submit an X post link; credits are NEVER automatic. An admin approves (+50 campaign credits, notification + email)
  or declines with a reason in Admin, Campaign. One reward per person (email hash). It is listed only as a card in the
  notification Rewards tab (next to the 10 credit Share on X card); nobody is notified about the campaign itself.
- Leaderboard + invites (owner-specified, `server/leaderboard.ts`, `server/usageMonthly.ts`, panel `LeaderboardPanel.tsx`, card `InviteCard.tsx`,
  admin `src/admin/Leaderboard.tsx`): ONE panel with an animated two-way switch (Usage / Referrals), opened from the sidebar trophy, `/leaderboard`,
  the profile invite card and `/?leaderboard=1&board=referrals`. Usage = this month's points (`leaderboards/{YYYY-MM}/entries/{uid}`, month in
  `CREDIT_RESET_TZ`, so it resets at 00:00 on the 1st with nothing to sweep): `recordMonthly` from `analysisAlert` (analysis 10 / question 4),
  `fundamentalAlert` (8) and Matt answers (2), +5 for a day's first scored action, each kind capped per day (`USAGE_DAILY_CAP`); levels `TIERS`,
  best streak, active days, top market, live countdown, last month's top 3. Referrals = all-time `users.referral.invited` (+ this month). Public rows
  carry display name, username, picture, badge only (never email, uid or other traders' earned credits); unlimited staff, hidden
  (`users.leaderboardHidden`, `POST /api/leaderboard/visibility`), banned and suspended accounts are left off; boards cached 30s per worker.
  Invites: random code `referralCodes/{CODE}` (`GET /api/referrals/me`), link `/?ref=CODE` kept on the device 30 days (`src/utils/referral.ts`,
  removed from the address bar, signed-out visitors land on Create account with "Invited by"), sent as `ref` with email and Google sign-up, stored on
  the pending sign-up (`referralCode`) and recorded ONLY when `/api/access/redeem` creates the account (`recordReferral`, one transaction: one
  per person ever via `referralClaims/{sha256(canonical email)}`, no self-invites, inviter not banned/suspended). Invite rewards (owner-specified):
  OFF by default, `adminConfig/inviteRewards {enabled, credits 1-500, maxPerMonth}` set only in Admin → Invite rewards (`PUT
  /api/admin/invite-rewards`); while on, the inviter gets that many credits into the campaign pool, inside the same transaction, never retroactively.
  Profile shows invited / this month / credits earned. Admin → Leaderboard lists both boards with emails, month picker and the latest invited
  sign-ups. Account deletion removes the trader's rows, code and referral record.
  Optional "Invite code" box on Create account (owner-specified, `AuthModal.tsx`, prefilled from a link): sent as `ref` (email and Google); a
  typed code that isn't real is 400 `INVALID_INVITE` (`inviteCodeValid`), empty is fine. Kept off the boards (owner-specified): accounts matched
  by a fingerprint of their email (`BLOCKED_KEYS`) or MarketX ID (`BLOCKED_ID_KEYS`, flagged by a lead-worker check of the ID index every 6h)
  or flagged `users.leaderboardBlocked` (Admin → Leaderboard "Keep off" / "Allow", `POST /api/admin/leaderboard/block`) never show on public
  boards and can't switch themselves back on (`me.locked`); never write the address or ID itself in the code.
- Admin → Credits (owner-specified, `server/adminCredits.ts`, `src/admin/Credits.tsx`): find a trader by email, MarketX ID, @username or account
  id (`findTrader`, `GET /api/admin/credits/lookup`) and gift 1-10,000 credits (`POST /api/admin/credits/gift`, transaction, into the campaign
  pool so they are spent first; refused for banned and unlimited accounts), with an optional note; the trader gets a notification + email;
  each gift is kept in `adminGifts` (`GET /api/admin/credits/gifts`, unlinked from the account on deletion).
- Every coin and meme (owner-specified): `server/cryptoUniverse.ts` loads the USDT spot lists of Binance, Bybit and MEXC (every 6h,
  per worker) and resolves on-chain tokens by ticker or contract address via DexScreener (most liquid pool, `MIN_DEX_LIQUIDITY_USD`
  default $20k) with GeckoTerminal candles (series shared across timeframes, 60s cache). `detectCryptoTicker` in
  `src/utils/cryptoTicker.ts` (shared) finds cashtags, pairs, addresses, meme names (`CRYPTO_ALIASES`, incl. Ansem) and tickers;
  `extractAssetInfo` runs it after majors/forex/stocks, `resolveAssetInfo` (async) finishes on-chain lookups. A coin listed nowhere
  returns 404 `UNKNOWN_ASSET` (credit refunded), never a placeholder price.
- Fresh prices only (owner-specified): every price the site uses is fetched from its source at the moment it is needed
  (`server/liveQuote.ts`: shared only within the same second). Every quote carries `asOf` (when its oldest input was fetched,
  tracked by `withFreshness` in `freshQuote`); one older than `QUOTE_MAX_AGE_MS` (5s: a feed hiccup's last good value, an
  earlier streamed quote, the daily forex reference rate) is `live: false` and never used as the current price. `livePriceFor`
  in `server.ts` is the one way to read "the price now" (quote endpoint, watchlist, alert refresh, question
  answers): the fresh quote, else the close of the latest real candle fetched right now, else nothing (503 `PRICE_UNAVAILABLE`,
  credit refunded). Analyses follow the same rule. Nothing is reused from an earlier request, trader or analysis.
  Price guard (owner-specified, `server/priceGuard.ts`, a `res.json` wrapper on `/api/market/analyze`, plus Matt's replies): "trading at X"
  claims more than 0.6% off the live price (`res.locals.liveQuotePrice`) are corrected to it, and in trade write-ups any sentence naming a
  price level that is not in the verified result (`numbersIn(strategy)` + live price, 0.15%) is removed (R, %, ATR, ratios and
  ~~crossed-out~~ numbers are ignored). Levels are never changed; the prompt text is untouched. Chart notes only say "live price now" for a live quote.
- Buyers vs Sellers (owner-specified, INFORMATION ONLY, strict): `server/pressure.ts` (`readPressure`, pure) + `GET /api/pressure?symbol=` (signed in,
  40/min per trader, one read per market shared for 5s, 8s cap, 503 `PRESSURE_UNAVAILABLE`) and `PressureMeter.tsx` on every analysis card in `ChatFeed.tsx`
  (above the execution thesis; fetches on its own, refreshes every 15s only while on screen and the tab is visible). Read from fresh 1M candles (5M
  fallback): close location in the true range, weighted by size and recency; for Binance-routed coins also taker buy volume (65% flow / 35% price
  action); main window 60 min, last 15 min = buyers/sellers gaining; quiet = no candle for 20 min. NEVER read by the analysis engine, its
  instructions, the analyze route, signals, the watchlist or alerts, and never added to the analysis response.
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
  Every video, whatever it is about, ENDS with the line "MarketX, the Super Intelligence system for every market" (on screen,
  and spoken when the video has a voice-over) as its final card.
  Owner-specified for every new video: the site is always captured in LIGHT mode; every phone/device is shown whole (all
  four sides, frame and body in view, never cropped by the video edge); the music is always in the style of the owner's
  chosen ad track (the Epidemic Sound track used in the MarketX ad, ~101 BPM, a quiet build-up then a bass drop), with
  the cuts timed to its beat.
- Brand (owner-specified): the site says SI / Super Intelligence, never AI ("MarketX SI", "Ask SI", "SI credits"). X handle
  is @_MarketX (`MARKETX_X_URL` / `MARKETX_X_HANDLE` in `src/utils/campaign.ts`). Parent company (owner-specified): SpiriTech Labs owns and built MarketX; credited as "Built by SpiriTech Labs" in the
  sidebar Settings (under Terms & Privacy), the guide, Terms, proof and checker footers, the email footer, the `index.html` JSON-LD (`#spiritech`
  parentOrganization / creator, meta author) and Matt's public knowledge. Telegram buttons link to `/go/telegram`, a
  server redirect to `TELEGRAM_INVITE_URL` (t.me only), so the invite link never ships in the page or bundle, and it is never written in the
  code or `.env.example` (the repository is public); unset = the buttons open @_MarketX on X.
  YouTube (owner-specified): the channel is linked everywhere through `/go/youtube` (`MARKETX_YOUTUBE_URL`), a server redirect to
  `YOUTUBE_CHANNEL_URL` (youtube.com only, default the @marketx-si channel), so the address never ships in the page or emails; `YouTubeIcon`
  in `SocialIcons.tsx`; buttons next to Telegram in the sidebar, the Markets support desk ("Watch on YouTube"), Terms footer, emails.
  X short link (owner-requested): `/go/x` redirects to `X_PROFILE_URL` (x.com / twitter.com only, default https://x.com/_MarketX), for sharing
  marketx.world/go/x; the site's own X buttons keep linking to `MARKETX_X_URL` directly.
- Share to X (`buildShareText` / `openXPost` in `src/utils/shareText.ts`, used by `shareToX`): every result card (general engine and
  Strategy Builder, trades and no signals) opens x.com's post box filled with the result: side, pair, timeframe, entry, stop, TPs, R:R,
  the Solana proof link, the origin (Personal strategy name, Confirmed on the LTF, RDM pick) and @_MarketX, always within X's 280 limit
  (least important lines dropped first). It never @mentions the trader (MarketX usernames are not X handles).
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
  email-derived name like that becomes a neutral `trader…` name; unlimited staff accounts are exempt. Display names go through `cleanDisplayName` (text only;
  hidden, zero-width and direction-flipping characters removed; one line, 40 chars) at sign-up, Google sign-up and rename. Profile
  pictures go through `safeAvatar`: an uploaded png/jpeg/webp image or a Google account photo only (any other address could log viewers' IPs),
  on save, at Google sign-up and in the public checker. Gift notes refuse links, contacts,
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
  track record and notices follow it; free for everyone; result waits at most 2.5s; card shows "Alert on · Auto"). Manual: as before. Every signal served is recorded as an
  `alertOffers` doc (levels server-side, via `alertOfferMiddleware` wrapping res.json; the analysis itself is untouched), and
  alerts (`priceAlerts`, id `al_{offerId}`) only ever use those stored levels. Only the lead worker monitors: active alerts in
  memory, one fresh 1-minute candle series per symbol per 5s cycle (`ALERT_TICK_MS`), candle high/low checks, hits written in transactions
  (entry zone, TP1-3, stop, or MISSED if a target comes before entry), then a notification + activity email. Unused signals get
  one "Want a price alert?" email after 15 minutes, at most one per trader every 6 hours. Clients poll notifications every 10s
  only while they have an active alert and the tab is visible (and at once when the tab comes back). Each hit message carries the
  price at detection ("Price now", the latest 1-minute close). The panel has a Refresh button: `GET /api/alerts?live=1` reloads the alerts and
  returns the live price of each market with an active alert (`deps.getQuote`, 5s cap, 12 markets); each active card shows the live
  price, today's change and where price sits (distance to the entry zone, or P/L from entry, % to the next TP and to the SL).
- Watchlist (`/watchlist`, `server/watchlist.ts`, `src/components/WatchlistPanel.tsx`): the trader approves it once (`users.watchlist.enabled`);
  a pair (`watchItems`, max 12) is added only after the server confirms a live quote and 40+ candles on its timeframe (1H for RDM, or the first
  chosen RDM timeframe of an hour or more). RDM pairs scan the trader's RDM timeframes (`rdmFrames` on the item, copied on add / switch to RDM;
  saving the preference calls `syncWatchPrefs`, which moves the trader's pairs to the new RDM choice / analysis mode and rescans them). Editing a pair's timeframe
  (owner-requested, never delete + re-add): the pair's timeframe chip (pencil) opens `TimeframeEditor` in `WatchlistPanel.tsx` (draft: tap one timeframe, or RDM
  and its timeframes in `RdmTimeframePicker` with `note`; nothing changes until Save, Cancel discards); Save stores a changed RDM choice first (the one shared
  preference) then `PATCH /api/watchlist/:id`. Tapping a timeframe in the add row above offers "Save X to all pairs" when some pair differs
  (`POST /api/watchlist/timeframe`, Pro, every pair moved with the same `applyTimeframe` + rescan, returns `changed`). The lead
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
- Daily news alerts (owner-specified, `server/newsAlerts.ts`, Preference Mode "News alerts", `users.preferences.newsAlerts {enabled, impacts}`
  HIGH/MEDIUM/LOW, `normalizeNewsImpacts` / `readNewsAlerts` / `newsImpactLabel` in `src/utils/preferences.ts`, off by default): lead worker sweep every
  10 min (`NEWS_ALERT_SWEEP_MS`) from `NEWS_ALERT_HOUR` (7:00 AM site TZ, WAT): each trader on gets ONE notification + ONE email per day (claimed in a
  transaction, `users.newsAlertsDay`) with the releases due in the next 24h of the chosen impacts from the LIVE calendar (`getFullCalendar` in
  `server/news.ts`, all impacts + `actual`; the analysis keeps `getCalendar`, high impact only, untouched), high first, max 12. Each release = a mail
  `section` (mailer `sections`: tag, title, 3-line briefing, its own "Analyze it on MarketX" button `/?fundamental=<CUR title>`); briefings written once per
  release per day by the engine (`writeNewsBriefings` in `server/fundamental.ts`, own instructions, web search on) or `templateBriefing`. Sent at once
  (`priority: 'high'`), regardless of the activity-email switch (the trader opted in here). Nothing sent on a day with no match. Notification
  `actionPrompt` "/fundamental-analysis <first release>" runs `checkFundamental`; `/?fundamental=` (after sign-in) switches the tool on and puts the
  command in the input (`composerSeed` → `ChatInput.seedText`, not sent); `/?news=1` opens Fundamental Analysis.
- Preference Mode (`/preference`, `server/preferences.ts`, shared `src/utils/preferences.ts`, `PreferencePanel.tsx`, free): `users.preferences`
  {timeframe, slMode, accountSize, currency USD/NGN/EUR/GBP, riskPct 0.1 to 10, view DETAILED/SIMPLE, homeMarket, rdmTimeframes, analysisMode}, validated, autosaved
  (`PUT /api/preferences`, `reset`). Applies to the composer defaults, the trade card money strip (`PositionStrip`: risk and each TP in money; units
  only for USD-priced crypto/stock/commodity with a USD account), Simple view (write-up folded), the Markets tab and the calculator. Only
  `analysisMode` and `rdmTimeframes` change how analyses and the watchlist run. Listed under More tools in the Tools sheet and opens from the slash menu. Backtest was removed (owner-specified): no
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
  Safety check in chat (owner-specified, free, no credit): `isSafetyRequest` in `src/utils/promptIntent.ts` ("is $WIF safe?", "rug check
  <address>", "honeypot", "/token-safety BONK" or "/safety", lessons like "what is a rug pull" excluded; only a crypto token or a Solana
  address, so "is it safe to buy gold" stays a question; major coins on their own chains, `isMajorCoin`, only on an outright rug check or
  `/safety`, so "is BTC safe to buy now?" stays a market question, `wantsSafetyCheck`). The client answers via `POST /api/token-safety/check` (signed in, 15/min per
  trader; a live "Reading the token from the Solana blockchain" step, then the card + Analyze / Info buttons); `tokenSafetyGate` (before
  `chargeAnalysisCredit`) does the same if one reaches the analyze route. `safetyAnswer` finds the mint: an address in the prompt, an
  on-chain token, or an exchange-listed coin whose most liquid pool is on Solana (WIF, BONK, JUP via `lookupDexToken`); SOL itself is
  explained, tokens on other chains get "trades mainly on X, not Solana". Bare crypto tokens get a third "Safety check" button
  (`MessageChoice.kind` 'safety'); the composer's slash menu lists Token Safety (Free).
  Signal proofs (`server/signalProof.ts`, `ProofBadge`, `/proof/<id>` page `src/proof/ProofPage.tsx`): `signalProofMiddleware` seals every
  LONG/SHORT served (`strategy.proof` {id, hash}): SHA-256("marketx-signal-v1\n" + canonical JSON of symbol, timeframe, side, execution,
  entry, stop, targets, issuedAt), stored in `signalProofs` (no identity). Lead worker every `PROOF_BATCH_MS` (1 min, only when new seals exist; "sealed now"): Merkle batch
  (`proofBatches`, leaf SHA-256(0x00‖hash), node SHA-256(0x01‖L‖R)), memo "MarketX proof v1 <batch> <root> n=<count>" sent from the proof
  wallet (one tx per batch, ~0.000005 SOL); no wallet / low balance / failure = waits and retries every `PROOF_RETRY_MS`
  (10 min). A sent but unconfirmed tx is stored and looked up first (`memoStatus`), so a batch is
  never written twice; batching and sending run under a Firestore lease (`adminConfig/proofLease`), one worker at a time. Each
  batch keeps `anchor.lastError` / `tries` / `lastTryAt`; Admin, Overview → "Solana signal proofs" (`/api/admin/proofs`) shows the
  proof wallet address + balance, RPC host, waiting batches with their reason, the last anchored txs (Solscan) and "Anchor now". `GET /api/proofs/:id` public (30/min per
  IP); the page recomputes the hash and Merkle path in the browser and links Solscan / Solana Explorer.
  Readable result records ("sealed now, readable later", owner-specified): each seal carries `reveal` (TRACKING → DUE → SENT → POSTED).
  `trackReveals` (lead worker, `REVEAL_TRACK_MS` 5 min) follows the trade on 1-minute candles with `evaluateBars` (same rules as alerts);
  when it ends (all TPs, SL, or TP1 before entry) or `REVEAL_AFTER_MS` (24h) after issue, `revealResult` fixes the result (WIN / LOSS /
  MISSED / NOT_TRIGGERED / OPEN / NO_DATA) and the proof cycle writes ONE readable memo per trade (`revealMemo`, ≤500 bytes: pair, side,
  entry, SL, TPs, issue time, result, fingerprint, proof link), only after its seal batch is anchored; sent txs are looked up before any
  resend. Live signals never go on chain readable. The proof page shows the result, "Read the result on Solscan" and "Seal on Solscan"
  for everyone; the public API never returns the proof wallet (fund it from an exchange, never from the main wallet).
  Result tracking picks, per trade, the finest candle series reaching back to its last check (`TRACK_TFS` 1M, 15M, 1H, 4H; feeds
  return ~300 bars), never a series with a gap. Seals made before readable records get one too (`backfillReveals` once, flag
  `adminConfig/revealBackfill`, plus at batching). The proof page polls every 15s while a step is waiting.
  MarketX ID (owner-specified, `server/traderId.ts`): every trader (new and existing) has a Solana address derived, never stored:
  ed25519 seed = HMAC-SHA256(`TRADER_ID_SECRET` or a secret generated once in `adminConfig/traderIds`, "marketx-trader-id-v1:" + uid).
  It co-signs (read-only signer, pays nothing) each readable result record of that trader's trades, so searching it on Solscan lists
  all their trades and results. Seals store `uid` (server only, never returned); older seals are matched to their trader via the
  `alertOffers` doc made in the same response (closest within 3s, a tie between traders stays unmatched). `GET /api/trader-id`
  (signed in), card `TraderIdCard.tsx` in the Profile tab (owner-specified, not Settings), a small "Check a MarketX ID" strip on the home
  page (opens `/checker?id=`), and the proof page shows the ID with an
  "All trades" Solscan link. Never change the secret (every ID would change).
  Activation (owner-specified: done by the OWNER, once): an address with no SOL "does not exist" on explorers. The Profile's ID card asks the
  trader to send `ACTIVATION_SOL` (0.001 SOL, above the 890,880-lamport rent-exempt minimum) to their ID from any wallet or exchange;
  `refreshActivation` reads the balance (at most every 15s per ID, on `GET /api/trader-id`, "I've sent it, check", and checker lookups) and
  marks `traderIds/{address}` ACTIVE once it holds the minimum. MarketX never pays for or moves it. `ensureTraderId` indexes IDs
  (first open, co-signed records, and once for existing traders via `adminConfig/traderIdIndex`). Records are co-signed by the ID either way.
  Public ID checker (owner-specified, `/checker?id=`, `src/checker/CheckerPage.tsx`, `GET /api/checker/:id`, 20/min per IP): picture,
  display name, username, verified badge, join date, the ID (Solscan link, on-chain state) and the track record (one result per signal,
  last 10). Never email, credits, plan details or the account id; banned/suspended accounts are not shown.
- One record per signal (owner-specified, `signalKey` in `server/journal.ts` = pair + timeframe + side + every level): the same signal
  is ONE price alert per trader (`startAlert` reuses the twin alert and adds the new card to `offerIds`, which the client matches cards
  by), ONE journal trade (manual add of the same trade, open or opened within a minute, is 409 `DUPLICATE_TRADE`) and ONE track record
  result (`archiveAlertOutcome` skips a twin; personal and MarketX-wide stats count each signal once via `uniqueSignals`). `server/dedupe.ts`
  (lead worker, after deploy + every 6h) removes older duplicates: keeps the active alert (else most hits, else oldest), moves its journal
  trade/result onto it when only the copy had one, keeps notes, repoints offers.
- Trade journal (`/trade-journal`, `server/journal.ts`, `journalTrades`) and track record (`/track-record`): trades are validated server-side
  (stop/target side checked, R and WIN/LOSS/BE scored on close). Auto + manual (owner-specified): turning on a price alert logs the trade
  (`openAutoJournal`, id `autoJournalId(alertId)`, `source: 'AUTO'`, `auto.state` TRACKING); when the alert ends, `closeAutoJournal` scores it
  ONCE (WIN at the furthest TP reached, LOSS at the stop, NO_FILL if never entered, not in stats) and it is DONE (notes only after that). If the
  alert ends while in the trade with no TP/SL it is HANDED_OVER and the trader closes it by hand. Manual trades work as before. The track record is built only from price alerts: `archiveAlertOutcome`
  writes `trackRecord/{alertId}` when an alert ends (WIN once any TP is hit, LOSS if the stop came first, MISSED); MarketX-wide stats cached 10 min.
  Level margin (owner-specified, `levelTolerance` in `server/priceAlerts.ts`, used by `evaluateBars` for alerts, journal, track record and
  the Solana result): a stop or target counts only once price trades THROUGH it by a margin sized to the market (crypto 0.06%,
  metals 0.1%, forex 0.008% (under 1 pip), stocks/indices/energy 0.03%, Deriv synthetics 0 = touch), capped at 15% of the
  trade's risk; the same margin for stops and targets (no bias toward wins), so a wick that only touches a level on our feed
  (e.g. Binance BTC/USDT) but not at the trader's broker (MT5 BTCUSD) is not recorded. Entry still fills on touching the zone.
  Win rule (owner-specified, everywhere: journal, track record, checker, Solana records): TP1 hit first = WIN, even if price later returns to the
  stop; scored at the furthest TP reached (`outcomeR`, R from the signal's own levels, stored as `trackRecord.r`, `totalR`/`avgR` in stats).
  Only a stop hit before any TP is a LOSS (-1R). The trade card's Recheck (`recheckSetup` in `server/strategy.ts`, owner-requested fix) follows the
  same rules: the stop and targets count only from the trade's start (a market entry's issue candle, a limit order's fill candle), never
  from candles before the signal; stop + target in one candle = stop; nothing counts after the stop; TP1 first = TP reached (a win) even if
  price returns to the stop later; the 24h-range stop check applies only while no TP was hit and the range lies inside the trade. The auto journal is scored live at each TP (`progressAutoJournal`, called by the alert monitor:
  status CLOSED, result WIN, still TRACKING until the alert ends), and `revealResult` writes the R in the Solana result text.
- Pro gate (owner-specified, `server/proAccess.ts`, strict): Pro list = Watchlist, Trade Journal, Strategy Builder, Fundamental Analysis (incl. Check
  fundamental, Recheck, save/share, daily news alerts), Preference Mode (incl. confirmation, trade types, RDM timeframe choice, calculator/Lot size)
  chart screenshot analysis, voice input and Talk back with Matt (`/api/matt/talk`, `/api/matt/speak`; listed on the Plans window); free for everyone until 1 Nov 2026 00:00 Lagos (`PRO_GATE_AT`), then Pro only (paid plan not expired, or unlimited
  staff). FREE for everyone, always (owner-specified): price alerts (Auto and Manual), the track record and the RDM timeframe. After the gate: Pro
  routes return 402 `PRO_REQUIRED` before any credit is charged (turning off and deleting still work; `chartProGate` on `/api/market/analyze`, the
  fundamental `ready` check, `PUT /api/preferences`); a free account's stored preferences are ignored, not deleted (`effectivePreferences`:
  defaults for analyses, the watchlist, Matt and the profile); `pluginStates` reports watchlist/journal off; the auto journal is opened only for
  Pro; news alerts skip free accounts; the lead-worker sweep (`sweepFreeAccounts`, every 15 min) switches off watchlist, Fundamental Analysis,
  news alerts and Strategy Builder of free or lapsed accounts and tells them once (alerts keep running). Data is kept. Client (shared list
  `src/utils/proFeatures.ts`): `profile.proAccess`/`proFreeUntil`, "Pro" / "Free until 1 Nov" badges in the slash menu and Tools sheet, attach
  locked (attach, paste, drop), every entry point (`lockedPro` in `App.tsx`, card buttons via `onProLocked`) opens pricing.
- Coupons (owner-specified, `server/coupons.ts`, admin `src/admin/Coupons.tsx`, `coupons/{CODE}`): the admin creates codes (3-24 chars A-Z 0-9 - _)
  with a percent off Monthly and/or Yearly (0-90 each, at least one), optional start/end, on/off, optional site pop-up (title, text); edit, delete.
  A code works only while LIVE (`couponState`: on, after `startsAt`, before `endsAt`, server time, never cached for checks/checkouts): turning it
  off or the end date passing stops it at once. `POST /api/coupons/check` (20/min) says why a code fails (invalid, expired, not for this
  plan; a code that hasn't started reads exactly like an unknown one, so upcoming promos can't be discovered) and returns the exact prices (`planPrice` in `server/payments.ts`); `/api/payments/initialize` takes `coupon`, prices it on the server
  (a code that fails = 400 `COUPON_*`, never a silent full price), stores `coupon` {code, pct} + `fullUsdAmount` on the payment, the receipt shows it,
  `uses.{plan}` counted after the grant. Plans window (`PricingModal.tsx`): the coupon box is always there (Apply, applied chip with remove, struck-out
  price, `initialCoupon` from the pop-up or `/?pricing=1&coupon=`). Promo pop-up (`PromoBanner.tsx`, `GET /api/promo`, signed in or out): the newest LIVE
  coupon with `banner`, pops up on EVERY page load (owner-specified), close button / Escape hides it until the next load; design (owner-specified,
  premium): Christmas promos (`FESTIVE` match) get the festive card (pine/midnight/wine gradient, gold hairline frame, falling snow, swaying
  baubles, gold "Christmas" in the headline, % OFF tiles with Best tag, ticket-style code with Copy, gold Claim button with a light sweep,
  live "ends in" countdown; keyframes `mx-promo-in`/`mx-snow`/`mx-sway`/`mx-shine`/`mx-twinkle` in `index.css`, all finite: the snow settles after
  about 40s and phones get half the flakes, so an open pop-up never keeps the GPU busy), other promos the same card in MarketX violet; Claim offer opens Plans with the code
  (signed out: sign-in first, then Plans). Announcement email: a coupon with `mailAt` is emailed ONCE to every trader (not banned/suspended) by the
  lead worker (`sweepCouponMail`, lease + `mail.lastUid` resume, `mail.state` SENT; bulk priority). Christmas promo (owner-specified, seeded once by
  `seedCoupons`, flag `adminConfig/couponSeeds`, deleting it never brings it back): MKXCMAS01, 30% off Monthly, 25% off Yearly, 10 Nov 2026 00:00 to
  20 Dec 2026 23:59:59 Lagos, pop-up on, email to everyone 10 Nov 9:00 AM Lagos (`promoMail`).
- Voice input (owner-specified; free until 1 Nov 2026 (`PRO_GATE_AT`), then Pro only: `proGuard` on `/api/voice/transcribe` (402 before the
  daily cap), and the mic shows a lock + opens pricing (`voiceLocked` on `ChatInput` / `HomePage`, `voice` from `GET /api/matt/status` on the Matt page)): a mic in the Ask SI composer (`ChatInput.tsx`), the Markets hero Ask box (`HomePage.tsx`) and
  Matt (`MattPage.tsx`, speech to text only, no read-aloud: Matt answers as soon as the trader stops). `src/components/VoiceInput.tsx`:
  `useVoiceInput` uses the browser's SpeechRecognition on desktop (live words in the input while talking); phones and tablets (iOS, iPadOS,
  Android, every browser, `isMobileDevice`, owner-requested fix) always record instead, so the mic permission prompt always shows (getUserMedia, "Allow the mic"
  state `starting`) and Stop always works; the AudioContext is made inside the tap (iOS). Stop ends any session within `STOP_GRACE_MS` (2.5s) even if the
  browser never answers, a recognition that doesn't start in 5s records instead, leaving the page releases the mic; desktop also falls back (no API, or a network /
  service-not-allowed error, then for the rest of the visit) to MediaRecorder with silence cut-off (owner-requested speed: ~1s (`SILENCE_MS` 950) after speech, judged against the room's own
  noise floor and the speaker's level so phones' auto gain can't keep a clip running; 7s with none, 30s max),
  `clipToWav` (16 kHz mono, silence before the first and after the last word trimmed, `trimSilence`) and `POST /api/voice/transcribe` (`server/voice.ts`: signed in, WAV only (RIFF/WAVE checked), ≤1.8 MB base64,
  20/min and 300/day per trader, its own transcription instructions via `useVoiceEngine(getGeminiClient)`, only called; lightest model first, the next
  started alongside after 1.2s (`HEDGE_MS`), first words back win, 12s cap (the app gives up at 15s), failures logged as
  `[MarketX Voice] no transcript:` with each model's error; nothing stored or logged; 422 NO_SPEECH,
  503 VOICE_UNAVAILABLE; no credit). UI: `VoiceMicButton` (Mic → violet/fuchsia stop with rings → spinner), `VoiceStatus` (cancel X, live
  `VoiceWave`, "Listening 0:04"), composer `is-listening` glow (`index.css`). The final words go through `normalizeSpokenPrompt`
  (`src/utils/voice.ts`: spoken pairs → EURUSD / GBPJPY / NAS100 / US30 / XAUUSD, number-word timeframes → "4 hour", spelled letters,
  "fundamental analysis X" → `/fundamental-analysis X`, "rug check X" → `/token-safety X`; Matt skips commands) and are sent like a typed
  prompt (same credit rules); `voiceCommand` ("open my watchlist", price alerts, journal, track record, Strategy Builder, Preference Mode,
  Fundamental Analysis, Matt) opens the tool instead. `Permissions-Policy` allows `microphone=(self)` only. Noted in the guide, Matt's
  knowledge and Privacy ("Voice input").
  Talk back with Matt (owner-specified, Matt only): Matt's mic opens a menu (`MattPage.tsx`): Direct question (the speech-to-text above) or
  Talk back. Matt settings (owner-specified, `MattSettings.tsx`, the gear next to History, or `/matt?settings=1`; kept on the device):
  Mic in Matt on/off (`mx.matt.mic`; off hides Matt's mic) and Matt's voice Female/Male with "Hear it" samples (`mx.matt.voice`,
  `src/matt/mattVoice.ts`; owner-specified: picking a voice is a draft, only the Save button stores it, "Not saved yet" / "Saved"); the voice is chosen ONLY there, never in the mic menu or on the talk screen. Talk back = `MattTalk.tsx`, a full-screen voice conversation styled on
  the owner's reference (dark page, faint rings, glossy violet-blue orb with two white pill eyes that blink, look around while thinking, squint
  while talking; it drops in and moves with the voice; `.mx-orb*` in `index.css`): Matt greets the trader by first name, listens (the same
  recorder, sharing the AudioContext made in the tap so iOS plays and measures sound), sends the words to `/api/matt/chat` with `spoken: true`
  (Matt's prompt asks for 2-4 short spoken sentences; the reply comes back with `speak`, an HMAC of the reply for this trader), speaks it via
  `POST /api/matt/speak` (`registerSpeakRoutes` in `server/voice.ts`: Pro-gated like voice, 30/min + 400/day, only a signed Matt reply or the
  greeting, Markdown stripped (`speakableText`, 900 chars), voices Aoede (female) / Charon (male) on the TTS models, PCM wrapped as WAV,
  nothing stored; 503 = the device's own speech voice reads it instead), then listens again until End. Tap Matt to interrupt; two silent
  turns stop listening until a tap. Every turn is written on the talk screen and saved in the Matt chat. Noted in the guide, Matt's knowledge
  and Privacy.
  Talk back speed (owner-requested: Matt answers about 2s after the trader stops): ONE request per turn, `POST /api/matt/talk` (in
  `server/matt.ts`, Pro-gated, Matt's own throttles; body = on-device `text` or a WAV `audio` clip, written down there with `transcribe`;
  the same `answer()` as the chat route, so private questions, pauses, scrubbing and logs are identical) returns {heard, reply, parts:
  [{text, token}], audio}: `speechParts` splits the reply (first sentence alone, then ~240-char groups), each part signed, and the first part
  is spoken in the same response (`synthesize`, at most 6s). The app plays it at once and fetches the other parts side by side while it plays.
  Spoken answers use `askEngine(…, fast)`: the light model first, the next started after 1.5s, 12s cap. A turn ends 0.8s after the trader
  stops (`silenceMs`); on Android the browser's own recognition is used (instant words, the mic permission asked first; any failure before
  words falls back to recording); iPhone/iPad record. American English only (owner-specified): TTS `languageCode: 'en-US'` + "American
  English accent", spoken prompts ask for American English, the device fallback voice is en-US. Phones stay cool: the orb has no blur filters
  or blend modes (gradient blobs), its glow is a separate opacity/scale layer, and the voice-follow loop runs ~30fps, writes only on change
  and stops while the tab is hidden.
  Phones + one voice (owner-reported fixes): Matt's voice plays through an `<audio>` element unlocked inside the tap (`unlockedAudio`, plus
  `unlockSpeech` for the device voice), never Web Audio buffers (iPhones mute those with the silent switch and send them to the earpiece after
  the mic); the CSP allows `media-src 'self' blob: data:` for it (without it every clip was refused and phones fell back to the device voice);
  `navigator.audioSession` is set to playback while Matt talks (Safari 16.4+); the orb follows the clip's own loudness (`envelopeOf`). A reply is
  at most TWO parts (first sentence + the rest); the talk route starts voicing every part at once (`prespeak`, in-memory 2 min per trader +
  voice + text) and `/api/matt/speak` hands that same audio back, never voicing it twice; the voice models are flash, pro beside it after 4s,
  flash once more if both failed. The app asks again for a part that failed, and if it still fails the REST of that answer is read by the
  device voice of the same kind (named US voices per platform, pitch keeps a male voice male), never a mix within one answer. Turn ends 0.7s
  after the trader stops.
- Tools (owner-specified name, everywhere users see it: never "Connectors", "Plugins" or "commands"; code names `plugins` / `ConnectorsModal`
  stay). `server/plugins.ts`, `src/utils/plugins.ts`: alerts, watchlist, journal, trackRecord. Every tool turned on is listed in Settings, Tools
  (2 shown, expand icon opens the Tools sheet `ConnectorsModal`) with open and switch-off; `POST /api/plugins/:id` uses the same helpers as inside
  each tool (`setAlertsEnabled`, `setWatchlistEnabled`). Turning one off keeps its data. The Tools sheet lists "Active now" (modes that change
  answers: Fundamental Analysis, Strategy Builder, Confirmation, trade type; each opens its settings), In use, Available, and More tools
  (Fundamental Analysis, Strategy Builder, Preference Mode).
- Composer (owner-specified, sleek, `ChatInput.tsx`): the text has its own full-width line; ONE slim row under it: attach + Tools on the left,
  timeframe, stop mode and send on the right. No per-mode chips in the composer: the modes on show as small coloured dots on the Tools button
  (sky = Fundamental Analysis, violet = Strategy Builder, emerald = Confirmation, cyan/amber/fuchsia = Scalp/Day/Swing). The slash menu is headed "Tools".
- Try again (owner-specified): a failed analysis or fundamental read that a retry can fix (`canRetry` in `App.tsx`: 5xx, 408, 429, timeout, network;
  never DAILY_LIMIT, PRO_REQUIRED, NOT_FUNDAMENTAL, UNKNOWN_ASSET, sign-in) carries `ChatMessage.retry` {kind, prompt, timeframe, slMode}; the card's
  "Try again" button (`onRetry` in `ChatFeed.tsx`, `retryMessage`) removes the failed attempt and its prompt and runs it again in the same chat.
- Pop-up above the composer (owner-specified, `ChatUpdatesBar.tsx`): random market moves, offers and tips only, each shown for 5 seconds
  (`VISIBLE_MS`). It never shows notifications (prompts, analysis results or anything the notification center already shows).
- Emails (`server/mailer.ts`, the only template; a body line is only turned into a link when it is a MarketX link, `ownLink`): light design (owner-specified): soft white page, NO logo header
  above the card (owner-specified, removed), white card with a violet to cyan top bar, dark readable text, violet button, footer with a row of round icon buttons
  (`SOCIALS`: X → x.com/_MarketX, Telegram → `/go/telegram`, YouTube → `/go/youtube`; PNGs `public/brand/social/{x,telegram,youtube}-72.png?v=1`, shown 32px)
  then marketx.world · Support; tables with `bgcolor` and
  `color-scheme: light only` so mail apps keep it light.
- Admin console at `/admin` (`server/admin.ts`, `src/admin/*`, lazily loaded): its own password (`ADMIN_DEFAULT_PASSWORD` env, 12+ chars, never
  hard-coded; or a custom scrypt hash in `adminConfig/auth`; with neither, admin sign-in is disabled), its own short-lived HMAC cookie scoped to `/api/admin`, brute-force lockout.
  Matt + Fundamentals sections (owner-specified, `src/admin/SiTools.tsx`, `GET /api/admin/si/:tool` matt|fundamental, `?user=&outcome=&before=&limit=`):
  `server/siLogs.ts` logs every Matt message (`mattLogs`: question, reply, outcome ANSWERED/OFFLINE/PRIVATE/PAUSED/REPLACED, pair, from an Ask
  Matt button) and every fundamental read/recheck (`fundamentalLogs`: question, event, most likely, actual/forecast, pairs for/against, outcome
  OK/NOT_FUNDAMENTAL/UNAVAILABLE/ERROR, recheck state, seconds, reused), with day counters in `siDaily`; 30-day stats, chart, outcomes, top traders,
  top markets/releases, Matt strikes + pauses (`POST /api/admin/si/matt/:uid/clear` resets them), history with username/outcome filters and Load more.
  Server-only, never shown to traders or given to any engine; kept 90 days (`sweepSiLogs`, lead worker daily), deleted with the account; noted in Privacy.
  Usage/activity are recorded server-side by `server/tracking.ts`; moderation status (`suspended`/`banned`) is enforced
  in `requireAuth` and at sign-in.

## Deployment
- `package.json` `overrides` pins `uuid` to ^11.1.1 (patched advisory inside Firebase's storage client) and `source-map-js` to ^1.2.2 (build tooling advisory);
  `vite` is ^6.4.5 (patched dev-server advisories); `npm audit` is clean. Checkout (`/api/payments/initialize`) is capped at 10 a minute per trader.
- Deployed on Render as a single Web Service (not a static site) on Node 22 (pinned by `.node-version`
  and `engines`; Node 25+ removed `SlowBuffer`, which breaks the Google/Firebase JWT libraries).
- Env vars are documented in `.env.example` (Gemini, Firebase, Paystack, Gmail SMTP).
- Build: `npm install && npm run build` — Start: `npm start`. The server bundle builds to `server-dist/` (never inside the
  public `dist/`); the static server 404s `.map`, `.cjs`, `.ts`, dotfiles and `/server*` paths so source never ships.
- Browser hardening: production builds drop every `console.*` call and legal comments (`esbuild.drop` in `vite.config.ts`), and no
  setting/env name ships in the bundle (`import.meta.env` read statically; admin screens describe settings in words). Public copy never
  names backend providers (database, hosting, AI); Paystack is named only as the checkout.
- Mobile resilience: on-demand screens use `lazyWithReload` (`src/utils/lazyReload.ts`): preloaded in idle time, and a tab left
  open across a deploy reloads onto the new version instead of breaking. Missing `/assets/*` or file paths return 404, never
  the app page. Analyses time out on the client (110s text, 180s chart) and Recheck after 45s, so nothing loads forever.
