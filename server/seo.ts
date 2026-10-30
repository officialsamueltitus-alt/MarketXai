import type { Express, Request, Response } from 'express';

// ===========================================================================
// Search engines (owner-requested: MarketX findable on Google for "MarketX" and trading searches).
//   /robots.txt   -> crawl the public pages, never /api or /admin; points to the sitemap
//   /sitemap.xml  -> the public pages (home, the guide, the ID checker)
//   index.html    -> served through `indexFor(path)`: per-page title, description and canonical for the public pages,
//                    plus the owner's search-console ownership tags when set:
//                      GOOGLE_SITE_VERIFICATION (the content of Google's "HTML tag" method),
//                      BING_SITE_VERIFICATION (Bing Webmaster's msvalidate.01 content).
//   GOOGLE_VERIFICATION_FILE (e.g. google1234abcd.html) answers Google's "HTML file" method at /<that name>.
// ===========================================================================

const SITE = 'https://marketx.world';
const PAGES: Record<string, { title: string; description: string; priority: string }> = {
  '/': {
    title: 'MarketX · Your Trading Co-Pilot',
    description:
      'MarketX, your trading co-pilot. Ask any market and get a clear trade plan from live prices: entry, stop loss and take profits for forex, gold, crypto, indices and stocks.',
    priority: '1.0',
  },
  '/blog': {
    title: 'MarketX Guide · How to use your trading co-pilot',
    description:
      'How to use MarketX, your trading co-pilot: trade plans from live prices, the trading agent on MT5, price alerts, the watchlist, the trade journal, fundamental analysis and proofs on Solana.',
    priority: '0.8',
  },
  '/checker': {
    title: 'MarketX ID checker · Verify a trader',
    description: "Check a MarketX trader's ID and track record: every signal result, sealed on Solana.",
    priority: '0.5',
  },
};

const token = (v: unknown) => String(v || '').trim().replace(/[^A-Za-z0-9_\-.:=]/g, '').slice(0, 200);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** index.html for a path: the page's own title/description/canonical and the ownership tags (when set) */
export function indexFor(html: string, path: string): string {
  const page = PAGES[path.replace(/\/+$/, '') || '/'];
  let out = html;
  if (page) {
    const url = `${SITE}${path === '/' ? '' : path.replace(/\/+$/, '')}`;
    out = out
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(page.title)}</title>`)
      .replace(/(<meta name="title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
      .replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
      .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
      .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
      .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(page.title)}$2`)
      .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(page.description)}$2`)
      .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
      .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
      .replace(/(<meta name="twitter:url" content=")[^"]*(")/, `$1${url}$2`);
  }
  const google = token(process.env.GOOGLE_SITE_VERIFICATION);
  const bing = token(process.env.BING_SITE_VERIFICATION);
  const tags = [google && `<meta name="google-site-verification" content="${google}" />`, bing && `<meta name="msvalidate.01" content="${bing}" />`].filter(Boolean).join('\n    ');
  return tags ? out.replace('</head>', `    ${tags}\n  </head>`) : out;
}

export function robotsTxt(): string {
  return ['User-agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /admin', '', `Sitemap: ${SITE}/sitemap.xml`, ''].join('\n');
}

export function sitemapXml(now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const urls = Object.entries(PAGES)
    .map(([p, m]) => `  <url><loc>${SITE}${p === '/' ? '/' : p}</loc><lastmod>${day}</lastmod><changefreq>weekly</changefreq><priority>${m.priority}</priority></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt, sitemap.xml and Google's verification file (registered before the static files) */
export function registerSeoRoutes(app: Express) {
  app.get('/robots.txt', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('text/plain').send(robotsTxt());
  });
  app.get('/sitemap.xml', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type('application/xml').send(sitemapXml());
  });
  app.get(/^\/google[0-9a-f]{8,40}\.html$/, (req: Request, res: Response, next) => {
    const file = token(process.env.GOOGLE_VERIFICATION_FILE);
    if (!file || req.path.slice(1) !== file) return next();
    res.type('text/html').send(`google-site-verification: ${file}`);
  });
}
