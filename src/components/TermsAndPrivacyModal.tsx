import React, { useEffect, useRef, useState } from 'react';
import { FileText, Lock, AlertTriangle, X, Mail, MessageCircle } from 'lucide-react';
import { TelegramIcon, YouTubeIcon } from './SocialIcons';
import { MARKETX_TELEGRAM_URL, MARKETX_YOUTUBE_URL } from '../utils/campaign';

type Tab = 'terms' | 'privacy' | 'risk';

interface TermsAndPrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: Tab;
}

const LAST_UPDATED = 'September 2026';

const TABS: Array<{ id: Tab; label: string; short: string; icon: React.ElementType }> = [
  { id: 'terms', label: 'Terms of Service', short: 'Terms', icon: FileText },
  { id: 'privacy', label: 'Privacy Policy', short: 'Privacy', icon: Lock },
  { id: 'risk', label: 'Risk Disclosure', short: 'Risk', icon: AlertTriangle },
];

type Doc = { summary: string; tone: 'indigo' | 'emerald' | 'amber'; sections: Array<{ title: string; body: React.ReactNode }> };

const DOCS: Record<Tab, Doc> = {
  terms: {
    tone: 'indigo',
    summary:
      'MarketX is a Super Intelligence (SI) market-analysis tool built and operated by SpiriTech Labs. Use it fairly, keep your account secure, and remember that analyses are research, not advice.',
    sections: [
      {
        title: 'Using MarketX',
        body: 'MarketX provides market analysis, trade-planning tools and related features. Access is invite-only: an account is created once a valid pass code is redeemed. You must provide accurate information and keep your login details private.',
      },
      {
        title: 'Credits, plans & payments',
        body: 'Analyses use a daily allowance that refills every day at 3:00 AM, with no rollover; when it is used up, new analyses pause until the refill, except that credits earned through campaigns stay usable until spent. One credit pays for one analysis; the token count shown on each analysis varies from run to run (about 18.5k to 41.5k, 30k on average) and is informational, not a separate charge. Pro plans are billed through Paystack and activate only after the payment is verified. Credits earned through campaigns are granted after their verification window.',
      },
      {
        title: 'Acceptable use',
        body: 'Do not reverse-engineer, scrape, overload or attempt to access parts of the service you are not authorised to use. Accounts involved in abuse, fraud or automated misuse may be suspended or closed.',
      },
      {
        title: 'Intellectual property',
        body: 'The MarketX software, design, analysis engine and content are the property of SpiriTech Labs. You may share your own analysis results, with attribution to MarketX.',
      },
      {
        title: 'Changes & availability',
        body: 'We continuously improve MarketX, so features and methods may change. We aim for high availability but cannot guarantee uninterrupted service or live data from third-party providers.',
      },
    ],
  },
  privacy: {
    tone: 'emerald',
    summary: 'We collect only what is needed to run your account and the service. We never sell your data, and we never see or store your card details.',
    sections: [
      {
        title: 'What we collect',
        body: 'Your email address, username, display name and optional profile photo; your credits, plan and payment records; your saved chats and trade setups; support conversations; your questions to Matt and its replies, and your Fundamental Analysis reads (kept for 90 days to keep the service safe and improve it, seen only by the MarketX team); basic usage information (such as analyses run and sign-in activity) used to operate and secure the service; and, when you sign up, your IP address and device identifiers, used only to enforce one account per person and prevent abuse.',
      },
      {
        title: 'How it is stored',
        body: 'Account data is stored on secure cloud servers and is only accessed through the MarketX server, never directly from your browser. All traffic is encrypted with TLS. Passwords are stored as one-way hashes.',
      },
      {
        title: 'Voice input',
        body: 'When you use the mic, your words are written down on your device by your browser, or, where the browser cannot do it, a short recording is sent once to MarketX to be written down. Recordings are never stored or kept; only the words you send are used, exactly like a typed message. When you talk with Matt, his replies are turned into speech on our servers and played straight back to you; the audio is not stored. Your browser asks your permission before the mic is used, and you can turn it off at any time in its settings.',
      },
      {
        title: 'Cookies',
        body: 'We use a single secure, httpOnly session cookie to keep you signed in. Your theme preference is kept in your browser. We do not use advertising trackers.',
      },
      {
        title: 'Third parties',
        body: 'Payments are processed by Paystack (we never receive card numbers). Google Sign-In is used only if you choose it. Emails are sent through our mail provider. Market prices come from public data providers.',
      },
      {
        title: 'Your choices',
        body: 'You can clear your chat history at any time, change your email preferences, and permanently delete your account and its data from Settings → Profile. To keep one-time rewards fair, a one-way hash of your email is kept after deletion so a campaign cannot be claimed twice. For any privacy request, message us from Support chat or by email.',
      },
    ],
  },
  risk: {
    tone: 'amber',
    summary:
      'Trading forex, crypto, commodities, indices and stocks carries a high risk of losing money. MarketX analyses are educational research tools, not financial advice.',
    sections: [
      {
        title: 'Not financial advice',
        body: 'Levels, signals, trade plans and commentary are produced by quantitative models and Super Intelligence (SI) for research and educational purposes. Nothing on MarketX is investment advice or an offer to buy or sell any asset.',
      },
      {
        title: 'Your responsibility',
        body: 'You alone decide whether to trade and how much to risk. Use proper position sizing and stop losses, never trade money you cannot afford to lose, and consider independent professional advice.',
      },
      {
        title: 'No guarantees',
        body: 'Past performance and historical levels do not guarantee future results. Market data can be delayed or incomplete, and volatility, gaps and slippage can move prices past planned levels.',
      },
      {
        title: 'Limitation of liability',
        body: 'SpiriTech Labs, MarketX and its contributors are not liable for trading losses, missed profits or other damages arising from the use of the service, to the fullest extent permitted by law.',
      },
    ],
  },
};

const TONE: Record<Doc['tone'], string> = {
  indigo: 'bg-indigo-500/[0.08] border-indigo-400/20 text-indigo-100',
  emerald: 'bg-emerald-500/[0.08] border-emerald-400/20 text-emerald-100',
  amber: 'bg-amber-500/[0.08] border-amber-400/20 text-amber-100',
};

export const TermsAndPrivacyModal: React.FC<TermsAndPrivacyModalProps> = ({ isOpen, onClose, defaultTab = 'terms' }) => {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Open on the requested tab each time
  useEffect(() => {
    if (isOpen) setTab(defaultTab);
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [tab]);

  if (!isOpen) return null;
  const doc = DOCS[tab];
  const activeIndex = TABS.findIndex(t => t.id === tab);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-5" role="dialog" aria-modal="true" aria-label="Terms and Privacy">
      <div onClick={onClose} className="mx-fade-in fixed inset-0 bg-black/75" />

      <div className="mx-pop-in relative z-10 w-full sm:max-w-2xl h-[92dvh] sm:h-auto sm:max-h-[86dvh] flex flex-col bg-[var(--mx-bg-2)] border border-white/[0.08] rounded-t-[28px] sm:rounded-[28px] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Header */}
        <header className="shrink-0 px-5 sm:px-7 pt-5 sm:pt-6 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">Legal</p>
              <h2 className="mt-1 text-xl sm:text-2xl font-semibold text-white tracking-tight">Terms &amp; Privacy</h2>
              <p className="mt-1 text-xs text-slate-500">Last updated {LAST_UPDATED}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 -mr-1 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Segmented tabs */}
          <div className="relative mt-5 grid grid-cols-3 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06]" role="tablist" aria-label="Documents">
            <span
              aria-hidden="true"
              className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-white shadow-sm transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
              style={{ transform: `translateX(${activeIndex * 100}%)` }}
            />
            {TABS.map(({ id, label, short, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`relative z-10 h-9 rounded-xl text-xs sm:text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  tab === id ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>
        </header>

        {/* Document */}
        <div ref={bodyRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7 pb-6" role="tabpanel">
          <div className={`rounded-2xl border px-4 py-3.5 text-sm leading-relaxed ${TONE[doc.tone]}`}>
            <span className="font-semibold">In short: </span>
            {doc.summary}
          </div>

          <ol className="mt-5 space-y-5">
            {doc.sections.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[1.75rem_1fr] gap-3">
                <span className="mt-0.5 w-7 h-7 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] font-semibold text-slate-300 flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-white">{s.title}</h3>
                  <p className="mt-1 text-sm text-slate-400 leading-relaxed">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Footer */}
        <footer className="shrink-0 border-t border-white/[0.06] px-5 sm:px-7 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            MarketX · Built by <span className="text-slate-300 font-medium">SpiriTech Labs</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <MessageCircle className="w-3.5 h-3.5" /> Questions? Settings → Support chat
            </span>
            <a href="mailto:help.marketx@gmail.com?subject=MarketX%20Support" className="inline-flex items-center gap-1 hover:text-white transition-colors">
              <Mail className="w-3.5 h-3.5" /> Email
            </a>
            <a href="https://x.com/_MarketX" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              @_MarketX
            </a>
            <a href={MARKETX_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white transition-colors">
              <TelegramIcon className="w-3.5 h-3.5" /> Telegram
            </a>
            <a href={MARKETX_YOUTUBE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white transition-colors">
              <YouTubeIcon className="w-3.5 h-3.5" /> YouTube
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
};
