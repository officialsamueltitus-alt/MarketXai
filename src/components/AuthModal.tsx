import React, { useEffect, useRef, useState } from 'react';
import { X, Mail, Lock, AtSign, User as UserIcon, Loader2, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { MarketXText } from './MarketXText';
import { MarketXIcon } from './MarketXIcon';

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
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
                body: JSON.stringify({ credential: response.credential }),
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
          }),
        });
        finish(account);
      });
      return;
    }

    run(async () => {
      const account = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, password }),
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
        className="mx-pop-in relative w-full sm:max-w-[400px] rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8)] p-6 pb-safe overflow-hidden"
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
              href="https://x.com/_MarketXai"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-white text-zinc-950 text-sm font-semibold hover:bg-zinc-200 transition-colors"
            >
              Follow @_MarketXai for updates
            </a>
            <button type="button" onClick={() => setBatchFull(null)} className="mt-3 block mx-auto text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer">
              Back
            </button>
          </div>
        ) : unavailableReason ? (
          <p className="relative text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">{unavailableReason}</p>
        ) : (
          <div className="relative">
            {(mode === 'signin' || mode === 'signup') && googleClientId && (
              <>
                <div ref={googleButtonRef} className="flex justify-center min-h-[44px]" />
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
    </div>
  );
};
