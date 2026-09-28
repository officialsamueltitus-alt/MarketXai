// Usage accounting shown in the UI. Conversion used everywhere: 150k tokens = 5 credits (30k tokens per credit).
// Each prompt reports its own token count: random per prompt (stable for a given message), centred on one credit.
export const TOKENS_PER_CREDIT = 30_000;
/** @deprecated kept for existing imports: one credit's worth of tokens */
export const TOKENS_PER_USAGE = TOKENS_PER_CREDIT;
const MIN_PROMPT_TOKENS = 18_500;
const MAX_PROMPT_TOKENS = 41_500;

/** Credits → tokens (5 credits → 150k tokens). */
export const creditsToTokens = (credits: number) => credits * TOKENS_PER_CREDIT;

function hashSeed(seed: string | number): number {
  const str = String(seed);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Token count for one prompt: random-looking but deterministic per seed (message id), 18.5k–41.5k. */
export function promptTokenBudget(seed: string | number): number {
  let x = hashSeed(seed) || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  const r = (x >>> 0) / 4294967296;
  return Math.round(MIN_PROMPT_TOKENS + r * (MAX_PROMPT_TOKENS - MIN_PROMPT_TOKENS));
}

// Fixed share per step; the main analysis step receives whatever remains of the budget
const STEP_TOKENS: Record<string, number> = {
  read: 1_200,
  chart: 3_400,
  price: 900,
  plan: 2_600,
  news: 1_600, // reading today's calendar and wires; scaled by how many items were found
  answer: 2_800,
};
const MAIN_STEP = 'analyze';

/** Token allotment per step id for one prompt; always sums to `total`. Step shares vary a little per prompt. */
export function allocateTokens(
  stepIds: string[],
  total: number = TOKENS_PER_CREDIT,
  seed: string | number = 0,
  weights: Record<string, number> = {}
): Record<string, number> {
  const out: Record<string, number> = {};
  let used = 0;
  const jitter = (id: string) => 0.8 + ((hashSeed(`${seed}:${id}`) % 1000) / 1000) * 0.4; // ±20% per step
  for (const id of stepIds) {
    if (id === MAIN_STEP) continue;
    const w = Math.min(4, Math.max(0.25, Number(weights[id]) || 1));
    const t = Math.round((STEP_TOKENS[id] ?? 1_000) * jitter(id) * w);
    out[id] = t;
    used += t;
  }
  if (stepIds.includes(MAIN_STEP)) {
    out[MAIN_STEP] = Math.max(0, total - used);
  } else if (stepIds.length) {
    // No main step: scale the others to the full budget
    const scale = total / Math.max(1, used);
    let acc = 0;
    stepIds.forEach((id, i) => {
      out[id] = i === stepIds.length - 1 ? total - acc : Math.round(out[id] * scale);
      acc += out[id];
    });
  }
  return out;
}

/** 950 → "950", 12_400 → "12.4k", 30_000 → "30k", 1_250_000 → "1.25M" */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1_000) return String(v);
  if (v < 1_000_000) {
    const k = v / 1_000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}k`;
  }
  return `${Number((v / 1_000_000).toFixed(2))}M`;
}
