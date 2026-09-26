import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';

// Official Anthropic Claude Logo (Authentic Terracotta 12-Spoke Asterisk)
export const ClaudeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 100 100" fill="#D97757" className={className} aria-label="Anthropic Claude">
    <circle cx="50" cy="50" r="21" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(0 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(30 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(60 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(90 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(120 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(150 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(180 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(210 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(240 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(270 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(300 50 50)" />
    <rect x="45.6" y="4" width="8.8" height="46" rx="4.4" transform="rotate(330 50 50)" />
  </svg>
);

// Official OpenAI GPT Logo (Authentic Rosette / Vortex)
export const GptIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-label="OpenAI GPT">
    <path
      d="M22.28 9.82a6 6 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.5-2.9A6.06 6.06 0 0 0 5 4.18a6 6 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 6 6 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A6.06 6.06 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.2 6 6 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.08zm-9.02 12.6a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.59a4.5 4.5 0 0 1-4.5 4.49zm-9.66-4.12a4.47 4.47 0 0 1-.54-3.02l.15.09 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.69a.77.77 0 0 0 .39.67l5.81 3.36-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.85L13.1 8.36 15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.67 8.11v-5.68a.8.8 0 0 0-.41-.67zm2.01-3.02l-.14-.09-4.78-2.78a.78.78 0 0 0-.78 0L9.4 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.3 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.4.68v6.72zm1.1-2.36l2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5z"
      fill="#10A37F"
    />
  </svg>
);

// Official xAI Grok Logo (Authentic Geometric Slash-X)
export const GrokIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" fill="none" className={className} aria-label="xAI Grok">
    <path
      d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      fill="#F8FAFC"
    />
    <circle cx="12" cy="12" r="2.2" fill="#38BDF8" />
  </svg>
);

interface ModelSelectorButtonProps {
  onNotifyComingSoon?: (modelName: string) => void;
}

export const ModelSelectorButton: React.FC<ModelSelectorButtonProps> = ({
  onNotifyComingSoon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [comingSoonModel, setComingSoonModel] = useState<string | null>(null);
  const [activeModelIndex, setActiveModelIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number; width: number }>({
    top: 60,
    left: 12,
    width: 160,
  });

  // The 3 frontier AI systems - names only
  const aiModels = [
    {
      id: 'claude',
      name: 'Claude 3.7',
      fullName: 'Claude 3.7 Sonnet',
      icon: <ClaudeIcon className="w-3.5 h-3.5 shrink-0" />,
      color: 'hover:border-[#D97757]/60',
    },
    {
      id: 'gpt',
      name: 'GPT-4o',
      fullName: 'GPT-4o Omnimodal',
      icon: <GptIcon className="w-3.5 h-3.5 shrink-0" />,
      color: 'hover:border-[#10A37F]/60',
    },
    {
      id: 'grok',
      name: 'Grok 3',
      fullName: 'Grok 3 Reasoning',
      icon: <GrokIcon className="w-3.5 h-3.5 shrink-0" />,
      color: 'hover:border-[#38BDF8]/60',
    },
  ];

  // Cycling the models logo one after another, changing every 3 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveModelIndex(prev => (prev + 1) % aiModels.length);
    }, 3000);
    return () => clearInterval(timer);
  }, [aiModels.length]);

  // Position directly under the AI models icon button with halved width (160px)
  const updatePosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const targetWidth = 160;
      
      let left = rect.left;
      if (left + targetWidth > window.innerWidth - 10) {
        left = window.innerWidth - targetWidth - 10;
      }
      if (left < 10) {
        left = 10;
      }

      setDropdownCoords({
        top: rect.bottom + 6,
        left,
        width: targetWidth,
      });
    }
  };

  const handleToggle = () => {
    if (!isOpen) {
      updatePosition();
      setComingSoonModel(null);
    }
    setIsOpen(prev => !prev);
  };

  // Keep positioned on resize or orientation change
  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => updatePosition();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectModel = (model: (typeof aiModels)[0]) => {
    setComingSoonModel(model.name);
    onNotifyComingSoon?.(model.fullName);
    setTimeout(() => {
      setIsOpen(false);
      setComingSoonModel(null);
    }, 1200);
  };

  const currentModel = aiModels[activeModelIndex];

  return (
    <>
      {/* 
        Navbar Trigger Button:
        - Mobile: compact icon showing cycling model logos every 3s
        - Desktop/Tablet: shows "Analyze" + cycling models logo
      */}
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="group relative flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.16] hover:border-indigo-400/50 text-slate-100 transition-all cursor-pointer shadow-sm active:scale-95 shrink-0"
        title={`AI Models Engine (${currentModel.name}) - Click to explore models`}
        aria-expanded={isOpen}
      >
        <span className="hidden sm:inline text-xs font-bold text-white tracking-tight">
          Analyze
        </span>

        {/* The models logo showing ONE after another, changing every 3 seconds */}
        <div className="w-5 h-5 flex items-center justify-center rounded-lg bg-black/50 border border-white/[0.12] shrink-0 overflow-hidden relative shadow-inner">
          <div
            key={currentModel.id}
            className="animate-in fade-in zoom-in-75 duration-300 flex items-center justify-center"
          >
            {currentModel.icon}
          </div>
        </div>

        <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* 
        Portaled Dropdown:
        - Container reduced by half (~160px width)
        - Just shows model names and icons, no writeups
      */}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] pointer-events-auto select-none">
          {/* Subtle Dim Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity animate-in fade-in duration-100"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />

          {/* Compact Floating Dropdown Card */}
          <div
            className="fixed rounded-xl bg-[#090d19] border border-white/[0.18] shadow-xl shadow-black/95 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ring-1 ring-white/[0.08]"
            style={{
              top: `${dropdownCoords.top}px`,
              left: `${dropdownCoords.left}px`,
              width: `${dropdownCoords.width}px`,
              transform: 'translateZ(0)',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header: Compact AI Models label + Close */}
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.08] bg-white/[0.03]">
              <span className="text-[11px] font-bold text-white tracking-tight flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                AI Models
              </span>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-0.5 rounded hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Notice when clicked */}
            {comingSoonModel && (
              <div className="px-2.5 py-1.5 bg-indigo-950/80 border-b border-indigo-500/30 text-[10px] text-cyan-300 flex items-center gap-1.5 animate-in fade-in duration-100">
                <CheckCircle2 className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate font-medium">{comingSoonModel} selected</span>
              </div>
            )}

            {/* List of Models: Just Names and Icons */}
            <div className="p-1.5 space-y-1">
              {aiModels.map(model => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectModel(model)}
                  className={`w-full text-left px-2 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] ${model.color} transition-all flex items-center justify-between gap-1.5 group cursor-pointer active:scale-[0.97]`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded-md bg-black/60 border border-white/[0.1] flex items-center justify-center shrink-0">
                      {model.icon}
                    </div>
                    <span className="font-semibold text-white text-xs tracking-tight truncate group-hover:text-cyan-300 transition-colors">
                      {model.name}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

