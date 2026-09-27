import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles, AlertCircle, CheckCircle2, ChevronDown } from 'lucide-react';

// Official brand marks (sourced from @lobehub/icons-static-svg 1.95.1, Sep 2026)
export const ClaudeIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Claude">
    <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero" />
  </svg>
);

export const GptIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={className} role="img" aria-label="OpenAI ChatGPT">
    <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" fill="#FFFFFF" fillRule="evenodd" />
  </svg>
);

export const GrokIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={className} role="img" aria-label="xAI Grok">
    <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" fill="#FFFFFF" fillRule="evenodd" />
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
      if (typeof document !== 'undefined' && document.hidden) return;
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
        className="group relative flex items-center gap-1.5 h-8 pl-1.5 pr-2 sm:pl-2 sm:pr-2.5 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-slate-100 transition-colors cursor-pointer active:scale-95 shrink-0"
        title={`AI Models Engine (${currentModel.name}) - Click to explore models`}
        aria-expanded={isOpen}
      >
        <span className="hidden sm:inline text-[13px] font-medium text-slate-200">
          Analyze
        </span>

        {/* The models logo showing ONE after another, changing every 3 seconds */}
        <div className="w-5 h-5 flex items-center justify-center rounded-full bg-black/40 shrink-0 overflow-hidden relative">
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
            className="fixed rounded-xl bg-[#0e0e11] border border-white/[0.18] shadow-xl shadow-black/95 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-100 ring-1 ring-white/[0.08]"
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

