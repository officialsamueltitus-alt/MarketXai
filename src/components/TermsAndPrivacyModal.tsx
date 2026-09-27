import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ShieldCheck,
  FileText,
  Lock,
  AlertTriangle,
  X,
  ExternalLink,
  Mail,
  CheckCircle2,
  Cpu
} from 'lucide-react';

interface TermsAndPrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'terms' | 'privacy' | 'risk';
}

export const TermsAndPrivacyModal: React.FC<TermsAndPrivacyModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'terms',
}) => {
  const [activeTab, setActiveTab] = useState<'terms' | 'privacy' | 'risk'>(defaultTab);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md"
      />

      {/* Modal Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-[#111114]/95 border border-white/[0.14] rounded-2xl sm:rounded-3xl shadow-2xl shadow-black overflow-hidden z-10"
      >
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-gradient-to-r from-indigo-950/40 via-transparent to-transparent shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Terms & Privacy Policy
              </h2>
              <p className="text-xs text-slate-400">
                Institutional protocol governance & privacy standards • Built by SpiriTech Labs
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 sm:p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-4 sm:px-6 py-2.5 border-b border-white/[0.06] flex items-center gap-2 bg-black/30 shrink-0">
          {[
            { id: 'terms', label: 'Terms of Service', icon: FileText },
            { id: 'privacy', label: 'Privacy Policy', icon: Lock },
            { id: 'risk', label: 'Trading Risk Disclosure', icon: AlertTriangle },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600/35 text-white border border-indigo-500/40 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Document Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 text-slate-300 text-xs sm:text-sm space-y-5 leading-relaxed">
          {activeTab === 'terms' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-200">
                <span className="font-bold">MarketX Protocol Notice:</span> This platform, proprietary algorithmic tools, and quantitative models are engineered and operated by <span className="font-semibold text-white">SpiriTech Labs</span>. By accessing MarketX, you agree to these Terms.
              </div>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">1. Platform Scope & Intellectual Property</h3>
                <p className="text-slate-400">
                  MarketX provides high-fidelity institutional market intelligence, quantitative order flow mapping, and mathematical Fibonacci confluence engines. All proprietary algorithms, visualizers, software interfaces, and predictive logic are exclusive intellectual property of <strong className="text-slate-200">SpiriTech Labs</strong>.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">2. AI Analysis Credits & Promotional Campaigns</h3>
                <p className="text-slate-400">
                  MarketX users receive daily refreshed credits and may participate in verified community campaigns (such as sharing verified profiles on X) to earn additional credits. Campaign awards are subject to automated verification windows (e.g., 10-hour processing) operated by SpiriTech Labs.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">3. Acceptable Use & Fair Access</h3>
                <p className="text-slate-400">
                  You agree not to reverse engineer, scrape at abusive frequencies, or exploit the platform's backend endpoints. SpiriTech Labs reserves the right to rate-limit or terminate access for unauthorized automated bot activity.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">4. Modifications to Services</h3>
                <p className="text-slate-400">
                  SpiriTech Labs continuously evolves the MarketX engine. Features, parameters, and algorithms may update to incorporate advanced quantitative datasets.
                </p>
              </section>
            </div>
          )}

          {activeTab === 'privacy' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-200">
                <span className="font-bold">Privacy Commitment:</span> SpiriTech Labs maintains a privacy-first, non-custodial architecture. We do not sell your personal data or trade execution logs.
              </div>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">1. Information We Collect</h3>
                <p className="text-slate-400">
                  MarketX operates with minimal data collection. We retain local browser preferences (session history, saved trade signals), custom display usernames, and trader email addresses strictly for automated campaign reward dispatches.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">2. Data Storage & Security</h3>
                <p className="text-slate-400">
                  Client sessions and saved strategy signals are stored with client-side isolation in secure browser storage. All network interactions are encrypted via modern TLS cryptographic protocols maintained by SpiriTech Labs.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">3. Third-Party Integrations</h3>
                <p className="text-slate-400">
                  When participating in the X Profile Share campaign, external interactions adhere to X’s privacy terms. Market price feeds are ingested via certified public ticker endpoints.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">4. Data Deletion & Inquiries</h3>
                <p className="text-slate-400">
                  Traders may clear all saved conversation records and cached history at any moment via the History tab. For privacy queries, reach out directly to the SpiriTech Labs support desk.
                </p>
              </section>
            </div>
          )}

          {activeTab === 'risk' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                <span className="font-bold">High-Risk Warning:</span> Trading digital assets, cryptocurrencies, foreign currencies, and equities involves significant capital risk and potential total loss of funds.
              </div>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">1. Not Financial or Investment Advice</h3>
                <p className="text-slate-400">
                  The outputs, confluence zones, Fibonacci pocket calculations, and trade plans provided by MarketX and SpiriTech Labs are purely quantitative research tools intended for educational and analytical purposes. Nothing on this platform constitutes personal investment advice, financial endorsement, or an offer to buy or sell securities.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">2. User Responsibility & Risk Management</h3>
                <p className="text-slate-400">
                  You are solely responsible for your trading decisions and capital exposure. Always employ prudent position sizing, strict stop losses, and consult certified independent financial advisors.
                </p>
              </section>

              <section className="space-y-1.5">
                <h3 className="font-bold text-white text-sm">3. Limitation of Liability</h3>
                <p className="text-slate-400">
                  Under no circumstances will SpiriTech Labs, MarketX, or its contributors be held liable for any trading losses, missed profits, or slippage resulting from market volatility or platform usage.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Modal Footer with Built by SpiriTech Labs */}
        <div className="p-4 border-t border-white/[0.08] bg-black/40 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[10px] font-mono font-bold">
              SL
            </div>
            <span className="text-white font-semibold">
              Built by SpiriTech Labs
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono">
            <a
              href="mailto:help.marketx@gmail.com?subject=MarketX%20Support%20Request"
              className="text-slate-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
            >
              <Mail className="w-3 h-3" />
              <span>Message Support via Mail</span>
            </a>
            <span>•</span>
            <a
              href="https://x.com/_MarketXai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-white transition-colors"
            >
              @_MarketXai
            </a>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
