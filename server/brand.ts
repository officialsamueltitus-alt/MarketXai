import type { Request, Response, NextFunction } from 'express';

// Keeps the underlying AI provider/model private: any mention that slips into generated text
// (or into older saved chats) is replaced with the MarketX engine name before it leaves the server.
const ENGINE = 'MarketX Engine';

const RULES: Array<[RegExp, string]> = [
  // "Google's Gemini 2.5 Flash", "gemini-3.8-flash", "Gemini Pro", "models/gemini-flash-latest"
  [/\b(?:google(?:'s|’s)?\s+)?(?:models\/)?gemini(?:[\s_-]*(?:\d+(?:\.\d+)*|pro|flash|ultra|nano|lite|latest|exp(?:erimental)?|preview|thinking))*\b(?!\s+(?:exchange|trust|dollar|earn|wallet|app\b))/gi, ENGINE],
  [/\b(?:google(?:'s|’s)?\s+(?:bard|palm(?:\s*2)?|lamda)|palm\s*2)\b/gi, ENGINE],
  [/\b(?:trained|developed|built|created|made)\s+by\s+google(?:\s+deepmind)?\b/gi, 'built by SpiriTech Labs'],
  [/\bgoogle\s+deepmind\b/gi, 'SpiriTech Labs'],
  [/\b(?:@google\/genai|generativelanguage\.googleapis\.com|google\s+ai\s+studio|vertex\s+ai)\b/gi, ENGINE],
];

export function hideEngineNames(text: string): string {
  if (!text || !/gemini|bard|palm|lamda|google|genai|vertex/i.test(text)) return text;
  let out = text;
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out.replace(/MarketX Engine(?:\s+MarketX Engine)+/g, ENGINE);
}

function scrub(value: any, depth = 0): any {
  if (depth > 12 || value == null) return value;
  if (typeof value === 'string') return hideEngineNames(value);
  if (Array.isArray(value)) return value.map(v => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value)) out[k] = scrub(value[k], depth + 1);
    return out;
  }
  return value;
}

// Wraps res.json on routes that return AI-written content (new analyses and saved chat history)
export function hideEngineInResponses(req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = (body: any) => json(scrub(body));
  next();
}
