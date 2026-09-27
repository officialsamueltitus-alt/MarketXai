import React from 'react';
import { Mail, ArrowUpRight, Headphones, LineChart, CreditCard, Plug, Clock } from 'lucide-react';

interface InstitutionalMailSupportProps {
  className?: string;
}

const TOPICS = [
  { icon: LineChart, label: 'Setups & signals' },
  { icon: CreditCard, label: 'Billing & plans' },
  { icon: Plug, label: 'Integrations' },
];

export const InstitutionalMailSupport: React.FC<InstitutionalMailSupportProps> = ({ className = '' }) => {
  const supportEmail = 'help.marketx@gmail.com';
  const xHandleUrl = 'https://x.com/_MarketXai';
  const mailtoLink = `mailto:${supportEmail}?subject=MarketX%20Support%20Request&body=Hello%20MarketX%20Team%2C%0A%0AMy%20username%3A%20%0AHow%20can%20you%20help%3A%20%0A%0AThank%20you.`;

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[#111114] p-5 sm:p-7 ${className}`}
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
            Questions about a setup, your account, billing or a custom integration? Our desk answers every message
            personally.
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

        <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 md:w-60 shrink-0">
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
            Message @_MarketXai
          </a>
        </div>
      </div>
    </section>
  );
};
