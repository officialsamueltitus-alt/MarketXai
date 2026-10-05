import React, { useEffect, useState } from 'react';
import { Loader2, Smartphone, Share } from 'lucide-react';
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from '../utils/push';

/** "Phone notifications" switch for one device (watchlist + price alerts share it) */
export const PushToggle: React.FC<{ what: string; onToast?: (message: string, type?: 'success' | 'info') => void }> = ({ what, onToast }) => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    pushState().then(s => live && setState(s)).catch(() => live && setState('unsupported'));
    return () => {
      live = false;
    };
  }, []);
  if (!state || state === 'unsupported') return null;

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = state === 'on' ? await disablePush() : await enablePush();
      setState(next);
      if (next === 'on') onToast?.('Phone notifications are on for this device.', 'success');
      else if (next === 'blocked') onToast?.('Notifications are blocked for MarketX in this browser.', 'info');
    } catch {
      onToast?.('Could not turn on notifications on this device. Please try again.', 'info');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    const r = await sendTestPush();
    onToast?.(r.ok ? 'Test sent. It arrives in a few seconds.' : r.message || 'No device received it. Turn notifications off and on again.', r.ok ? 'success' : 'info');
  };

  const on = state === 'on';
  const note =
    state === 'blocked'
      ? 'Blocked in this browser. Allow notifications for MarketX in the browser’s site settings.'
      : state === 'ios-install'
        ? 'On iPhone or iPad: tap Share, then Add to Home Screen, and open MarketX from there.'
        : on
          ? 'On for this device, with its own sound.'
          : `Get ${what} even when MarketX is closed.`;

  return (
    <div className="mt-2 w-full flex items-center gap-2.5 px-3 min-h-10 py-2 rounded-xl bg-white/[0.025] border border-white/[0.06]">
      {state === 'ios-install' ? <Share className="w-4 h-4 text-sky-300 shrink-0" /> : <Smartphone className={`w-4 h-4 shrink-0 ${on ? 'text-emerald-300' : 'text-slate-500'}`} />}
      <span className="min-w-0">
        <span className="block text-xs text-slate-200">Phone notifications</span>
        <span className="block text-[10.5px] leading-snug text-slate-500">
          {note}
          {on && (
            <button type="button" onClick={test} className="ml-1 text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline cursor-pointer">
              Send a test
            </button>
          )}
        </span>
      </span>
      {(state === 'on' || state === 'off') && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Phone notifications"
          onClick={toggle}
          disabled={busy}
          className="ml-auto shrink-0 cursor-pointer disabled:cursor-wait"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          ) : (
            <span className={`relative block w-9 h-5 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-white/[0.12]'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
            </span>
          )}
        </button>
      )}
    </div>
  );
};
