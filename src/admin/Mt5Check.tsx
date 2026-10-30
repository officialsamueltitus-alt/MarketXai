import React, { useState } from 'react';
import { CheckCircle2, Loader2, Plug, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Card } from './ui';

// Admin → Overview: one tap to check the MT5 connection setup (the token MarketX holds, its region, and whether the MT5
// connection service answers and accepts the token). Nothing about traders is read.
interface Check {
  configured: boolean;
  tokenShape: 'JWT' | 'OTHER' | 'MISSING';
  region: string;
  provisioning: { ok: boolean; ms: number; status?: number; message?: string; accounts?: number };
}

const HINTS: Array<[RegExp, string]> = [
  [/No .*token|NOT_CONFIGURED/i, "Add the API token from your MT5 connection provider's dashboard to the server settings, then redeploy."],
  [/MT5_AUTH|refused|401|403/i, 'The provider refused the token. Copy a fresh full-access API token from its dashboard into the server settings (no quotes, no spaces).'],
  [/TOKEN_FORMAT|not in a valid form/i, 'The saved token has stray characters. Paste it again exactly as the dashboard shows it.'],
  [/didn't answer within|TIMEOUT/i, 'The provider was too slow to answer. Try again; if it keeps happening, check its status page.'],
  [/couldn't reach|network code/i, 'The server could not reach the provider over the network. Try again; if it keeps happening, contact your hosting support with the network code.'],
];

export const Mt5CheckCard: React.FC = () => {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<Check | null>(null);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      setR(await apiFetch<Check>('/api/admin/mt5/check', { timeoutMs: 25_000 }));
    } catch (e: any) {
      setErr(e?.message || 'Check failed.');
    } finally {
      setBusy(false);
    }
  };
  const msg = r?.provisioning.message || '';
  const hint = r && !r.provisioning.ok ? HINTS.find(([re]) => re.test(msg))?.[1] : null;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Plug className="w-4 h-4 text-emerald-300" /> MT5 connection
        </span>
      }
      action={
        <button type="button" onClick={run} disabled={busy} className="h-8 px-3 rounded-full bg-white text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Test connection
        </button>
      }
    >
      {!r && !err && <p className="text-xs text-slate-500">Checks the token MarketX uses for MT5 linking and whether the MT5 connection service accepts it.</p>}
      {err && <p className="text-xs text-rose-300">{err}</p>}
      {r && (
        <div className="space-y-1.5 text-sm">
          <p className={`flex items-center gap-2 ${r.provisioning.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
            {r.provisioning.ok ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {r.provisioning.ok ? `Working: the token is accepted (${r.provisioning.ms} ms).` : msg || 'Not working.'}
          </p>
          <p className="text-xs text-slate-400">
            Token: {r.tokenShape === 'JWT' ? 'set, looks right' : r.tokenShape === 'OTHER' ? 'set, but not in the usual form (it should be one long string with two dots)' : 'not set'} · Region: {r.region}
          </p>
          {hint && <p className="text-xs text-amber-200">{hint}</p>}
        </div>
      )}
    </Card>
  );
};
