import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Camera,
  CheckCircle2,
  Clock,
  Coins,
  Compass,
  Lightbulb,
  Link2,
  Loader2,
  PenLine,
  Send,
  ShieldCheck,
  Sparkles,
  Video,
  XCircle,
} from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { apiFetch } from '../utils/apiClient';

// The "Explain MarketX" campaign page, served standalone at /campaigns/explain-marketx.
// Rewards are never automatic: every post is reviewed by the MarketX team before credits are added.

interface CampaignInfo {
  id: string;
  title: string;
  reward: number;
  handle: string;
  endsAt: number;
  open: boolean;
}

interface Submission {
  postUrl: string;
  format: 'video' | 'writeup';
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
  creditsAwarded: number;
  canResubmit: boolean;
}

const FALLBACK: CampaignInfo = {
  id: 'explain-marketx',
  title: 'Explain MarketX',
  reward: 50,
  handle: '@_MarketX',
  endsAt: Date.parse('2026-10-30T23:59:59+01:00'),
  open: Date.now() <= Date.parse('2026-10-30T23:59:59+01:00'),
};

const IDEAS = [
  {
    icon: Compass,
    title: 'How you understand MarketX',
    text: 'In your own words: what MarketX does, who it is for, and how it fits into the way you trade.',
  },
  {
    icon: Sparkles,
    title: 'A feature you use',
    text: 'Walk through one feature, such as reading a trade card, rechecking zones, uploading a chart or picking a timeframe.',
  },
  {
    icon: Lightbulb,
    title: 'Something you just discovered',
    text: 'A detail that surprised you or changed how you use the site. Small discoveries make great posts.',
  },
];

const RULES = [
  'Your own original video or writing. Reposts, copied text and machine-written filler are declined.',
  `The post is public on X and tags ${FALLBACK.handle}.`,
  'Videos run about 1 minute. Write ups explain clearly and include at least one screenshot of MarketX.',
  'Keep the post up until it has been reviewed.',
  'Never show private details on screen: your email, pass code, payment details or anyone else’s account.',
  'No profit promises. MarketX analyses are not financial advice, so present them that way.',
  'One reward per person. The MarketX team makes the final decision on every post.',
];

const FAQ = [
  {
    q: 'When do I get my credits?',
    a: 'After we review your post. Every submission is checked by hand; once it is approved, 50 credits are added and you get a notification and an email.',
  },
  {
    q: 'What if my post is not approved?',
    a: 'You will see the reason here and in your notifications. You can publish a new post and submit its link any time before the campaign ends.',
  },
  {
    q: 'What are campaign credits?',
    a: 'They work like normal credits, one per analysis, and keep working even after your daily analyses run out, until you use them up.',
  },
];

const fmtDeadline = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

function countdown(ts: number, now: number): string {
  const ms = ts - now;
  if (ms <= 0) return 'Ended';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${Math.max(1, m)}m left`;
}

const POST_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/\d{5,25}(?:[/?#]\S*)?$/i;

export default function ExplainCampaignPage() {
  const [campaign, setCampaign] = useState<CampaignInfo>(FALLBACK);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [now, setNow] = useState(Date.now());
  const [format, setFormat] = useState<'video' | 'writeup'>('video');
  const [postUrl, setPostUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Explain MarketX · Campaign';
    return () => {
      document.title = prev;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    apiFetch<{ campaign: CampaignInfo; submission: Submission | null }>('/api/campaigns/explain-marketx/me')
      .then(d => {
        if (!alive) return;
        setCampaign(d.campaign);
        setSubmission(d.submission);
        setSignedIn(true);
      })
      .catch(() => {
        if (!alive) return;
        setSignedIn(false);
        apiFetch<{ campaign: CampaignInfo }>('/api/campaigns/explain-marketx')
          .then(d => alive && setCampaign(d.campaign))
          .catch(() => {});
      });
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const open = campaign.open && now <= campaign.endsAt;
  const linkOk = POST_RE.test(postUrl.trim());
  const showForm = open && signedIn && (!submission || (submission.status === 'rejected' && submission.canResubmit) || (submission.status === 'pending' && editing));

  const intentUrl = useMemo(() => {
    const text = `Here is how I use ${campaign.handle} to plan my trades 👇\n\n`;
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  }, [campaign.handle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch<{ submission: Submission }>('/api/campaigns/explain-marketx/submit', {
        method: 'POST',
        body: JSON.stringify({ postUrl: postUrl.trim(), format, note }),
      });
      setSubmission(d.submission);
      setEditing(false);
      setPostUrl('');
      setNote('');
    } catch (err: any) {
      setError(err?.message || 'Could not submit. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-backdrop min-h-[100dvh] text-slate-200 overflow-x-clip">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[var(--mx-bg)] pt-[env(safe-area-inset-top)]">
        <div className="max-w-5xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-slate-200 hover:bg-white/[0.07] hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to MarketX</span>
            <span className="sm:hidden">Back</span>
          </a>
          <span className="inline-flex items-center gap-2 min-w-0">
            <MarketXIcon size="sm" />
            <span className="text-sm font-semibold text-white truncate">MarketX Campaigns</span>
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 pb-20">
        {/* Hero */}
        <section className="relative mt-6 sm:mt-10 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] px-5 py-8 sm:px-10 sm:py-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_0%,rgba(139,92,246,0.35),transparent_55%),radial-gradient(80%_120%_at_100%_0%,rgba(56,189,248,0.25),transparent_55%),radial-gradient(60%_80%_at_50%_120%,rgba(16,185,129,0.18),transparent_60%)]"
          />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/[0.08] border border-white/[0.1] text-xs font-medium text-white">
                <Sparkles className="w-3.5 h-3.5 text-violet-300" /> Community campaign
              </span>
              <span
                className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full text-xs font-medium ${
                  open ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/20' : 'bg-white/[0.06] text-slate-300 border border-white/[0.08]'
                }`}
              >
                <Clock className="w-3.5 h-3.5" /> {open ? `Open until ${fmtDeadline(campaign.endsAt)}` : `Ended ${fmtDeadline(campaign.endsAt)}`}
              </span>
            </div>
            <h1 className="mt-5 text-4xl sm:text-6xl font-bold tracking-tight text-white leading-[1.05]">
              Explain <span className="bg-gradient-to-r from-violet-300 via-sky-300 to-emerald-300 bg-clip-text text-transparent">MarketX</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base sm:text-lg text-slate-300 leading-relaxed">
              Show the community how you see MarketX. Make a one minute video or a clear write up with screenshots, post it on X and tag{' '}
              <span className="text-white font-semibold">{campaign.handle}</span>. Once our team approves it, you earn{' '}
              <span className="text-white font-semibold">{campaign.reward} credits</span>.
            </p>

            <dl className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: Coins, label: 'Reward', value: `${campaign.reward} credits`, sub: 'After approval' },
                { icon: Video, label: 'Format', value: '1 min video or write up', sub: 'Write ups include screenshots' },
                { icon: Clock, label: 'Time left', value: countdown(campaign.endsAt, now), sub: `Ends ${fmtDeadline(campaign.endsAt)}` },
              ].map(s => (
                <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3.5 min-w-0">
                  <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400">
                    <s.icon className="w-3.5 h-3.5" /> {s.label}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-white">{s.value}</dd>
                  <dd className="text-xs text-slate-500">{s.sub}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-7 flex flex-wrap gap-2.5">
              <a
                href="#submit"
                className="h-11 px-5 rounded-full bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition inline-flex items-center gap-2"
              >
                <Send className="w-4 h-4" /> Submit your post
              </a>
              <a
                href={intentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="h-11 px-5 rounded-full border border-white/[0.14] bg-white/[0.04] text-sm font-semibold text-white hover:bg-white/[0.08] transition inline-flex items-center gap-2"
              >
                Start a post on X <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>
          </div>
        </section>

        {/* What to talk about */}
        <section className="mt-12">
          <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">What to talk about</h2>
          <p className="mt-1.5 text-sm text-slate-400">Pick one angle and keep it focused. Clear and honest beats long.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {IDEAS.map(i => (
              <article key={i.title} className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5">
                <span className="w-10 h-10 rounded-2xl bg-violet-500/15 text-violet-200 flex items-center justify-center">
                  <i.icon className="w-5 h-5" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-white">{i.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{i.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How to take part */}
        <section className="mt-12">
          <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">How to take part</h2>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Camera, title: 'Create', text: 'Record a video of about 1 minute, or write a detailed explanation with screenshots of MarketX.' },
              { icon: PenLine, title: 'Post on X', text: `Publish it on X and tag ${campaign.handle} so we can find it.` },
              { icon: Link2, title: 'Submit the link', text: 'Paste the link to your post below. You can only submit a post from your own account.' },
              { icon: BadgeCheck, title: 'Get reviewed', text: `We review every post by hand. Once approved, ${campaign.reward} credits are added and you are notified.` },
            ].map((s, i) => (
              <li key={s.title} className="relative rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5">
                <span className="absolute top-4 right-5 text-3xl font-bold text-white/[0.06] tabular-nums">{i + 1}</span>
                <s.icon className="w-5 h-5 text-sky-300" />
                <h3 className="mt-3 text-base font-semibold text-white">{s.title}</h3>
                <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{s.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Submit */}
        <section id="submit" className="mt-12 scroll-mt-20 grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-3xl border border-white/[0.08] bg-[var(--mx-surface)] p-5 sm:p-6">
            <h2 className="text-xl font-semibold text-white tracking-tight">Submit your post</h2>

            {signedIn === null && (
              <p className="mt-4 text-sm text-slate-400 inline-flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading your status…
              </p>
            )}

            {signedIn === false && (
              <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
                <p className="text-sm text-slate-300">Sign in to MarketX to submit your post and track its review.</p>
                <a
                  href="/"
                  className="mt-3 h-10 px-4 rounded-full bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition inline-flex items-center gap-2"
                >
                  Sign in on MarketX <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            )}

            {signedIn && submission && !editing && (
              <div className="mt-4 space-y-3" aria-live="polite">
                <StatusCard submission={submission} reward={campaign.reward} />
                {submission.status === 'pending' && open && (
                  <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-slate-400 hover:text-white underline underline-offset-2 cursor-pointer">
                    Submitted the wrong link? Replace it
                  </button>
                )}
              </div>
            )}

            {signedIn && !open && !submission && <p className="mt-4 text-sm text-slate-400">This campaign has ended. Thank you to everyone who took part.</p>}

            {showForm && (
              <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
                <fieldset>
                  <legend className="text-xs text-slate-400">What did you make?</legend>
                  <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Post format">
                    {(
                      [
                        { v: 'video', label: 'Video', sub: 'About 1 minute', icon: Video },
                        { v: 'writeup', label: 'Write up', sub: 'With screenshots', icon: PenLine },
                      ] as const
                    ).map(o => (
                      <button
                        key={o.v}
                        type="button"
                        role="radio"
                        aria-checked={format === o.v}
                        onClick={() => setFormat(o.v)}
                        className={`rounded-2xl border px-3.5 py-3 text-left flex items-center gap-3 transition cursor-pointer ${
                          format === o.v ? 'border-violet-400/40 bg-violet-500/[0.12] text-white' : 'border-white/[0.08] bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]'
                        }`}
                      >
                        <o.icon className={`w-5 h-5 shrink-0 ${format === o.v ? 'text-violet-300' : 'text-slate-500'}`} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{o.label}</span>
                          <span className="block text-[11px] text-slate-500">{o.sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="block">
                  <span className="text-xs text-slate-400">Link to your post on X</span>
                  <input
                    value={postUrl}
                    onChange={e => setPostUrl(e.target.value)}
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://x.com/yourname/status/1234567890"
                    className="mt-1.5 w-full h-12 rounded-2xl bg-white/[0.03] border border-white/[0.1] focus:border-white/30 focus:outline-none px-4 text-sm text-white placeholder:text-slate-600"
                  />
                  {postUrl.trim() && !linkOk && <span className="mt-1.5 block text-xs text-amber-300">Use the link of a single post, like https://x.com/yourname/status/1234567890.</span>}
                </label>
                <label className="block">
                  <span className="flex justify-between text-xs text-slate-400">
                    <span>Anything we should know? (optional)</span>
                    <span className="tabular-nums">{note.length}/280</span>
                  </span>
                  <textarea
                    value={note}
                    onChange={e => setNote(e.target.value.slice(0, 280))}
                    rows={3}
                    placeholder="For example, which feature you explained."
                    className="mt-1.5 w-full rounded-2xl bg-white/[0.03] border border-white/[0.1] focus:border-white/30 focus:outline-none px-4 py-3 text-sm text-white placeholder:text-slate-600 resize-none"
                  />
                </label>
                {error && (
                  <p className="text-sm text-rose-300" role="alert">
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    disabled={!linkOk || busy}
                    className="h-11 px-5 rounded-full bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition inline-flex items-center gap-2 cursor-pointer"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {submission ? 'Submit new link' : 'Submit for review'}
                  </button>
                  {editing && (
                    <button type="button" onClick={() => setEditing(false)} className="text-sm text-slate-400 hover:text-white cursor-pointer">
                      Cancel
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">Credits are added only after our team reviews and approves your post.</p>
              </form>
            )}
          </div>

          <aside className="lg:col-span-2 rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5 sm:p-6">
            <h2 className="text-base font-semibold text-white inline-flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-300" /> Guidelines
            </h2>
            <ul className="mt-3 space-y-2.5">
              {RULES.map(r => (
                <li key={r} className="flex items-start gap-2.5 text-sm text-slate-400 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-slate-500" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </aside>
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Questions</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {FAQ.map(f => (
              <div key={f.q} className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5">
                <h3 className="text-sm font-semibold text-white">{f.q}</h3>
                <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-12 flex justify-center">
          <a
            href="/"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-white/[0.1] bg-white/[0.03] text-sm font-medium text-slate-200 hover:bg-white/[0.07] hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" /> Return to MarketX
          </a>
        </div>
      </main>
    </div>
  );
}

const StatusCard: React.FC<{ submission: Submission; reward: number }> = ({ submission: s, reward }) => {
  const meta =
    s.status === 'approved'
      ? { icon: CheckCircle2, cls: 'border-emerald-400/25 bg-emerald-500/[0.08]', iconCls: 'text-emerald-300', title: `Approved: +${s.creditsAwarded || reward} credits added` }
      : s.status === 'rejected'
        ? { icon: XCircle, cls: 'border-rose-400/25 bg-rose-500/[0.08]', iconCls: 'text-rose-300', title: 'Not approved' }
        : { icon: Clock, cls: 'border-amber-400/25 bg-amber-500/[0.08]', iconCls: 'text-amber-300', title: 'Submitted, waiting for review' };
  return (
    <div className={`rounded-2xl border p-4 ${meta.cls}`}>
      <div className="flex items-start gap-3">
        <meta.icon className={`w-5 h-5 mt-0.5 shrink-0 ${meta.iconCls}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">{meta.title}</p>
          <p className="mt-1 text-xs text-slate-400">
            {s.format === 'video' ? 'Video' : 'Write up'} · submitted {new Date(s.submittedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
          <a href={s.postUrl} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 break-all">
            {s.postUrl.replace(/^https:\/\//, '')} <ArrowUpRight className="w-3 h-3 shrink-0" />
          </a>
          {s.status === 'pending' && <p className="mt-2 text-xs text-slate-400">We review every post by hand. You will get a notification and an email as soon as it is approved.</p>}
          {s.status === 'approved' && <p className="mt-2 text-xs text-slate-400">Thank you for explaining MarketX. Your campaign credits keep working even after your daily analyses run out.</p>}
          {s.status === 'rejected' && (
            <p className="mt-2 text-xs text-slate-300">
              <span className="text-slate-400">Reason:</span> {s.reviewNote || 'The post did not meet the campaign requirements.'}
              {s.canResubmit ? ' You can post again and submit a new link below.' : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
