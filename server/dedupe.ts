// ===========================================================================
// One record per signal (owner-specified): the same signal (same pair, timeframe, side and levels) is only ever ONE
// price alert, ONE journal trade and ONE track record result per trader. New duplicates are refused where they would
// be made (startAlert, the journal's add route, archiveAlertOutcome); this sweep removes the ones made before that, or
// by two requests landing at the same instant. The lead worker runs it after a deploy and every 6 hours.
//
// Which copy stays: the active alert, else the one with the most level hits, else the oldest. Its journal trade and
// result stay (moved onto it when only the duplicate had one); notes from a removed copy are kept on the one that stays.
// ===========================================================================
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { autoJournalId, sameTrade, signalKey, type JournalTrade, type TrackRecordEntry } from './journal';
import { forgetAlert, type PriceAlert } from './priceAlerts';

const ALERTS = 'priceAlerts';
const TRADES = 'journalTrades';
const RECORDS = 'trackRecord';
const SWEEP_MS = 6 * 3600e3;

const groupBy = <T>(items: T[], key: (t: T) => string) => {
  const m = new Map<string, T[]>();
  for (const it of items) (m.get(key(it)) || m.set(key(it), []).get(key(it))!).push(it);
  return [...m.values()];
};
const mergeNotes = (a: string, b: string) => (!b || a.includes(b) ? a : !a ? b : `${a}\n${b}`.slice(0, 2000));

export async function dedupeSignals(): Promise<{ alerts: number; journal: number; records: number }> {
  const out = { alerts: 0, journal: 0, records: 0 };
  const col = (n: string) => db().collection(n);

  // 1. Price alerts: one per trader per signal
  const alerts = (await col(ALERTS).get()).docs.map(d => d.data() as PriceAlert);
  for (const group of groupBy(alerts, a => `${a.uid}|${signalKey(a)}`)) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(b.active) - Number(a.active) || b.hits.length - a.hits.length || a.createdAt - b.createdAt);
    const [keep, ...dupes] = group;
    const offerIds = [...new Set(group.flatMap(a => a.offerIds || [a.offerId]))].slice(-20);
    await col(ALERTS).doc(keep.id).update({ offerIds });
    const keepTrade = col(TRADES).doc(autoJournalId(keep.id));
    const keepRecord = col(RECORDS).doc(keep.id);
    for (const d of dupes) {
      forgetAlert(d.id);
      // Its journal trade: moved onto the alert that stays when that one has none, else removed (notes kept)
      const dupTrade = col(TRADES).doc(autoJournalId(d.id));
      const [kt, dt] = await Promise.all([keepTrade.get(), dupTrade.get()]);
      if (dt.exists) {
        const t = dt.data() as JournalTrade;
        if (!kt.exists) await keepTrade.set({ ...t, id: keepTrade.id, auto: t.auto ? { ...t.auto, alertId: keep.id } : t.auto });
        else if (t.notes) await keepTrade.update({ notes: mergeNotes((kt.data() as JournalTrade).notes || '', t.notes) });
        await dupTrade.delete();
        out.journal++;
      }
      // Its track record result: kept only when the alert that stays has none and has already ended
      const dr = await col(RECORDS).doc(d.id).get();
      if (dr.exists) {
        if (!(await keepRecord.get()).exists && !keep.active) await keepRecord.set({ ...(dr.data() as TrackRecordEntry), id: keep.id, signalKey: signalKey(keep) });
        await dr.ref.delete();
        out.records++;
      }
      // Its result cards now point at the alert that stays
      const offers = await col('alertOffers').where('alertId', '==', d.id).get();
      for (const o of offers.docs) await o.ref.update({ alertId: keep.id });
      await col(ALERTS).doc(d.id).delete();
      out.alerts++;
    }
  }

  // 2. Track record: every result carries its signal; one per trader per signal
  const byAlert = new Map(alerts.map(a => [a.id, a]));
  const records = (await col(RECORDS).get()).docs.map(d => d.data() as TrackRecordEntry);
  for (const r of records) {
    if (r.signalKey) continue;
    const a = byAlert.get(r.id);
    r.signalKey = a ? signalKey(a) : r.id;
    await col(RECORDS).doc(r.id).update({ signalKey: r.signalKey }).catch(() => {});
  }
  for (const group of groupBy(records, r => `${r.uid}|${r.signalKey}`)) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.createdAt - b.createdAt);
    for (const r of group.slice(1)) {
      if (!(await col(RECORDS).doc(r.id).get()).exists) continue;
      await col(RECORDS).doc(r.id).delete();
      out.records++;
    }
  }

  // 3. Journal: the same trade logged twice (typed again, or typed as well as logged by its alert)
  const trades = (await col(TRADES).get()).docs.map(d => d.data() as JournalTrade);
  for (const mine of groupBy(trades, t => t.uid)) {
    const gone = new Set<string>();
    // The alert's own copy stays; then the oldest
    mine.sort((a, b) => Number(b.source === 'AUTO') - Number(a.source === 'AUTO') || a.createdAt - b.createdAt);
    for (let i = 0; i < mine.length; i++) {
      const keep = mine[i];
      if (gone.has(keep.id)) continue;
      let notes = keep.notes || '';
      for (const t of mine.slice(i + 1)) {
        if (gone.has(t.id) || !sameTrade(keep, t)) continue;
        // Two auto trades are two alerts (handled above); a manual copy counts when it is open or opened at the same time
        if (t.source === 'AUTO') continue;
        const twin = keep.source === 'AUTO' ? keep.status === 'OPEN' || t.status === 'OPEN' || Math.abs(keep.openedAt - t.openedAt) < 3600e3 : t.status === keep.status && t.exit === keep.exit && Math.abs(keep.openedAt - t.openedAt) < 60_000;
        if (!twin) continue;
        notes = mergeNotes(notes, t.notes || '');
        await col(TRADES).doc(t.id).delete();
        gone.add(t.id);
        out.journal++;
      }
      if (notes !== (keep.notes || '')) await col(TRADES).doc(keep.id).update({ notes });
    }
  }
  return out;
}

export function registerDedupe() {
  if (!isFirebaseConfigured() || !IS_LEAD_WORKER) return;
  const run = () =>
    dedupeSignals()
      .then(r => (r.alerts || r.journal || r.records) && console.log(`[MarketX Dedupe] removed ${r.alerts} duplicate alert(s), ${r.journal} journal trade(s), ${r.records} track record result(s)`))
      .catch(err => console.warn('[MarketX Dedupe] sweep failed:', err?.message || err));
  setTimeout(run, Math.max(1000, Number(process.env.DEDUPE_BOOT_MS) || 60_000)).unref();
  setInterval(run, SWEEP_MS).unref();
}
