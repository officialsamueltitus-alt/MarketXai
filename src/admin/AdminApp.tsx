import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Users as UsersIcon,
  BarChart3,
  CreditCard,
  Megaphone,
  ShieldCheck,
  LogOut,
  Lock,
  Loader2,
  Eye,
  EyeOff,
  KeyRound,
  RotateCcw,
  RefreshCw,
  MessageCircle,
  Gift,
  Bot,
  Landmark,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { MarketXIcon } from '../components/MarketXIcon';
import { MarketXText } from '../components/MarketXText';
import { Overview } from './Overview';
import { UsersSection } from './Users';
import { UsageSection } from './Usage';
import { SubscriptionsSection } from './Subscriptions';
import { CampaignSection } from './Campaign';
import { BroadcastSection } from './Broadcast';
import { SupportSection } from './Support';
import { FundamentalAdminSection, MattAdminSection } from './SiTools';
import { Card, ConfirmDialog, fmtDateTime } from './ui';

type Section = 'overview' | 'users' | 'usage' | 'matt' | 'fundamental' | 'subscriptions' | 'campaign' | 'support' | 'broadcast' | 'security';

const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'usage', label: 'Usage', icon: BarChart3 },
  { id: 'matt', label: 'Matt', icon: Bot },
  { id: 'fundamental', label: 'Fundamentals', icon: Landmark },
  { id: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { id: 'campaign', label: 'Campaign', icon: Gift },
  { id: 'support', label: 'Support', icon: MessageCircle },
  { id: 'broadcast', label: 'Broadcast', icon: Megaphone },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

const IDLE_LOCK_MS = 30 * 60 * 1000;

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------
const AdminLogin: React.FC<{ onSignedIn: () => void; notice?: string | null }> = ({ onSignedIn, notice }) => {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      onSignedIn();
    } catch (err: any) {
      setError(err?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-backdrop min-h-[100dvh] flex items-center justify-center px-5 py-10 text-slate-100">
      <form onSubmit={submit} className="mx-pop-in w-full max-w-[400px]" autoComplete="off">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <MarketXIcon size="md" />
          <MarketXText className="text-xl" />
          <span className="h-6 px-2 rounded-full bg-white/[0.06] text-[11px] font-medium text-slate-300 inline-flex items-center">Admin</span>
        </div>
        <div className="rounded-[28px] bg-[var(--mx-surface)] border border-white/[0.08] p-6 sm:p-8 shadow-[0_24px_80px_-24px_var(--mx-shadow)]">
          <span className="w-11 h-11 rounded-2xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
            <Lock className="w-5 h-5" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold text-white tracking-tight">Admin console</h1>
          <p className="mt-1.5 text-sm text-slate-400">Restricted area. Enter the admin password to continue.</p>
          {notice && <p className="mt-4 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">{notice}</p>}
          <label className="block mt-6">
            <span className="text-xs font-medium text-slate-300">Password</span>
            <span className="relative block mt-1.5">
              <input
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
                aria-invalid={!!error}
                className="w-full h-12 pl-4 pr-11 rounded-2xl bg-white/[0.03] border border-white/[0.1] focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 text-sm text-white"
              />
              <button
                type="button"
                onClick={() => setShow(s => !s)}
                aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-slate-500 hover:text-white inline-flex items-center justify-center cursor-pointer"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </span>
          </label>
          {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={!password || busy}
            className="mt-5 w-full h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Unlock console
          </button>
        </div>
        <a href="/" className="mt-6 block text-center text-xs text-slate-500 hover:text-slate-300">
          Back to MarketX
        </a>
      </form>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Security: custom password + reset to default
// ---------------------------------------------------------------------------
const SecuritySection: React.FC<{ session: { custom: boolean; updatedAt: number | null }; onChanged: () => void }> = ({ session, onChanged }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');

  const strong = next.length >= 10 && /[A-Za-z]/.test(next) && /\d/.test(next);
  const inputCls =
    'mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none text-sm text-white';

  const change = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setMsg({ ok: false, text: 'The new passwords do not match.' });
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch('/api/admin/password', { method: 'POST', body: JSON.stringify({ current, next }) });
      setMsg({ ok: true, text: 'Custom password saved. Other admin sessions were signed out.' });
      setCurrent('');
      setNext('');
      setConfirm('');
      onChanged();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || 'Could not change the password.' });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await apiFetch('/api/admin/password/reset', { method: 'POST', body: JSON.stringify({ confirm: 'RESET' }) });
      setMsg({ ok: true, text: 'Password reset to the default. Other admin sessions were signed out.' });
      onChanged();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || 'Could not reset the password.' });
    } finally {
      setBusy(false);
      setResetOpen(false);
      setResetText('');
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4 max-w-4xl">
      <Card title="Change admin password">
        <p className="text-sm text-slate-400 -mt-1 mb-4">
          Currently using {session.custom ? 'a custom password' : 'the default password'}
          {session.updatedAt ? `, last changed ${fmtDateTime(session.updatedAt)}` : ''}.
        </p>
        <form onSubmit={change} className="space-y-3" autoComplete="off">
          <label className="block">
            <span className="text-xs text-slate-400">Current password</span>
            <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">New password</span>
            <input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" className={inputCls} />
            <span className={`mt-1 block text-[11px] ${next && !strong ? 'text-amber-300' : 'text-slate-500'}`}>At least 10 characters, with letters and numbers.</span>
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Confirm new password</span>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" className={inputCls} />
          </label>
          {msg && (
            <p className={`text-xs rounded-xl p-2.5 border ${msg.ok ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-200 bg-rose-500/10 border-rose-500/20'}`}>{msg.text}</p>
          )}
          <button
            type="submit"
            disabled={!current || !strong || !confirm || busy}
            className="w-full h-11 rounded-xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Save custom password
          </button>
        </form>
      </Card>

      <Card title="Reset to default">
        <p className="text-sm text-slate-400 leading-relaxed">
          Restore the default admin password at any time. All other admin sessions are signed out; this one stays signed in.
        </p>
        <button
          type="button"
          disabled={!session.custom || busy}
          onClick={() => setResetOpen(true)}
          className="mt-4 w-full h-11 rounded-xl border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.05] disabled:opacity-40 inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4" /> Reset to default password
        </button>
        <div className="mt-5 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3.5 text-xs text-slate-400 leading-relaxed space-y-1.5">
          <p className="text-slate-300 font-medium">How the console is protected</p>
          <p>Passwords are never stored in readable form. Admin sessions are short, sign out after a period of inactivity, and can't be read by page scripts.</p>
          <p>Repeated wrong passwords lock sign-in for a while. Changing or resetting the password signs out every other admin session.</p>
          <p>Locked out of a custom password? Ask the site owner to reset it; the default password then works again.</p>
        </div>
      </Card>

      <ConfirmDialog
        open={resetOpen}
        title="Reset to the default password?"
        body="Type RESET to confirm. Anyone who knows the default password will be able to sign in."
        confirmLabel="Reset password"
        danger
        busy={busy}
        onConfirm={() => resetText === 'RESET' && reset()}
        onCancel={() => setResetOpen(false)}
      >
        <input
          value={resetText}
          onChange={e => setResetText(e.target.value)}
          aria-label="Type RESET"
          placeholder="RESET"
          className="mt-4 w-full h-11 px-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none text-sm text-white font-mono"
        />
      </ConfirmDialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
export default function AdminApp() {
  const [state, setState] = useState<'checking' | 'signedOut' | 'signedIn'>('checking');
  const [session, setSession] = useState<{ custom: boolean; updatedAt: number | null }>({ custom: false, updatedAt: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(() => {
    const h = window.location.hash.replace('#', '') as Section;
    return NAV.some(n => n.id === h) ? h : 'overview';
  });
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastActive = useRef(Date.now());

  const loadSession = useCallback(async () => {
    try {
      const s = await apiFetch<any>('/api/admin/session');
      setSession({ custom: !!s.custom, updatedAt: s.updatedAt || null });
      setState('signedIn');
    } catch {
      setState('signedOut');
    }
  }, []);

  useEffect(() => {
    document.title = 'MarketX Admin';
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');
    loadSession();
  }, [loadSession]);

  const signOut = useCallback(async (why?: string) => {
    await apiFetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setNotice(why || null);
    setState('signedOut');
  }, []);

  // Any 401 from a section means the session ended
  useEffect(() => {
    const on401 = () => {
      setNotice('Your admin session ended. Sign in again.');
      setState('signedOut');
    };
    window.addEventListener('mx-admin-401', on401);
    return () => window.removeEventListener('mx-admin-401', on401);
  }, []);

  // Idle lock
  useEffect(() => {
    if (state !== 'signedIn') return;
    const bump = () => (lastActive.current = Date.now());
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach(e => window.addEventListener(e, bump, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - lastActive.current > IDLE_LOCK_MS) signOut('Locked after 30 minutes of inactivity.');
    }, 60000);
    return () => {
      events.forEach(e => window.removeEventListener(e, bump));
      clearInterval(id);
    };
  }, [state, signOut]);

  const go = (s: Section) => {
    setSection(s);
    window.history.replaceState(null, '', `/admin#${s}`);
    window.scrollTo({ top: 0 });
  };

  if (state === 'checking') {
    return (
      <div className="mx-backdrop min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
      </div>
    );
  }
  if (state === 'signedOut') {
    return (
      <AdminLogin
        notice={notice}
        onSignedIn={() => {
          setNotice(null);
          lastActive.current = Date.now();
          loadSession();
        }}
      />
    );
  }

  const current = NAV.find(n => n.id === section)!;

  return (
    <div className="mx-backdrop min-h-[100dvh] text-slate-100 lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-60 shrink-0 h-[100dvh] sticky top-0 border-r border-white/[0.06] bg-[var(--mx-bg-2)] p-4">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <MarketXIcon size="sm" />
          <MarketXText className="text-[17px]" />
          <span className="ml-auto h-5 px-1.5 rounded-full bg-white/[0.06] text-[10px] font-medium text-slate-400 inline-flex items-center">Admin</span>
        </div>
        <nav className="mt-6 space-y-1" aria-label="Admin sections">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`w-full h-10 px-3 rounded-xl flex items-center gap-3 text-sm transition-colors cursor-pointer ${
                section === id ? 'bg-white/[0.08] text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={() => signOut()} className="mt-auto h-10 px-3 rounded-xl flex items-center gap-3 text-sm text-slate-400 hover:text-white hover:bg-white/[0.04] cursor-pointer">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Mobile top bar + tabs */}
        <div className="lg:hidden sticky top-0 z-30 bg-[var(--mx-bg)]/90 backdrop-blur border-b border-white/[0.06] pt-safe">
          <div className="flex items-center justify-between px-4 h-12">
            <div className="flex items-center gap-2">
              <MarketXIcon size="sm" />
              <span className="text-sm font-semibold text-white">Admin</span>
            </div>
            <button type="button" onClick={() => signOut()} aria-label="Sign out" className="w-9 h-9 rounded-full text-slate-400 hover:text-white inline-flex items-center justify-center cursor-pointer">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <nav className="flex gap-1 px-3 pb-2 overflow-x-auto no-scrollbar" aria-label="Admin sections">
            {NAV.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                aria-current={section === id ? 'page' : undefined}
                className={`h-9 px-3 rounded-full text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                  section === id ? 'bg-white text-slate-950' : 'text-slate-400 bg-white/[0.04]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </nav>
        </div>

        <main className="px-4 sm:px-6 lg:px-8 py-5 lg:py-8 max-w-[1280px] mx-auto">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">{current.label}</h1>
              <p className="text-xs text-slate-500 mt-0.5">MarketX admin console</p>
            </div>
            {section !== 'security' && section !== 'broadcast' && (
              <button
                type="button"
                onClick={() => setRefreshKey(k => k + 1)}
                className="h-9 px-3 rounded-full border border-white/[0.08] text-xs text-slate-300 hover:bg-white/[0.05] inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </button>
            )}
          </div>

          <div key={`${section}-${refreshKey}`} className="mx-fade-in">
            {section === 'overview' && <Overview />}
            {section === 'users' && (
              <UsersSection
                onMessage={target => {
                  setMessageTarget(target);
                  go('broadcast');
                }}
              />
            )}
            {section === 'usage' && <UsageSection />}
            {section === 'matt' && <MattAdminSection />}
            {section === 'fundamental' && <FundamentalAdminSection />}
            {section === 'subscriptions' && <SubscriptionsSection />}
            {section === 'campaign' && <CampaignSection />}
            {section === 'support' && <SupportSection />}
            {section === 'broadcast' && <BroadcastSection initialTarget={messageTarget} />}
            {section === 'security' && <SecuritySection session={session} onChanged={loadSession} />}
          </div>
        </main>
      </div>
    </div>
  );
}
