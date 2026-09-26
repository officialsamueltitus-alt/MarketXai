import React, { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { X, Mail, Lock, AtSign, User as UserIcon, Loader2 } from 'lucide-react';
import { getFirebaseAuth } from '../utils/firebaseClient';
import { MarketXText } from './MarketXText';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Called right after sign-up so the server can reserve the chosen username
  onSignedUp: (details: { username: string; displayName: string }) => void;
  unavailableReason?: string | null;
}

function friendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorised for sign-in. Add it in Firebase → Authentication → Settings → Authorized domains.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Sign-in failed. Please try again.';
  }
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSignedUp, unavailableReason }) => {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setInfo(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err: any) {
      const msg = friendlyAuthError(err?.code || '');
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const requireAuth = async () => {
    const auth = await getFirebaseAuth();
    if (!auth) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    return auth;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (mode === 'reset') {
      run(async () => {
        const auth = await requireAuth();
        await sendPasswordResetEmail(auth, cleanEmail);
        setInfo('Password reset email sent. Check your inbox.');
      });
      return;
    }
    if (mode === 'signup') {
      const cleanUsername = username.trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (cleanUsername.length < 3) {
        setError('Username must be at least 3 characters (letters, numbers, _).');
        return;
      }
      const cleanName = displayName.trim() || cleanUsername;
      run(async () => {
        const auth = await requireAuth();
        onSignedUp({ username: cleanUsername, displayName: cleanName });
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
        sendEmailVerification(cred.user).catch(() => {});
        onClose();
      });
      return;
    }
    run(async () => {
      const auth = await requireAuth();
      await signInWithEmailAndPassword(auth, cleanEmail, password);
      onClose();
    });
  };

  const handleGoogle = () =>
    run(async () => {
      const auth = await requireAuth();
      await signInWithPopup(auth, new GoogleAuthProvider());
      onClose();
    });

  const inputClass =
    'w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/40 border border-white/[0.12] focus:border-indigo-400/60 focus:outline-none text-sm text-white placeholder-slate-500';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/80 sidebar-detail-fade"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sign in to MarketX"
    >
      <div
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-slate-950 border border-white/[0.14] shadow-2xl shadow-black/80 p-5 pb-safe"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-white">
              {mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset password' : 'Sign in'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {mode === 'reset' ? (
                "We'll email you a link to reset it."
              ) : (
                <>
                  to continue with <MarketXText className="text-xs" />
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] text-slate-300 hover:text-white border border-white/[0.12] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {unavailableReason ? (
          <p className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">{unavailableReason}</p>
        ) : (
          <>
            {mode !== 'reset' && (
              <>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={busy}
                  className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl bg-white text-slate-900 font-semibold text-sm hover:bg-slate-100 disabled:opacity-60 cursor-pointer"
                >
                  <svg className="w-4 h-4" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
                  </svg>
                  Continue with Google
                </button>
                <div className="flex items-center gap-3 my-4 text-[11px] text-slate-500">
                  <span className="flex-1 h-px bg-white/[0.08]" />
                  or with email
                  <span className="flex-1 h-px bg-white/[0.08]" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-2.5">
              {mode === 'signup' && (
                <>
                  <label className="relative block">
                    <AtSign className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
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
                    <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      className={inputClass}
                      placeholder="Display name (optional)"
                      value={displayName}
                      onChange={e => setDisplayName(e.target.value)}
                      autoComplete="name"
                      maxLength={40}
                    />
                  </label>
                </>
              )}
              <label className="relative block">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
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
              {mode !== 'reset' && (
                <label className="relative block">
                  <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    className={inputClass}
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    minLength={6}
                    required
                  />
                </label>
              )}

              {error && <p className="text-xs text-rose-300">{error}</p>}
              {info && <p className="text-xs text-emerald-300">{info}</p>}

              <button
                type="submit"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white font-semibold text-sm disabled:opacity-60 cursor-pointer"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
              </button>
            </form>

            <div className="mt-4 flex items-center justify-between text-xs">
              {mode === 'signin' ? (
                <>
                  <button type="button" onClick={() => setMode('reset')} className="text-slate-400 hover:text-white cursor-pointer">
                    Forgot password?
                  </button>
                  <button type="button" onClick={() => setMode('signup')} className="text-indigo-300 hover:text-indigo-200 font-semibold cursor-pointer">
                    Create account
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setMode('signin')} className="text-indigo-300 hover:text-indigo-200 font-semibold cursor-pointer">
                  ← Back to sign in
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
