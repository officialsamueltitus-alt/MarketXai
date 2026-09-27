import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, KeyRound, Loader2, Mail } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { MarketXIcon } from './MarketXIcon';
import { MarketXText } from './MarketXText';

interface PasscodePageProps {
  initialEmail?: string | null;
  /** Receives the new account once the code is accepted */
  onGranted: (account: any) => void;
  onBack: () => void;
}

// "MX7K2PQ9XD" / "mx-7k2p q9xd" -> "MX-7K2P-Q9XD" while typing
function formatCode(input: string): string {
  let raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.startsWith('MX')) raw = raw.slice(2);
  raw = raw.slice(0, 8);
  if (!raw) return '';
  return `MX-${raw.slice(0, 4)}${raw.length > 4 ? `-${raw.slice(4)}` : ''}`;
}

// Invite-only gate: new sign-ups enter the one-time pass code that was emailed to them
export const PasscodePage: React.FC<PasscodePageProps> = ({ initialEmail, onGranted, onBack }) => {
  const [email, setEmail] = useState(initialEmail || '');
  const [editingEmail, setEditingEmail] = useState(!initialEmail);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingEmail) codeRef.current?.focus();
  }, [editingEmail]);

  const complete = code.replace(/[^A-Z0-9]/g, '').length === 10; // "MX" + 8

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const account = await apiFetch('/api/access/redeem', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), code }),
      });
      setGranted(true);
      setTimeout(() => onGranted(account), 1800);
    } catch (err: any) {
      setError(err?.message || 'Could not check your pass code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-backdrop min-h-[100dvh] w-full flex flex-col items-center justify-center px-5 py-10 text-slate-100">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <MarketXIcon size="md" />
          <MarketXText className="text-xl" />
        </div>

        <div className="mx-pop-in rounded-[28px] bg-[var(--mx-surface)] border border-white/[0.08] p-6 sm:p-8 shadow-[0_24px_80px_-24px_var(--mx-shadow)]">
          {granted ? (
            <div className="text-center py-6" role="status" aria-live="polite">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center mx-pop-in">
                <Check className="w-8 h-8" strokeWidth={2.5} />
              </div>
              <h1 className="mt-5 text-2xl font-semibold text-white tracking-tight">Access granted</h1>
              <p className="mt-2 text-sm text-slate-400">Welcome to MarketX. A confirmation is on its way to your inbox.</p>
              <p className="mt-6 inline-flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Taking you to MarketX…
              </p>
            </div>
          ) : (
            <form onSubmit={submit}>
              <span className="w-11 h-11 rounded-2xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
                <KeyRound className="w-5 h-5" />
              </span>
              <h1 className="mt-4 text-2xl font-semibold text-white tracking-tight">Enter your pass code</h1>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                MarketX is invite-only. Your one-time pass code works once and only for you.
              </p>

              {editingEmail ? (
                <label className="block mt-6">
                  <span className="text-xs font-medium text-slate-300">Email you signed up with</span>
                  <span className="relative block mt-1.5">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full h-11 pl-10 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none text-sm text-white placeholder:text-slate-600"
                    />
                  </span>
                </label>
              ) : (
                <div className="mt-6 flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <span className="min-w-0">
                    <span className="block text-[11px] text-slate-500">Sent to</span>
                    <span className="block text-sm text-slate-200 truncate">{email}</span>
                  </span>
                  <button type="button" onClick={() => setEditingEmail(true)} className="text-xs text-indigo-300 hover:text-indigo-200 shrink-0 cursor-pointer">
                    Change
                  </button>
                </div>
              )}

              <label className="block mt-4">
                <span className="text-xs font-medium text-slate-300">Pass code</span>
                <input
                  ref={codeRef}
                  value={code}
                  onChange={e => setCode(formatCode(e.target.value))}
                  placeholder="MX-XXXX-XXXX"
                  autoComplete="one-time-code"
                  autoCapitalize="characters"
                  spellCheck={false}
                  inputMode="text"
                  aria-invalid={!!error}
                  className="mt-1.5 w-full h-14 px-4 rounded-2xl bg-white/[0.03] border border-white/[0.1] focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 text-center font-mono text-2xl tracking-[0.18em] text-white placeholder:text-slate-700"
                />
              </label>

              {error && <p className="mt-3 text-xs text-rose-300 leading-relaxed">{error}</p>}

              <button
                type="submit"
                disabled={!complete || busy || !email.trim()}
                className="mt-5 w-full h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Unlock MarketX
              </button>

              <p className="mt-4 text-[11px] text-slate-500 leading-relaxed text-center">
                Can't find it? Check your spam or promotions folder for an email from MarketX. Each code is sent once.
              </p>
            </form>
          )}
        </div>

        {!granted && (
          <button
            type="button"
            onClick={onBack}
            className="mt-6 mx-auto flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>
        )}
      </div>
    </div>
  );
};
