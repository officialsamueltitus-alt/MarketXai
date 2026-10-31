import React, { useEffect, useState } from 'react';
import { Download, Loader2, MoreVertical, PlusSquare, Share, X, Zap, Bell, Maximize } from 'lucide-react';
import { MarketXIcon } from './MarketXIcon';
import { installPlatform, isStandalone, onInstallChange, promptInstall, shouldAskInstall, snoozeInstall, type InstallPlatform } from '../utils/install';

// After sign-in (owner-specified): a sheet asking the trader to add MarketX to their device as a web app. "Install" opens
// the browser's own install window where there is one (Chrome, Edge, Samsung); iPhone/iPad and other browsers get the two
// steps. "Not now" or ✕ closes it for a week; once installed it never shows again.
const SHOW_AFTER_MS = 3500;

export const InstallPrompt: React.FC<{ signedIn: boolean }> = ({ signedIn }) => {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn || isStandalone()) return;
    // The install window needs the app's service worker in place (it has no caching, so nothing else changes)
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration('/').then(r => r || navigator.serviceWorker.register('/sw.js', { scope: '/' })).catch(() => {});
    const t = setTimeout(() => {
      if (shouldAskInstall()) {
        setPlatform(installPlatform());
        setOpen(true);
      }
    }, SHOW_AFTER_MS);
    // Chrome may offer its install window a little later: the sheet switches to the Install button when it does
    const off = onInstallChange(() => {
      setPlatform(installPlatform());
      if (isStandalone()) setOpen(false);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [signedIn]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open || !signedIn) return null;
  const close = () => {
    snoozeInstall();
    setOpen(false);
  };
  const install = async () => {
    setBusy(true);
    const out = await promptInstall().catch(() => 'unavailable' as const);
    setBusy(false);
    if (out === 'accepted') setOpen(false);
    else if (out === 'dismissed') close();
  };

  const steps: Array<[React.ReactNode, React.ReactNode]> =
    platform === 'ios-safari' || platform === 'ios-other'
      ? [
          [<Share key="i" className="w-4 h-4" />, <>Tap <b className="text-white">Share</b> {platform === 'ios-safari' ? 'in the toolbar' : 'in the address bar menu'}</>],
          [<PlusSquare key="i" className="w-4 h-4" />, <>Choose <b className="text-white">Add to Home Screen</b>, then <b className="text-white">Add</b></>],
        ]
      : platform === 'android'
        ? [
            [<MoreVertical key="i" className="w-4 h-4" />, <>Open your browser’s <b className="text-white">menu</b> (⋮)</>],
            [<PlusSquare key="i" className="w-4 h-4" />, <>Tap <b className="text-white">Install app</b> or <b className="text-white">Add to Home screen</b></>],
          ]
        : platform === 'mac-safari'
          ? [
              [<Share key="i" className="w-4 h-4" />, <>Open <b className="text-white">File</b> in the menu bar</>],
              [<PlusSquare key="i" className="w-4 h-4" />, <>Choose <b className="text-white">Add to Dock</b></>],
            ]
          : [];

  return (
    <div className="fixed inset-x-0 bottom-0 z-[44] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-5 pointer-events-none" role="dialog" aria-modal="false" aria-label="Add MarketX to your device">
      <section className="mx-rise pointer-events-auto relative w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/[0.1] bg-[var(--mx-bg-2)] shadow-[0_30px_80px_-24px_rgba(0,0,0,0.85)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_80%_at_0%_0%,rgba(139,92,246,0.28),transparent_60%),radial-gradient(70%_70%_at_100%_0%,rgba(217,70,239,0.16),transparent_60%)]" />
        <button type="button" onClick={close} aria-label="Close" className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer">
          <X className="w-4 h-4" />
        </button>
        <div className="relative p-5">
          <div className="flex items-center gap-3 pr-8">
            <span className="w-12 h-12 rounded-2xl bg-black/40 border border-white/[0.08] flex items-center justify-center shrink-0">
              <MarketXIcon size="md" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-white leading-tight">Add MarketX to your {platform === 'mac-safari' || platform === 'prompt' ? 'device' : 'home screen'}</p>
              <p className="mt-0.5 text-[12px] text-slate-400">Open it in one tap, like an app.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              [Maximize, 'Full screen'],
              [Zap, 'Opens faster'],
              [Bell, 'Alerts on your phone'],
            ].map(([Icon, label]) => {
              const I = Icon as React.ElementType;
              return (
                <div key={label as string} className="rounded-2xl bg-white/[0.04] border border-white/[0.06] px-2 py-2.5">
                  <I className="w-4 h-4 mx-auto text-violet-300" />
                  <p className="mt-1 text-[10.5px] text-slate-300 leading-tight">{label as string}</p>
                </div>
              );
            })}
          </div>

          {platform === 'prompt' ? (
            <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
              <button type="button" onClick={install} disabled={busy} className="h-11 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-60 cursor-pointer">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Install MarketX
              </button>
              <button type="button" onClick={close} className="h-11 px-4 rounded-2xl border border-white/[0.1] text-sm font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer">
                Not now
              </button>
            </div>
          ) : (
            <>
              <ol className="mt-4 space-y-2">
                {steps.map(([icon, text], i) => (
                  <li key={i} className="flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] px-3 py-2.5">
                    <span className="w-6 h-6 rounded-full bg-violet-500/20 text-violet-200 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="text-[12.5px] text-slate-300 leading-snug flex-1">{text}</span>
                    <span className="text-violet-300 shrink-0">{icon}</span>
                  </li>
                ))}
              </ol>
              <button type="button" onClick={close} className="mt-3 w-full h-10 rounded-2xl border border-white/[0.1] text-sm font-medium text-slate-300 hover:text-white hover:bg-white/[0.05] cursor-pointer">
                Not now
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
