// ===========================================================================
// Market knowledge (owner-specified): MarketX answers questions about any tradeable market in depth, never with a
// one-line reply. This module holds stable, well-established facts about every kind of market the site trades
// (currencies and their central banks, forex pair types and sessions, metals, energy, indices, the listed stocks,
// the major coins and how crypto behaves, on-chain tokens and their risks, Deriv synthetic indices).
//
// Two uses:
//   pairKnowledge(asset)        -> a "MARKETX KNOWLEDGE" block given to the answer engine as background facts
//                                  (live price and today's news always come from the live feeds, never from here)
//   pairBriefing(asset, ...)    -> a full written answer when the engine cannot answer, shaped by the question
// Only durable facts live here: no prices, no dated events, nothing that goes stale.
// ===========================================================================

export interface KnowledgeAsset {
  symbol: string;
  name: string;
  type: 'synthetic' | 'commodity' | 'stock' | 'forex' | 'crypto';
  venue?: string;
  dex?: { chainId: string; dexId: string; liquidityUsd: number; pairCreatedAt: number; symbol: string };
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------
interface Ccy { name: string; where: string; bank: string; kind: string; drivers: string; session: string }
const CCY: Record<string, Ccy> = {
  USD: { name: 'US dollar', where: 'the United States', bank: 'Federal Reserve (Fed)', kind: "the world's main reserve and funding currency; tends to rise when markets are fearful", drivers: 'Fed rate decisions and guidance (FOMC), CPI and PCE inflation, Non-Farm Payrolls, GDP, retail sales, ISM surveys and US Treasury yields', session: 'New York' },
  EUR: { name: 'euro', where: 'the euro area (20 EU countries)', bank: 'European Central Bank (ECB)', kind: 'the second most traded currency; moves with the gap between euro area and US interest rates', drivers: 'ECB decisions, euro area CPI (HICP), German data (Ifo, ZEW, PMIs), GDP and energy prices', session: 'London (European)' },
  GBP: { name: 'British pound', where: 'the United Kingdom', bank: 'Bank of England (BoE)', kind: 'a liquid major that is often more volatile than the euro', drivers: 'BoE decisions, UK CPI, wages and jobs data, GDP, PMIs and UK politics and fiscal news', session: 'London' },
  JPY: { name: 'Japanese yen', where: 'Japan', bank: 'Bank of Japan (BoJ)', kind: 'a funding and safe-haven currency; long a low-yielder, so it is used in carry trades and often strengthens in risk-off moves', drivers: 'BoJ policy and yield-curve signals, the gap between US and Japanese yields, Tokyo CPI, wage talks and possible Ministry of Finance intervention', session: 'Tokyo (Asian)' },
  CHF: { name: 'Swiss franc', where: 'Switzerland', bank: 'Swiss National Bank (SNB)', kind: 'a classic safe haven backed by a large current-account surplus; the SNB has a history of intervening', drivers: 'SNB decisions and intervention, Swiss CPI, global risk sentiment and euro area developments', session: 'London (European)' },
  CAD: { name: 'Canadian dollar', where: 'Canada', bank: 'Bank of Canada (BoC)', kind: 'a commodity currency closely tied to crude oil and the US economy', drivers: 'BoC decisions, Canadian CPI and jobs reports, oil prices and US data', session: 'New York' },
  AUD: { name: 'Australian dollar', where: 'Australia', bank: 'Reserve Bank of Australia (RBA)', kind: 'a risk-sensitive commodity currency linked to iron ore, coal, gold and Chinese demand', drivers: 'RBA decisions, Australian CPI and jobs data, Chinese growth data and commodity prices', session: 'Sydney and Tokyo (Asian)' },
  NZD: { name: 'New Zealand dollar', where: 'New Zealand', bank: 'Reserve Bank of New Zealand (RBNZ)', kind: 'a risk-sensitive commodity currency tied to dairy and agricultural exports', drivers: 'RBNZ decisions, NZ CPI and jobs data, dairy auction prices (GDT) and China', session: 'Sydney and Tokyo (Asian)' },
  CNY: { name: 'Chinese yuan (renminbi)', where: 'China', bank: "People's Bank of China (PBoC)", kind: 'a managed currency: the onshore rate trades in a band around a daily fixing; offshore it trades as CNH', drivers: 'the PBoC daily fixing, Chinese data (PMIs, trade, credit), trade policy and capital flows', session: 'Asian' },
  CNH: { name: 'offshore Chinese yuan', where: 'China (offshore market)', bank: "People's Bank of China (PBoC)", kind: 'the freely traded offshore version of the yuan, tracking the managed onshore rate', drivers: 'the PBoC fixing, Chinese data, trade policy and global risk', session: 'Asian' },
  HKD: { name: 'Hong Kong dollar', where: 'Hong Kong', bank: 'Hong Kong Monetary Authority (HKMA)', kind: 'pegged to the US dollar inside a narrow band (about 7.75 to 7.85)', drivers: 'the peg, US rates and HKMA liquidity operations', session: 'Asian' },
  SGD: { name: 'Singapore dollar', where: 'Singapore', bank: 'Monetary Authority of Singapore (MAS)', kind: 'managed against a trade-weighted basket rather than with an interest rate', drivers: 'MAS policy statements, Singapore CPI and regional trade', session: 'Asian' },
  SEK: { name: 'Swedish krona', where: 'Sweden', bank: 'Riksbank', kind: 'a smaller European currency that is sensitive to global risk', drivers: 'Riksbank decisions, Swedish CPI and euro area trends', session: 'London (European)' },
  NOK: { name: 'Norwegian krone', where: 'Norway', bank: 'Norges Bank', kind: 'an oil-linked European currency', drivers: 'Norges Bank decisions, Norwegian CPI and Brent crude', session: 'London (European)' },
  DKK: { name: 'Danish krone', where: 'Denmark', bank: 'Danmarks Nationalbank', kind: 'pegged to the euro through ERM II', drivers: 'the euro peg and ECB policy', session: 'London (European)' },
  PLN: { name: 'Polish zloty', where: 'Poland', bank: 'National Bank of Poland (NBP)', kind: 'a Central European emerging-market currency', drivers: 'NBP decisions, Polish CPI and euro area growth', session: 'London (European)' },
  HUF: { name: 'Hungarian forint', where: 'Hungary', bank: 'Magyar Nemzeti Bank (MNB)', kind: 'a higher-yield, volatile Central European currency', drivers: 'MNB decisions, inflation and EU funding news', session: 'London (European)' },
  CZK: { name: 'Czech koruna', where: 'the Czech Republic', bank: 'Czech National Bank (CNB)', kind: 'a Central European currency that tracks the euro closely', drivers: 'CNB decisions and euro area trends', session: 'London (European)' },
  TRY: { name: 'Turkish lira', where: 'Turkey', bank: 'Central Bank of the Republic of Turkey (CBRT)', kind: 'a high-inflation emerging-market currency with a long trend of depreciation', drivers: 'CBRT rate decisions, Turkish inflation, reserves and politics', session: 'London (European)' },
  ZAR: { name: 'South African rand', where: 'South Africa', bank: 'South African Reserve Bank (SARB)', kind: 'a liquid, high-beta emerging-market currency tied to metals and global risk appetite', drivers: 'SARB decisions, power supply and politics, gold and platinum prices and risk sentiment', session: 'London (European)' },
  MXN: { name: 'Mexican peso', where: 'Mexico', bank: 'Banco de México (Banxico)', kind: 'the most traded Latin American currency and a popular carry trade', drivers: 'Banxico decisions, US-Mexico trade, remittances, oil and risk sentiment', session: 'New York' },
  BRL: { name: 'Brazilian real', where: 'Brazil', bank: 'Banco Central do Brasil (BCB)', kind: 'a high-yield, volatile Latin American currency tied to commodities', drivers: 'BCB (Selic) decisions, fiscal news, iron ore and soybeans', session: 'New York' },
  INR: { name: 'Indian rupee', where: 'India', bank: 'Reserve Bank of India (RBI)', kind: 'a managed emerging-market currency; the RBI smooths sharp moves', drivers: 'RBI decisions and intervention, oil prices (India imports most of its oil) and foreign portfolio flows', session: 'Asian' },
  KRW: { name: 'South Korean won', where: 'South Korea', bank: 'Bank of Korea (BoK)', kind: 'a tech-export currency sensitive to the global chip cycle', drivers: 'BoK decisions, exports, semiconductors and foreign equity flows', session: 'Asian' },
  RUB: { name: 'Russian ruble', where: 'Russia', bank: 'Bank of Russia', kind: 'an oil and gas linked currency affected by sanctions and capital controls', drivers: 'Bank of Russia decisions, energy prices and sanctions', session: 'London (European)' },
  NGN: { name: 'Nigerian naira', where: 'Nigeria', bank: 'Central Bank of Nigeria (CBN)', kind: 'an oil-linked emerging-market currency; liquidity and the official versus parallel rate matter a lot', drivers: 'CBN policy and FX reforms, oil output and prices, foreign reserves and dollar liquidity', session: 'London (European)' },
  KES: { name: 'Kenyan shilling', where: 'Kenya', bank: 'Central Bank of Kenya (CBK)', kind: 'an East African frontier-market currency', drivers: 'CBK decisions, tea, tourism and diaspora inflows, external debt', session: 'London (European)' },
  GHS: { name: 'Ghanaian cedi', where: 'Ghana', bank: 'Bank of Ghana', kind: 'a volatile frontier-market currency', drivers: 'Bank of Ghana decisions, gold and cocoa exports, inflation and debt programmes', session: 'London (European)' },
  EGP: { name: 'Egyptian pound', where: 'Egypt', bank: 'Central Bank of Egypt (CBE)', kind: 'a managed currency that has seen large devaluations', drivers: 'CBE policy, IMF programmes, Suez Canal and tourism revenue', session: 'London (European)' },
  AED: { name: 'UAE dirham', where: 'the United Arab Emirates', bank: 'Central Bank of the UAE', kind: 'pegged to the US dollar at about 3.6725', drivers: 'the dollar peg and US rates', session: 'London (European)' },
  SAR: { name: 'Saudi riyal', where: 'Saudi Arabia', bank: 'Saudi Central Bank (SAMA)', kind: 'pegged to the US dollar at 3.75', drivers: 'the dollar peg, oil revenue and US rates', session: 'London (European)' },
  ILS: { name: 'Israeli shekel', where: 'Israel', bank: 'Bank of Israel', kind: 'a tech-economy currency sensitive to geopolitics', drivers: 'Bank of Israel decisions, tech flows and regional security', session: 'London (European)' },
  THB: { name: 'Thai baht', where: 'Thailand', bank: 'Bank of Thailand', kind: 'a tourism and export linked Asian currency', drivers: 'Bank of Thailand decisions, tourism and exports', session: 'Asian' },
  IDR: { name: 'Indonesian rupiah', where: 'Indonesia', bank: 'Bank Indonesia', kind: 'a commodity-linked emerging-market currency (coal, palm oil, nickel)', drivers: 'Bank Indonesia decisions, commodity prices and foreign flows', session: 'Asian' },
  PHP: { name: 'Philippine peso', where: 'the Philippines', bank: 'Bangko Sentral ng Pilipinas (BSP)', kind: 'an emerging-market currency supported by remittances', drivers: 'BSP decisions, remittances and oil prices', session: 'Asian' },
  MYR: { name: 'Malaysian ringgit', where: 'Malaysia', bank: 'Bank Negara Malaysia', kind: 'a commodity and electronics export currency', drivers: 'Bank Negara decisions, oil, palm oil and chip exports', session: 'Asian' },
  CLP: { name: 'Chilean peso', where: 'Chile', bank: 'Banco Central de Chile', kind: 'a copper-linked currency', drivers: 'central bank decisions and copper prices', session: 'New York' },
  COP: { name: 'Colombian peso', where: 'Colombia', bank: 'Banco de la República', kind: 'an oil-linked Latin American currency', drivers: 'central bank decisions and oil prices', session: 'New York' },
  ARS: { name: 'Argentine peso', where: 'Argentina', bank: 'Banco Central de la República Argentina (BCRA)', kind: 'a very high-inflation currency with a history of capital controls and parallel rates', drivers: 'BCRA policy, inflation, IMF programmes and FX regime changes', session: 'New York' },
};
const MAJORS = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']);
const NICK: Record<string, string> = {
  EURUSD: 'Fiber', GBPUSD: 'Cable', USDJPY: 'the Gopher', USDCHF: 'the Swissie', AUDUSD: 'the Aussie', NZDUSD: 'the Kiwi',
  USDCAD: 'the Loonie', GBPJPY: 'the Dragon (or the Beast)', EURJPY: 'the Yuppy', EURGBP: 'the Chunnel', EURCHF: 'the Swissy cross',
};
const PAIR_NOTES: Record<string, string[]> = {
  EURUSD: ['The most traded currency pair in the world, with the tightest spreads; it reflects the gap between ECB and Fed policy and between euro area and US growth.', 'Usually most active in the London session and the London and New York overlap.'],
  GBPUSD: ['One of the oldest traded pairs ("Cable", after the transatlantic telegraph cable); typically wider daily ranges than EUR/USD and sharp reactions to UK data.'],
  USDJPY: ['Driven heavily by the gap between US and Japanese government bond yields; large one-way moves can bring warnings or intervention from Japan\'s Ministry of Finance.', 'Often falls in sharp risk-off moves as carry trades unwind.'],
  USDCHF: ['Tends to move opposite to EUR/USD; the franc strengthens in times of stress.'],
  AUDUSD: ['A barometer of global risk appetite and Chinese demand; often moves with iron ore, copper and equities.'],
  NZDUSD: ['Moves closely with AUD/USD; dairy prices and RBNZ guidance matter.'],
  USDCAD: ['Usually moves opposite to crude oil: higher oil tends to strengthen the Canadian dollar (USD/CAD lower).'],
  GBPJPY: ['A volatile cross with wide daily ranges, popular with intraday traders; it combines pound moves with yen risk-sentiment swings.'],
  EURJPY: ['A risk-sensitive cross that often rises with equity markets and falls in risk-off moves.'],
  EURGBP: ['Usually a slower, range-bound cross because the two economies are closely linked; it moves on relative ECB and BoE expectations.'],
  EURCHF: ['A low-volatility cross that the SNB has watched closely; sharp drops usually signal European stress.'],
  AUDJPY: ['A classic risk-on and risk-off gauge: it tends to rise with global risk appetite and fall in panics.'],
  USDZAR: ['A high-volatility emerging-market pair; the rand weakens quickly in global sell-offs.'],
  USDMXN: ['The most liquid emerging-market dollar pair; the peso is a popular carry currency, so it can fall fast when volatility jumps.'],
  USDTRY: ['Has trended higher for years because of high Turkish inflation; spreads and swaps can be costly.'],
  USDNGN: ['Liquidity is thin and the official and parallel rates can differ; CBN policy changes can move it in large steps.'],
};

// Approximate session windows (UTC; Europe and US shift by an hour with daylight saving)
const SESSIONS = 'Sydney about 21:00 to 06:00 UTC, Tokyo about 00:00 to 09:00 UTC, London about 07:00 to 16:00 UTC, New York about 12:00 to 21:00 UTC (each shifts by an hour with daylight saving). The London and New York overlap (about 12:00 to 16:00 UTC) is usually the most liquid window.';

function forexKnowledge(sym: string): string[] {
  const m = /^([A-Z]{3})\/?([A-Z]{3})$/.exec(sym.replace(/\s/g, '').toUpperCase());
  if (!m) return [];
  const [, b, q] = m;
  const B = CCY[b], Q = CCY[q];
  const key = b + q;
  const kind = b === 'USD' || q === 'USD' ? (MAJORS.has(b) && MAJORS.has(q) ? 'a major pair (one side is the US dollar)' : 'an exotic pair (the US dollar against an emerging or smaller currency)') : MAJORS.has(b) && MAJORS.has(q) ? 'a cross (minor) pair: two major currencies without the US dollar' : 'an exotic cross';
  const out = [
    `${b}/${q} is ${kind}${NICK[key] ? `, nicknamed ${NICK[key]}` : ''}. The price shows how much ${Q ? Q.name : q} one ${B ? B.name : b} buys: it rises when ${b} strengthens against ${q}.`,
    `Pip size: ${q === 'JPY' ? '0.01 (yen pairs quote two decimals, often a third for fractional pips)' : '0.0001 (four decimals, often a fifth for fractional pips)'}. Forex trades 24 hours a day from Sunday evening to Friday evening (UTC), not at weekends.`,
  ];
  for (const [c, d] of [[b, B], [q, Q]] as const) {
    if (d) out.push(`${c}: the ${d.name} of ${d.where}, set by the ${d.bank}; ${d.kind}. Key drivers: ${d.drivers}. Busiest during the ${d.session} session.`);
  }
  out.push(`Sessions: ${SESSIONS}`);
  out.push(...(PAIR_NOTES[key] || []));
  const corr: string[] = [];
  if (['EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD'].includes(key)) corr.push('tends to move with the other dollar-quoted majors (EUR/USD, GBP/USD, AUD/USD, NZD/USD) and opposite to the US dollar index (DXY)');
  if (['USDCHF', 'USDJPY', 'USDCAD'].includes(key)) corr.push('tends to rise when the US dollar index (DXY) rises, and to move opposite to EUR/USD');
  if (b === 'AUD' || q === 'AUD' || b === 'NZD' || q === 'NZD') corr.push('the Australian and New Zealand dollars often move together and with commodities and Chinese data');
  if (b === 'CAD' || q === 'CAD' || b === 'NOK' || q === 'NOK') corr.push('linked to crude oil prices');
  if (b === 'JPY' || q === 'JPY' || b === 'CHF' || q === 'CHF') corr.push('the yen and the franc usually gain in risk-off moves');
  if (corr.length) out.push(`Correlations: ${corr.join('; ')}.`);
  out.push('Interest rate differences drive carry: holding the higher-yielding currency overnight usually earns swap, holding the lower-yielding one usually costs it.');
  return out;
}

// ---------------------------------------------------------------------------
// Commodities, indices, stocks
// ---------------------------------------------------------------------------
const COMMODITY: Record<string, string[]> = {
  'XAU/USD': [
    'Gold quoted in US dollars per troy ounce; one of the most traded instruments in the world, trading almost 24 hours on weekdays.',
    'A safe-haven and store of value: it often rises in crises, when real (inflation-adjusted) US yields fall and when the US dollar weakens; central-bank buying and ETF flows also matter.',
    'Key events: US CPI and PCE inflation, Non-Farm Payrolls, FOMC decisions and speeches, US Treasury yields and geopolitical shocks.',
    'Typical behaviour: large daily ranges, sharp moves on US data, liquidity grabs around Asian and London opens; most active in the London and New York sessions.',
  ],
  'XAG/USD': [
    'Silver quoted in US dollars per troy ounce; it follows gold but with bigger percentage swings.',
    'Half precious metal, half industrial metal: demand from solar panels, electronics and batteries matters, so growth data counts as well as rates and the dollar.',
    'The gold-to-silver ratio (gold price divided by silver price) is a common gauge of relative value.',
  ],
  'XPT/USD': ['Platinum quoted in US dollars per troy ounce; used in catalytic converters (mainly diesel), jewellery and industry.', 'Supply is concentrated in South Africa and Russia, so mining and power disruptions can move it; thinner liquidity than gold.'],
  'XPD/USD': ['Palladium quoted in US dollars per troy ounce; mainly used in petrol-engine catalytic converters.', 'Supply is concentrated in Russia and South Africa; a small, thin and very volatile market sensitive to the car industry and the shift to electric vehicles.'],
  COPPER: ['Copper, nicknamed "Dr. Copper" because it reflects global industrial health; used in construction, power grids and electric vehicles.', 'China is the largest consumer; supply comes mainly from Chile, Peru and the DR Congo. Moves on Chinese data, mine disruptions and green-energy demand.'],
  'WTI/USD': ['West Texas Intermediate, the US crude oil benchmark, priced at Cushing, Oklahoma.', 'Driven by OPEC+ output decisions, US inventories (EIA weekly report, usually Wednesday), refinery demand, the dollar and geopolitics in producing regions.', 'Volatile around inventory data and OPEC+ meetings; its spread to Brent reflects US versus global supply.'],
  BRENT: ['Brent crude, the main global oil benchmark, based on North Sea crude.', 'Driven by OPEC+ output, global demand (China, India), Middle East and Russia supply risks, shipping routes and the dollar.'],
  NGAS: ['Natural gas (Henry Hub benchmark in the US); one of the most volatile commodities.', 'Driven by weather (heating and cooling demand), storage levels (EIA weekly storage report, usually Thursday), LNG exports and production.', 'Strong seasonality and frequent gaps; position sizing matters more than usual.'],
};
const INDEX: Record<string, string[]> = {
  US30: ['The Dow Jones Industrial Average: 30 large US blue-chip companies, weighted by share price (not market value), so high-priced shares move it most.', 'Trades actively in the US cash session (09:30 to 16:00 New York time); moves on US data, Fed policy, earnings and bond yields.'],
  NAS100: ['The Nasdaq 100: the 100 largest non-financial companies on the Nasdaq, heavily weighted to technology (Apple, Microsoft, NVIDIA, Amazon, Alphabet, Meta and others).', 'Very sensitive to interest-rate expectations and big-tech earnings; usually more volatile than the S&P 500.'],
  'SPX 500': ['The S&P 500: about 500 of the largest US companies weighted by market value; the main benchmark for US stocks.', 'Moves on Fed policy, inflation and jobs data, earnings seasons and bond yields; the VIX measures its expected volatility.'],
  GER40: ['The DAX 40: the 40 largest German companies on the Frankfurt exchange (Xetra hours about 09:00 to 17:30 Central European Time).', 'Export-heavy (cars, chemicals, industrials, software), so it reacts to global trade, China, the euro and ECB policy.'],
  UK100: ['The FTSE 100: the 100 largest UK-listed companies by market value.', 'Full of multinationals, miners, energy and banks; a weaker pound often lifts it because much of its earnings are in other currencies.'],
  JP225: ['The Nikkei 225: 225 leading Tokyo-listed companies, weighted by share price.', 'Often moves opposite to the yen (a weaker yen helps exporters) and reacts to BoJ policy and US tech shares.'],
};
const STOCKS: Record<string, string> = {
  AAPL: 'Apple: consumer technology (iPhone, Mac, iPad, wearables) and a fast-growing services business (App Store, iCloud, Apple Music). Moves on iPhone demand, services growth, China, supply chain and quarterly earnings.',
  MSFT: 'Microsoft: software and cloud (Azure, Microsoft 365, Windows, LinkedIn, Xbox). Moves on cloud growth, enterprise spending and its large investments in AI.',
  NVDA: 'NVIDIA: graphics and AI processors (data-centre GPUs and networking); the leading supplier of chips for AI training. Very sensitive to data-centre demand, export rules and its earnings guidance; known for big moves around results.',
  TSLA: 'Tesla: electric vehicles, batteries and energy storage, with autonomous-driving and robotics ambitions. Highly volatile; moves on delivery numbers, margins, price cuts, regulation and news about its CEO.',
  AMZN: 'Amazon: e-commerce, AWS cloud (its main profit engine), advertising and subscriptions. Moves on AWS growth, consumer spending and margins.',
  GOOGL: 'Alphabet (Google): search advertising, YouTube, Google Cloud and other bets such as Waymo. Moves on ad spending, cloud growth, AI competition and antitrust cases.',
  META: 'Meta Platforms: Facebook, Instagram, WhatsApp and Threads, funded mostly by advertising, with large spending on AI and virtual reality (Reality Labs). Moves on ad revenue, user growth and capital spending.',
  AMD: 'Advanced Micro Devices: CPUs and GPUs for PCs, servers and AI data centres; NVIDIA\'s main GPU rival. Moves on data-centre and AI chip demand and the PC cycle.',
  NFLX: 'Netflix: subscription streaming. Moves on subscriber growth, pricing, its advertising tier and content costs.',
  PLTR: 'Palantir: data-analytics software for governments and companies. Moves on government contracts, commercial AI demand and a high valuation, so it is volatile.',
  COIN: 'Coinbase: the largest US crypto exchange. Its shares tend to move with crypto prices, trading volumes and US crypto regulation.',
  WMT: 'Walmart: the world\'s largest retailer by revenue (stores, e-commerce, Sam\'s Club). A defensive stock that moves on consumer spending, margins and guidance.',
};

// ---------------------------------------------------------------------------
// Crypto
// ---------------------------------------------------------------------------
const COINS: Record<string, string> = {
  BTC: 'Bitcoin: the first cryptocurrency (launched in 2009 by the pseudonymous Satoshi Nakamoto). Proof-of-work, a fixed supply of 21 million coins, and a "halving" of new supply roughly every four years. Treated as digital gold; spot ETFs, institutional flows and global liquidity drive it.',
  ETH: 'Ethereum: the leading smart-contract platform (launched 2015), home of most DeFi, stablecoins and NFTs. Moved to proof-of-stake in 2022 ("the Merge"); fees (gas) are partly burned. Layer-2 networks scale it. Moves with Bitcoin, ETF flows, staking and on-chain activity.',
  SOL: 'Solana: a high-speed proof-of-stake blockchain with low fees, popular for trading, DeFi and memecoins. Moves with network activity, memecoin seasons and Bitcoin; has had outages in its history.',
  XRP: 'XRP: the native asset of the XRP Ledger, associated with Ripple and cross-border payments. Very sensitive to legal and regulatory news.',
  BNB: 'BNB: the native coin of BNB Chain and the Binance ecosystem, used for fees and discounts, with regular token burns. Moves with Binance news and chain activity.',
  DOGE: 'Dogecoin: the original meme coin (2013), proof-of-work, with no maximum supply. Driven by social media, celebrity mentions and retail sentiment.',
  ADA: 'Cardano: a research-driven proof-of-stake smart-contract blockchain (Ouroboros consensus).',
  AVAX: 'Avalanche: a fast smart-contract platform that supports custom subnets (app-specific chains).',
  LINK: 'Chainlink: the leading oracle network, feeding real-world data (prices and more) to smart contracts.',
  DOT: 'Polkadot: a network connecting multiple blockchains (parachains) under shared security.',
  TRX: 'TRON: a blockchain widely used for USDT stablecoin transfers because of its low fees.',
  TON: 'Toncoin: the coin of The Open Network, closely linked to Telegram\'s ecosystem.',
  LTC: 'Litecoin: one of the oldest coins (2011), a faster, lighter Bitcoin-style network with an 84 million coin cap.',
  SUI: 'Sui: a newer high-throughput smart-contract blockchain built with the Move language.',
  SHIB: 'Shiba Inu: a large Ethereum-based meme coin with its own ecosystem (Shibarium).',
  PEPE: 'Pepe: an Ethereum-based meme coin built on the Pepe the Frog meme; trades on community hype.',
  WIF: 'dogwifhat (WIF): a Solana meme coin built on a viral dog-in-a-hat image.',
  BONK: 'Bonk: one of the first community dog meme coins on Solana.',
  FLOKI: 'Floki: a meme coin named after Elon Musk\'s dog, with marketing-driven community growth.',
  NEAR: 'NEAR Protocol: a sharded proof-of-stake smart-contract platform focused on usability.',
  APT: 'Aptos: a Move-language smart-contract blockchain built by former Meta (Diem) engineers.',
  ARB: 'Arbitrum: the token of a leading Ethereum layer-2 network (optimistic rollup).',
  OP: 'Optimism: the token of an Ethereum layer-2 network (optimistic rollup) and the OP Stack used by other chains.',
  UNI: 'Uniswap: the governance token of the largest decentralised exchange on Ethereum.',
  AAVE: 'Aave: the governance token of a leading decentralised lending protocol.',
  ATOM: 'Cosmos: the hub of an ecosystem of interconnected blockchains (IBC).',
  POL: 'Polygon (POL, formerly MATIC): a set of Ethereum scaling networks.',
  MATIC: 'Polygon (MATIC, now POL): a set of Ethereum scaling networks.',
  TRUMP: 'Official Trump (TRUMP): a Solana meme coin tied to Donald Trump; very sensitive to political news and token unlocks.',
  PENGU: 'Pudgy Penguins (PENGU): the token of the Pudgy Penguins NFT brand on Solana.',
};
const CRYPTO_GENERAL = [
  'Crypto trades 24 hours a day, 7 days a week; liquidity is thinner at weekends and in the late US / early Asian hours, so moves can be sharper then.',
  'Most coins move with Bitcoin; a rising Bitcoin dominance usually means money is leaving smaller coins. Crypto also often tracks the Nasdaq and global liquidity.',
  'Other drivers: ETF and exchange flows, stablecoin supply, futures funding rates and liquidations, token unlocks, new listings, hacks, and regulation.',
];

// ---------------------------------------------------------------------------
// Synthetic indices (Deriv)
// ---------------------------------------------------------------------------
function syntheticKnowledge(sym: string): string[] {
  const s = sym.toLowerCase();
  const base = ['A Deriv synthetic index: prices come from a certified random number generator with fixed statistical properties, not from a real market, so news and economic data do not move it. It trades 24/7, including weekends.'];
  const v = /volatility\s*(\d+)/.exec(s);
  if (v) return [...base, `Volatility ${v[1]} keeps a constant volatility of about ${v[1]}% a year (higher number = bigger swings); some brokers also offer a 1-second (1s) version that ticks every second.`, 'Because volatility is constant, risk can be planned consistently: the same stop distance has a similar chance of being hit at any hour.'];
  const b = /boom\s*(\d+)/.exec(s);
  if (b) return [...base, `Boom ${b[1]} drifts slowly down and has sudden upward spikes, on average about once every ${b[1]} ticks.`, 'Traders usually wait for spikes in the direction of the spike or trade the slow drift between them; spikes can jump through stop losses.'];
  const c = /crash\s*(\d+)/.exec(s);
  if (c) return [...base, `Crash ${c[1]} drifts slowly up and has sudden downward spikes, on average about once every ${c[1]} ticks.`, 'The mirror image of the Boom indices; spikes can jump through stop losses.'];
  if (/step/.test(s)) return [...base, 'The Step Index moves in fixed steps of 0.1, with an equal chance of an up or a down step on each tick.'];
  const j = /jump\s*(\d+)/.exec(s);
  if (j) return [...base, `Jump ${j[1]} has a base volatility of about ${j[1]}% plus occasional large jumps (on average about three an hour), equally likely up or down.`];
  return base;
}

// ---------------------------------------------------------------------------
export function pairKnowledge(a: KnowledgeAsset): string[] {
  const sym = a.symbol;
  if (a.type === 'forex') return forexKnowledge(sym);
  if (a.type === 'commodity') return COMMODITY[sym] || [`${a.name}: a commodity priced in US dollars; supply, demand, the dollar and global growth drive it.`];
  if (a.type === 'synthetic') return syntheticKnowledge(sym);
  if (a.type === 'stock') {
    if (INDEX[sym])
      return [
        ...INDEX[sym],
        'Index CFDs follow the futures market, which trades almost 24 hours on weekdays; most volume and the biggest moves come in the cash session and at its open.',
        'Common drivers: central-bank decisions and speeches, inflation and jobs data, bond yields, earnings seasons of the largest members, and global risk sentiment (the VIX rises when fear rises).',
        'Indices often gap at the open after overnight news and tend to trend with the broad market; position sizes are usually set in points rather than pips.',
      ];
    const s = STOCKS[sym];
    return [
      s || `${a.name} (${sym}): a listed company; its share price moves on earnings, guidance, its sector, interest rates and the wider market.`,
      'US shares trade 09:30 to 16:00 New York time, with thinner pre-market and after-hours sessions; quarterly earnings and guidance cause the biggest moves (often gaps).',
      'Macro drivers: Fed policy and bond yields, inflation and jobs data, and the direction of the S&P 500 and Nasdaq.',
    ];
  }
  // crypto
  const base = sym.split('/')[0].toUpperCase();
  if (a.dex) {
    const age = a.dex.pairCreatedAt > 0 ? Math.floor((Date.now() - a.dex.pairCreatedAt) / 86400e3) : -1;
    return [
      `${a.name} (${a.dex.symbol}) is an on-chain token traded on the decentralised exchange ${a.dex.dexId} on ${a.dex.chainId}, not on the big centralised exchanges.`,
      `On-chain tokens carry extra risks: thin liquidity and slippage (this pool has about $${Math.round(a.dex.liquidityUsd).toLocaleString('en-US')})${age >= 0 ? `, a young pool (about ${age} day${age === 1 ? '' : 's'} old)` : ''}, concentrated holders, and contract risks such as mint or freeze authority, unlocked liquidity and honeypots. Check the contract on a token-safety tool before trading.`,
      'Prices can move tens of percent in minutes; size positions small and expect gaps.',
      ...CRYPTO_GENERAL.slice(0, 2),
    ];
  }
  return [...(COINS[base] ? [COINS[base]] : [`${a.name} (${base}): a cryptocurrency traded on centralised exchanges.`]), ...CRYPTO_GENERAL];
}

// ---------------------------------------------------------------------------
// Fallback answer (engine unavailable): a full write-up shaped by what was asked
// ---------------------------------------------------------------------------
export function pairBriefing(a: KnowledgeAsset, question: string, liveLines: string[], newsLine: string): string {
  const q = question.toLowerCase();
  const facts = pairKnowledge(a);
  const want = (re: RegExp) => re.test(q);
  const out: string[] = [`### ${a.name} (${a.symbol})`, ''];
  // The first detail line is the live price only when the feed answered
  const hasPrice = /^Price /.test(liveLines[0] || '');
  out.push(hasPrice ? `**Live now:** ${liveLines[0]}.` : '**Live now:** the live price is unavailable right now, so no price is quoted here.');
  const details = hasPrice ? liveLines.slice(1) : liveLines;
  if (details.length) out.push('', ...details.map(l => `- ${l}`));
  out.push('', '#### What it is', '', facts[0]);
  const rest = facts.slice(1);
  const drivers = rest.filter(f => /driver|moves on|driven|key events|central bank|set by|sensitive|correlat|tends to|move with/i.test(f));
  const timing = rest.filter(f => /session|trades|24|hours|weekend|busiest/i.test(f) && !drivers.includes(f));
  const other = rest.filter(f => !drivers.includes(f) && !timing.includes(f));
  const sec = (title: string, lines: string[]) => lines.length && out.push('', `#### ${title}`, '', ...lines.map(l => `- ${l}`));
  // Put what the question is about first
  const order: Array<[string, string[], RegExp]> = [
    ['What moves it', drivers, /move|drive|affect|why|news|fundamental|correlat|factor|influence/],
    ['When it trades and moves', timing, /when|time|session|hour|open|close|weekend/],
    ['How it behaves', other, /behav|volatil|range|risk|pip|spike|tip|trade it|strategy|how/],
  ];
  order.sort((x, y) => Number(want(y[2])) - Number(want(x[2])));
  for (const [t, l] of order) sec(t, l);
  out.push('', "#### Today", '', newsLine);
  out.push('', '#### Trading it with MarketX', '', `- For a trade plan with an entry, stop loss and three targets from live candles, ask **Analyze ${a.symbol}** and add a timeframe, for example on the 4H.`, '- Turn on a price alert on the plan and MarketX watches the levels for you; add it to /watchlist to be told when a fresh setup forms.');
  return out.join('\n');
}
