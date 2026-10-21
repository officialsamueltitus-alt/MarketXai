import React from 'react';
import { Mail, ArrowUpRight, Headphones, LineChart, CreditCard, Plug, Clock, MessageCircle, BookOpen, ArrowRight } from 'lucide-react';
import { TelegramIcon, YouTubeIcon } from './SocialIcons';
import { MARKETX_TELEGRAM_URL, MARKETX_YOUTUBE_URL } from '../utils/campaign';

interface InstitutionalMailSupportProps {
  className?: string;
  /** Opens the in-app support chat (signed-out visitors are asked to sign in first) */
  onOpenSupport?: () => void;
  supportUnread?: number;
}

const TOPICS = [
  { icon: LineChart, label: 'Setups & signals' },
  { icon: CreditCard, label: 'Billing & plans' },
  { icon: Plug, label: 'Integrations' },
];

export const InstitutionalMailSupport: React.FC<InstitutionalMailSupportProps> = ({ className = '', onOpenSupport, supportUnread = 0 }) => {
  const supportEmail = 'help.marketx@gmail.com';
  const xHandleUrl = 'https://x.com/_MarketX';
  const mailtoLink = `mailto:${supportEmail}?subject=MarketX%20Support%20Request&body=Hello%20MarketX%20Team%2C%0A%0AMy%20username%3A%20%0AHow%20can%20you%20help%3A%20%0A%0AThank%20you.`;

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5 sm:p-7 ${className}`}
      aria-label="Direct institutional desk"
    >
      <div className="pointer-events-none absolute -bottom-24 -left-10 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -top-24 right-0 w-72 h-72 rounded-full bg-indigo-600/10 blur-3xl" aria-hidden="true" />

      <div className="relative flex flex-col md:flex-row md:items-center gap-6 md:gap-10">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/[0.05] text-xs font-medium text-slate-300">
              <Headphones className="w-3.5 h-3.5 text-indigo-300" /> Direct institutional desk
            </span>
            <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-emerald-500/10 text-xs font-medium text-emerald-300">
              <Clock className="w-3.5 h-3.5" /> Replies in under 2 hours
            </span>
          </div>

          <h3 className="mt-4 text-xl sm:text-2xl font-semibold text-white tracking-tight">Talk to a real specialist</h3>
          <p className="mt-2 text-sm text-slate-400 max-w-xl leading-relaxed">
            Questions about a setup, your account, billing or a custom integration? Chat with the desk in the app, or email us.
            We answer every message personally.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {TOPICS.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-white/[0.07] bg-white/[0.02] text-[13px] text-slate-300"
              >
                <Icon className="w-3.5 h-3.5 text-slate-500" /> {label}
              </span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2.5 md:w-60 shrink-0">
          {onOpenSupport && (
            <button
              type="button"
              onClick={onOpenSupport}
              className="relative h-12 px-5 rounded-2xl bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-400 active:scale-[0.98] transition inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <MessageCircle className="w-4 h-4" />
              Open support chat
              {supportUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-[11px] font-semibold text-white inline-flex items-center justify-center tabular-nums">
                  {supportUnread > 9 ? '9+' : supportUnread}
                </span>
              )}
            </button>
          )}
          <a
            href={mailtoLink}
            className="group h-12 px-5 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 active:scale-[0.98] transition inline-flex items-center justify-center gap-2"
          >
            <Mail className="w-4 h-4" />
            Email the desk
            <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
          <a
            href={xHandleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-12 px-5 rounded-2xl border border-white/[0.1] text-slate-200 text-sm font-medium hover:bg-white/[0.05] hover:border-white/[0.18] transition inline-flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Message @_MarketX
          </a>
          <a
            href={MARKETX_TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="h-12 px-5 rounded-2xl border border-[#2AABEE]/30 bg-[#2AABEE]/[0.08] text-slate-100 text-sm font-medium hover:bg-[#2AABEE]/[0.14] hover:border-[#2AABEE]/50 transition inline-flex items-center justify-center gap-2"
          >
            <TelegramIcon className="w-[18px] h-[18px]" />
            Join our Telegram
          </a>
          <a
            href={MARKETX_YOUTUBE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="h-12 px-5 rounded-2xl border border-[#FF0033]/30 bg-[#FF0033]/[0.07] text-slate-100 text-sm font-medium hover:bg-[#FF0033]/[0.13] hover:border-[#FF0033]/50 transition inline-flex items-center justify-center gap-2"
          >
            <YouTubeIcon className="w-[18px] h-[18px]" />
            Watch on YouTube
          </a>
        </div>
      </div>

      {/* Site guide: opens the full guide as its own page (/blog) */}
      <a
        href="/blog"
        className="group relative mt-6 flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5 hover:bg-white/[0.06] hover:border-white/[0.14] transition"
      >
        <span className="w-11 h-11 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
          <BookOpen className="w-5 h-5 text-indigo-300" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-white">MarketX Site Guide</span>
          <span className="block mt-0.5 text-[13px] text-slate-400 leading-snug">
            Everything in one place: getting started, running an analysis, reading results, credits, sharing and support.
          </span>
        </span>
        <span className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-medium text-indigo-300 shrink-0">
          Read the guide <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
        </span>
        <ArrowRight className="sm:hidden w-4 h-4 text-indigo-300 shrink-0" />
      </a>
    </section>
  );
};
