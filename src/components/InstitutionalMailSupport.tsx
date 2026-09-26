import React from 'react';
import { Mail, ExternalLink, ShieldCheck } from 'lucide-react';

interface InstitutionalMailSupportProps {
  className?: string;
}

export const InstitutionalMailSupport: React.FC<InstitutionalMailSupportProps> = ({
  className = '',
}) => {
  const supportEmail = 'help.marketx@gmail.com';
  const xHandleUrl = 'https://x.com/_MarketXai';

  const mailtoLink = `mailto:${supportEmail}?subject=MarketX%20Institutional%20Support%20Request&body=Hello%20MarketX%20Team%2C%0A%0AMy%20Username%3A%20%0AIssue%20%2F%20Inquiry%20Details%3A%20%0A%0AThank%20you.`;

  return (
    <div
      className={`rounded-3xl bg-gradient-to-b from-slate-950/90 via-[#0a0d1a]/95 to-black/90 border border-white/[0.12] p-4 sm:p-6 shadow-2xl relative overflow-hidden ${className}`}
    >
      {/* Ambient background glow */}
      <div className="absolute top-0 right-1/4 w-72 h-72 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        {/* Left Info */}
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2.5 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] sm:text-xs font-mono font-semibold border border-indigo-500/30 flex items-center gap-1">
              <Mail className="w-3 h-3 text-cyan-400" />
              Direct Institutional Desk
            </span>
            <span className="text-[11px] text-slate-400 font-mono">
              Average response: &lt; 2 hours
            </span>
          </div>

          <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Need Support or Have Inquiries?
          </h3>

          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
            Our algorithmic specialists assist with institutional supply/demand setups, 0.618 golden pocket parameters, account billing, and custom integrations. Click below to message our direct support desk.
          </p>

          {/* Institutional badge & X handle (email address hidden) */}
          <div className="pt-1 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.1] text-xs font-mono text-slate-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Priority Response Channel</span>
            </div>

            <a
              href={xHandleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] text-xs font-mono text-slate-300 hover:text-white transition-all"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span>@_MarketXai</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          </div>
        </div>

        {/* Right CTA Button */}
        <div className="flex flex-col sm:flex-row md:flex-col gap-2 w-full md:w-auto shrink-0">
          <a
            href={mailtoLink}
            className="px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white font-bold text-xs sm:text-sm shadow-xl shadow-indigo-950/80 hover:shadow-indigo-900/90 transition-all hover:scale-105 active:scale-95 flex items-center justify-center gap-2 cursor-pointer text-center"
          >
            <Mail className="w-4 h-4" />
            <span>Message Support via Mail</span>
          </a>
        </div>
      </div>
    </div>
  );
};
