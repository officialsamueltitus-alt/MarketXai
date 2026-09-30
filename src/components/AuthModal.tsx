import React, { Suspense, useEffect, useRef, useState } from 'react';
import { lazyWithReload } from '../utils/lazyReload';
import { deviceSignals } from '../utils/device';
import { createPortal } from 'react-dom';
import { X, Mail, Lock, AtSign, User as UserIcon, Loader2, ArrowLeft, Check } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { MarketXText } from './MarketXText';
import { MarketXIcon } from './MarketXIcon';
import { TelegramIcon } from './SocialIcons';
import { MARKETX_TELEGRAM_URL } from '../utils/campaign';

const TermsAndPrivacyModal = lazyWithReload(() => import('./TermsAndPrivacyModal').then(m => ({ default: m.TermsAndPrivacyModal })));

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Receives the account payload returned by the server after a successful sign-in
  onAuthenticated: (account: any) => void;
  googleClientId?: string | null;
  // Present when the user opened a password-reset link (?reset=...)
  resetToken?: string | null;
  unavailableReason?: string | null;
  /** Mode to open in (e.g. "signup" from the welcome screen) */
  initialMode?: 'signin' | 'signup';
  /** New sign-ups wait for their emailed pass code before the account exists */
  onPending?: (email: string, message?: string) => void;
}

declare global {
  interface Window {
    google?: any;
  }
}

let gisPromise: Promise<void> | null = null;
function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gisPromise = null;
        reject(new Error('Google sign-in could not load'));
      };
      document.head.appendChild(script);
    });
  }
  return gisPromise;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthenticated,
  googleClientId,
  resetToken,
  unavailableReason,
  initialMode = 'signin',
  onPending,
}) => {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [batchFull, setBatchFull] = useState<string | null>(null);
  // Terms & Privacy must be accepted before any sign-up, and before any Google sign-in
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsNudge, setTermsNudge] = useState(0);
  const [termsTab, setTermsTab] = useState<'terms' | 'privacy' | null>(null);
  const acceptedTermsRef = useRef(acceptedTerms);
  acceptedTermsRef.current = acceptedTerms;
  const termsTabRef = useRef(termsTab);
  termsTabRef.current = termsTab;
  const googleButtonRef = useRef<HTMLDivElement>(null);
  // Parent callbacks are held in refs so parent re-renders (e.g. live price polling) don't reset the form
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onPendingRef = useRef(onPending);
  onPendingRef.current = onPending;

  // Signed in, or waiting for a pass code: route accordingly
  const finish = (account: any) => {
    if (account?.pending) {
      onPendingRef.current?.(account.email, account.message);
      onCloseRef.current();
      return;
    }
    onAuthenticatedRef.current(account);
    onCloseRef.current();
  };

  useEffect(() => {
    if (!isOpen) return;
    setMode(resetToken ? 'reset' : initialMode);
    setError(null);
    setInfo(null);
    setBatchFull(null);
    setAcceptedTerms(false);
    setTermsTab(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (termsTabRef.current) setTermsTab(null);
      else onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, resetToken, initialMode]);

  // Render Google's official button (Google Identity Services); the server verifies the token
  useEffect(() => {
    if (!isOpen || !googleClientId || unavailableReason || (mode !== 'signin' && mode !== 'signup')) return;
    let cancelled = false;
    loadGoogleIdentity()
      .then(() => {
        if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (response: { credential: string }) => {
            setBusy(true);
            setError(null);
            try {
              const account = await apiFetch('/api/auth/google', {
                method: 'POST',
                body: JSON.stringify({ credential: response.credential, acceptTerms: acceptedTermsRef.current, device: await deviceSignals() }),
              });
              finish(account);
            } catch (err: any) {
              if (err?.code === 'BATCH_FULL') setBatchFull(err.message);
              else setError(err?.message || 'Google sign-in failed.');
            } finally {
              setBusy(false);
            }
          },
        });
        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: mode === 'signup' ? 'signup_with' : 'continue_with',
          width: Math.min(360, googleButtonRef.current.clientWidth || 320),
        });
      })
      .catch(() => !cancelled && setError('Google sign-in could not load. Use email instead.'));
    return () => {
      cancelled = true;
    };
  }, [isOpen, googleClientId, mode, unavailableReason]);

  if (!isOpen) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err: any) {
      if (err?.code === 'BATCH_FULL') setBatchFull(err.message);
      else setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const askForTerms = () => {
    setInfo(null);
    setError(
      mode === 'signup'
        ? 'Please tick the box to accept the Terms of Service and Privacy Policy before creating your account.'
        : 'Please tick the box to accept the Terms of Service and Privacy Policy before continuing with Google.'
    );
    setTermsNudge(n => n + 1);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();

    if (mode === 'forgot') {
      run(async () => {
        const res = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: cleanEmail }),
        });
        setInfo(res.message);
      });
      return;
    }

    if (mode === 'reset') {
      run(async () => {
        const account = await apiFetch('/api/auth/reset-password', {
          method: 'POST',
          body: JSON.stringify({ token: resetToken, password }),
        });
        onAuthenticated(account);
        onClose();
      });
      return;
    }

    if (mode === 'signup') {
      if (!acceptedTerms) {
        askForTerms();
        return;
      }
      const cleanUsername = username.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanUsername.length < 3) {
        setError('Username must be at least 3 characters (letters, numbers, _).');
        return;
      }
      run(async () => {
        const account = await apiFetch('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({
            email: cleanEmail,
            password,
            username: cleanUsername,
            displayName: displayName.trim() || cleanUsername,
            acceptTerms: true,
            device: await deviceSignals(),
          }),
        });
        finish(account);
      });
      return;
    }

    run(async () => {
      const account = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, password, device: await deviceSignals() }),
      });
      finish(account);
    });
  };

  const title =
    mode === 'signup' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : mode === 'reset' ? 'Choose a new password' : 'Welcome back';
  const subtitle =
    mode === 'signup'
      ? "MarketX is invite-only. We'll email you a one-time pass code to activate your account."
      : mode === 'forgot'
      ? "Enter your email and we'll send you a reset link."
      : mode === 'reset'
      ? 'Pick a password with at least 8 characters.'
      : null;

  const inputClass =
    'w-full h-11 pl-10 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.14] focus:border-violet-400/60 focus:bg-white/[0.05] focus:outline-none focus:ring-4 focus:ring-violet-500/10 text-sm text-white placeholder-zinc-500 transition-colors';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 mx-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to MarketX"
    >
      <div
        className="mx-pop-in relative w-full sm:max-w-[400px] max-h-[94dvh] rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8)] p-6 pb-safe overflow-x-hidden overflow-y-auto overscroll-contain"
        onClick={e => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-48 rounded-full bg-violet-600/20 blur-3xl" aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative text-center mb-6 mt-1">
          <div className="flex flex-col items-center gap-2 mb-3">
            <MarketXIcon size="lg" />
            <MarketXText className="text-lg" />
          </div>
          {!batchFull && <h2 className="text-xl font-semibold text-white tracking-tight">{title}</h2>}
          {subtitle && !batchFull && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
        </div>

        {batchFull ? (
          <div className="relative text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center text-xl" aria-hidden="true">
              ⏳
            </div>
            <p className="mt-4 text-[15px] font-semibold text-white">Batch fully allocated</p>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{batchFull}</p>
            <a
              href="https://x.com/_MarketX"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              Follow @_MarketX for updates
            </a>
            <a
              href={MARKETX_TELEGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 flex mx-auto w-fit items-center justify-center gap-2 h-11 px-5 rounded-xl border border-[#2AABEE]/40 text-sm font-semibold text-white hover:bg-[#2AABEE]/10 transition-colors"
            >
              <TelegramIcon className="w-[18px] h-[18px]" /> Join our Telegram
            </a>
            <button type="button" onClick={() => setBatchFull(null)} className="mt-3 block mx-auto text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">
              Back
            </button>
          </div>
        ) : unavailableReason ? (
          <p className="relative text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">{unavailableReason}</p>
        ) : (
          <div className="relative">
            {(mode === 'signin' || mode === 'signup') && (
              <div
                key={termsNudge}
                className={`mb-4 rounded-xl border px-3 py-2.5 transition-colors ${
                  acceptedTerms
                    ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                    : termsNudge
                      ? 'border-rose-400/50 bg-rose-500/[0.07] mx-shake'
                      : 'border-white/[0.08] bg-white/[0.03]'
                }`}
              >
                <label className="flex items-start gap-2.5 cursor-pointer select-none text-left">
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={acceptedTerms}
                    onChange={e => {
                      setAcceptedTerms(e.target.checked);
                      if (e.target.checked) setError(null);
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 w-[18px] h-[18px] shrink-0 rounded-md border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-violet-400/60 ${
                      acceptedTerms ? 'bg-violet-500 border-violet-500 text-white' : 'border-zinc-500 bg-transparent'
                    }`}
                  >
                    {acceptedTerms && <Check className="w-3 h-3" strokeWidth={3} />}
                  </span>
                  <span className="text-xs leading-relaxed text-zinc-300">
                    I have read and agree to the MarketX{' '}
                    <button type="button" onClick={e => (e.preventDefault(), setTermsTab('terms'))} className="text-violet-300 hover:text-violet-200 underline underline-offset-2 cursor-pointer">
                      Terms of Service
                    </button>{' '}
                    and{' '}
                    <button type="button" onClick={e => (e.preventDefault(), setTermsTab('privacy'))} className="text-violet-300 hover:text-violet-200 underline underline-offset-2 cursor-pointer">
                      Privacy Policy
                    </button>
                    .
                  </span>
                </label>
                {mode === 'signin' && (
                  <p className="mt-1.5 pl-[28px] text-[11px] text-zinc-500 leading-snug">Required to continue with Google.</p>
                )}
              </div>
            )}

            {(mode === 'signin' || mode === 'signup') && googleClientId && (
              <>
                <div className="relative">
                  <div ref={googleButtonRef} className={`flex justify-center min-h-[44px] transition-opacity ${acceptedTerms ? '' : 'opacity-45'}`} />
                  {!acceptedTerms && (
                    // Google's button is an iframe; this shield catches taps until the terms are accepted
                    <button
                      type="button"
                      onClick={askForTerms}
                      className="absolute inset-0 w-full cursor-pointer rounded-xl"
                      aria-label="Accept the Terms of Service and Privacy Policy to continue with Google"
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 my-5 text-[11px] uppercase tracking-wider text-zinc-500">
                  <span className="flex-1 h-px bg-white/[0.07]" />
                  or
                  <span className="flex-1 h-px bg-white/[0.07]" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'signup' && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="relative block">
                    <AtSign className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      className={inputClass}
                      placeholder="Username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      autoComplete="username"
                      maxLength={20}
                      required
                    />
                  </label>
                  <label className="relative block">
                    <UserIcon className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      className={inputClass}
                      placeholder="Name"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      autoComplete="name"
                      maxLength={40}
                    />
                  </label>
                </div>
              )}
              {mode !== 'reset' && (
                <label className="relative block">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    className={inputClass}
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                  />
                </label>
              )}
              {mode !== 'forgot' && (
                <label className="relative block">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    className={inputClass}
                    type="password"
                    placeholder={mode === 'reset' ? 'New password' : 'Password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    minLength={mode === 'signin' ? 1 : 8}
                    required
                  />
                </label>
              )}

              {error && <p className="text-xs text-rose-300 px-1">{error}</p>}
              {info && <p className="text-xs text-emerald-300 px-1">{info}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full h-11 flex items-center justify-center gap-2 rounded-xl bg-white text-zinc-950 font-semibold text-sm hover:bg-zinc-200 active:scale-[0.99] disabled:opacity-60 transition cursor-pointer"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}
              </button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-4 text-xs">
              {mode === 'signin' && (
                <>
                  <button type="button" onClick={() => setMode('forgot')} className="text-zinc-400 hover:text-white transition-colors cursor-pointer">
                    Forgot password?
                  </button>
                  <span className="w-1 h-1 rounded-full bg-zinc-700" />
                  <button type="button" onClick={() => setMode('signup')} className="text-violet-300 hover:text-violet-200 font-medium transition-colors cursor-pointer">
                    Create account
                  </button>
                </>
              )}
              {mode === 'signup' && (
                <span className="text-zinc-400">
                  Already have an account?{' '}
                  <button type="button" onClick={() => setMode('signin')} className="text-violet-300 hover:text-violet-200 font-medium cursor-pointer">
                    Sign in
                  </button>
                </span>
              )}
              {(mode === 'forgot' || mode === 'reset') && (
                <button type="button" onClick={() => setMode('signin')} className="inline-flex items-center gap-1 text-zinc-400 hover:text-white cursor-pointer">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>
              )}
            </div>
          </div>
        )}
      </div>
      {termsTab &&
        createPortal(
          // Rendered above the sign-in sheet; clicks must not reach the sheet's backdrop
          <div className="relative z-[80]" onClick={e => e.stopPropagation()}>
            <div className="fixed inset-0 z-[80]">
              <Suspense fallback={null}>
                <TermsAndPrivacyModal key={termsTab} isOpen onClose={() => setTermsTab(null)} defaultTab={termsTab} />
              </Suspense>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
