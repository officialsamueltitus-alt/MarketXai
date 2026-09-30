// Web research for questions: the answer engine may search the web while it writes, and this reads back what it
// searched and which sites it used, so the reader sees the sources (site names only, never the search provider's
// redirect links) in the thinking steps and under the answer.

export interface ResearchSource {
  domain: string;
}

export interface ResearchInfo {
  /** The web was searched for this answer */
  web: boolean;
  /** What was searched (at most 4, trimmed) */
  queries: string[];
  /** Sites the answer used, de-duplicated */
  sources: ResearchSource[];
  /** Live MarketX data used (live price venue, on-chain pool, today's news) */
  data: string[];
  /** Served from a stored answer (the live price is still fresh) */
  cached?: boolean;
}

const DOMAIN = /^(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24})$/;
// Search-provider and redirect hosts are never shown as a source
const HIDDEN = /(^|\.)(google|googleapis|googleusercontent|gstatic|vertexaisearch|withgoogle)\.[a-z.]+$/;

/** A site name that is safe to show: a bare, valid host name, nothing else. */
export function cleanDomain(raw: unknown): string {
  const s = String(raw || '').trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#\s]/)[0];
  const m = DOMAIN.exec(s);
  if (!m || m[1].length > 60 || HIDDEN.test(m[1])) return '';
  return m[1];
}

/** Reads the searches and sources from an engine response (empty when the engine answered without searching). */
export function readGrounding(response: any): { queries: string[]; sources: ResearchSource[] } {
  const meta = response?.candidates?.[0]?.groundingMetadata;
  if (!meta || typeof meta !== 'object') return { queries: [], sources: [] };
  const queries = (Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries : [])
    .filter((q: unknown) => typeof q === 'string' && q.trim())
    .map((q: string) => q.trim().replace(/\s+/g, ' ').slice(0, 90))
    .slice(0, 4);
  const seen = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const chunk of Array.isArray(meta.groundingChunks) ? meta.groundingChunks : []) {
    const web = chunk?.web;
    const domain = cleanDomain(web?.domain) || cleanDomain(web?.title);
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      sources.push({ domain });
    }
    if (sources.length >= 8) break;
  }
  return { queries, sources };
}

/** "Sources: a.com · b.com" line placed under a web-researched answer */
export function sourcesFooter(sources: ResearchSource[]): string {
  if (!sources.length) return '';
  return `\n\n---\n_Sources: ${sources.map(s => s.domain).join(' · ')}_`;
}
