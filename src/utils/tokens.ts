// Usage accounting shown in the UI: every prompt is one usage and consumes a fixed token budget,
// split across the steps of the activity trace. The rule itself is not displayed to users.
export const TOKENS_PER_USAGE = 30_000;

// Fixed share per step; the main analysis step receives whatever remains of the budget
const STEP_TOKENS: Record<string, number> = {
  read: 1_200,
  chart: 3_400,
  price: 900,
  plan: 2_600,
  news: 1_300,
  answer: 2_800,
};
const MAIN_STEP = 'analyze';

/** Token allotment per step id for one prompt; always sums to TOKENS_PER_USAGE. */
export function allocateTokens(stepIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  let used = 0;
  for (const id of stepIds) {
    if (id === MAIN_STEP) continue;
    const t = STEP_TOKENS[id] ?? 1_000;
    out[id] = t;
    used += t;
  }
  if (stepIds.includes(MAIN_STEP)) {
    out[MAIN_STEP] = Math.max(0, TOKENS_PER_USAGE - used);
  } else if (stepIds.length) {
    // No main step: scale the others to the full budget
    const scale = TOKENS_PER_USAGE / Math.max(1, used);
    let acc = 0;
    stepIds.forEach((id, i) => {
      out[id] = i === stepIds.length - 1 ? TOKENS_PER_USAGE - acc : Math.round(out[id] * scale);
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
