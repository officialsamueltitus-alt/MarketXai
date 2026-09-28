import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MarketXText } from './MarketXText';
import {
  ArrowUp,
  Clock,
  Zap,
  Sparkles,
  AlertCircle,
  Shield,
  Crosshair,
  Square,
  ImagePlus,
  X,
  FileImage,
  Clipboard,
  CheckCircle2,
  Target,
  SlidersHorizontal,
  Bot,
  Plug,
  Lock,
} from 'lucide-react';

// Slash-command menu shown when the user types "/" in the chat input
const SLASH_COMMANDS = [
  { id: 'strategy', label: 'Strategy', description: 'Build and save custom trading strategies', icon: Target },
  { id: 'preference', label: 'Preference Mode', description: 'Tune analysis style, risk and defaults', icon: SlidersHorizontal },
  { id: 'agent', label: 'Trading Agent', description: 'Autonomous agent that monitors your setups', icon: Bot },
  { id: 'mt5', label: 'MT5 Connector', description: 'Link your MetaTrader 5 account', icon: Plug },
] as const;

interface ChatInputProps {
  onSendMessage: (
    prompt: string,
    timeframe: string,
    slMode?: 'normal' | 'tight',
    baseStrategy?: any,
    chartImage?: string,
    chartFileName?: string
  ) => void;
  onStopAnalysis?: () => void;
  isLoading: boolean;
  credits: number;
  initialChartImage?: string | null;
  initialChartFileName?: string;
  onClearInitialChart?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopAnalysis,
  isLoading,
  credits,
  initialChartImage,
  initialChartFileName,
  onClearInitialChart,
}) => {
  const [input, setInput] = useState('');
  // Phones get the compact one-row composer, which needs a shorter placeholder
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639.98px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)');
    const on = () => setCompact(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const [timeframe, setTimeframe] = useState('4H');
  const [slMode, setSlMode] = useState<'normal' | 'tight'>('normal');
  const [chartImage, setChartImage] = useState<string | null>(initialChartImage || null);
  const [chartFileName, setChartFileName] = useState<string>(initialChartFileName || '');
  const [isPasted, setIsPasted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null);

  // Slash menu is open while the input is a single "/word" token
  const slashMatch = /^\/(\S*)$/.exec(input);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : '';
  const filteredCommands = slashMatch
    ? SLASH_COMMANDS.filter(
        c => c.label.toLowerCase().replace(/\s+/g, '').includes(slashQuery) || c.id.includes(slashQuery)
      )
    : [];
  const isSlashMenuOpen = !!slashMatch && !slashDismissed && filteredCommands.length > 0;

  useEffect(() => {
    setSlashIndex(0);
    if (!input.startsWith('/')) setSlashDismissed(false);
  }, [input]);

  useEffect(() => {
    if (!comingSoonLabel) return;
    const timer = setTimeout(() => setComingSoonLabel(null), 3000);
    return () => clearTimeout(timer);
  }, [comingSoonLabel]);

  const selectSlashCommand = (label: string) => {
    setInput('');
    setComingSoonLabel(label);
    textareaRef.current?.focus();
  };

  // Sync external initial chart image if passed
  useEffect(() => {
    if (initialChartImage) {
      setChartImage(initialChartImage);
      setChartFileName(initialChartFileName || 'Pasted Chart');
      setIsPasted(true);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [initialChartImage, initialChartFileName]);

  // Auto-resize textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(200, textareaRef.current.scrollHeight)}px`;
    }
  }, [input, compact]);

  const processImageFile = useCallback((file: File, customName?: string, fromPaste: boolean = false) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result as string;
      if (result) {
        setChartImage(result);
        const resolvedName = customName || file.name || 'Chart_Screenshot.png';
        setChartFileName(resolvedName);
        setIsPasted(fromPaste);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement> | ClipboardEvent) => {
      const clipboardData =
        (e as ClipboardEvent).clipboardData || (e as React.ClipboardEvent).clipboardData;
      if (!clipboardData) return;

      // 1. Check clipboard items for image (works with TradingView screenshots, Windows Snip, macOS Cmd+Ctrl+Shift+4)
      const items = clipboardData.items;
      if (items && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.indexOf('image') !== -1) {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              const now = new Date();
              const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              processImageFile(file, `Pasted_Chart_${timeStr.replace(/[: ]/g, '')}.png`, true);
              return;
            }
          }
        }
      }

      // 2. Fallback: check clipboard files array
      if (clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
          const file = clipboardData.files[i];
          if (file.type.startsWith('image/')) {
            e.preventDefault();
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            processImageFile(
              file,
              file.name && file.name !== 'image.png' ? file.name : `Pasted_Chart_${timeStr.replace(/[: ]/g, '')}.png`,
              true
            );
            return;
          }
        }
      }
    },
    [processImageFile]
  );

  // Global paste listener when chat view is active
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl !== textareaRef.current) {
        return;
      }
      handlePaste(e);
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [handlePaste]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file, file.name, false);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      processImageFile(file, file.name, false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) return;
    if (credits <= 0) return;

    const trimmed = input.trim();
    if (!trimmed && !chartImage) return;

    const promptToSend =
      trimmed ||
      `Analyze this uploaded chart image: identify key market structure, trend, key levels and high-probability trade setups.`;

    onSendMessage(
      promptToSend,
      timeframe,
      slMode,
      undefined,
      chartImage || undefined,
      chartFileName || undefined
    );

    setInput('');
    setChartImage(null);
    setChartFileName('');
    setIsPasted(false);
    if (onClearInitialChart) onClearInitialChart();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isSlashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredCommands[Math.min(slashIndex, filteredCommands.length - 1)];
        if (cmd) selectSlashCommand(cmd.label);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const timeframes = ['15m', '1H', '4H', '1D'];

  const cycleTimeframe = () => {
    const idx = timeframes.indexOf(timeframe);
    const nextIdx = (idx + 1) % timeframes.length;
    setTimeframe(timeframes[nextIdx]);
  };

  return (
    <div
      className="relative w-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Slash-command pop-out, anchored to the top of the composer */}
      {(isSlashMenuOpen || comingSoonLabel) && (
        <div className="absolute bottom-full left-0 mb-2 w-full sm:w-80 z-30 rounded-2xl bg-[var(--mx-surface-2)] border border-white/[0.1] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.9)] overflow-hidden mx-pop-in">
          {comingSoonLabel ? (
            <div className="flex items-start gap-3 p-3.5" role="status">
              <span className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-amber-300" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white">{comingSoonLabel}</div>
                <div className="text-xs text-slate-400 mt-0.5">In private test mode. Coming soon.</div>
              </div>
              <button
                type="button"
                onClick={() => setComingSoonLabel(null)}
                className="w-6 h-6 rounded-full hover:bg-white/[0.08] text-slate-500 hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div role="listbox" aria-label="Commands" className="p-1.5">
              <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-slate-500">Commands</div>
              {filteredCommands.map((cmd, i) => {
                const Icon = cmd.icon;
                const active = i === slashIndex;
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setSlashIndex(i)}
                    onClick={() => selectSlashCommand(cmd.label)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                      active ? 'bg-white/[0.06] text-white' : 'text-slate-300'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/[0.04] text-slate-400'}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">/{cmd.label.toLowerCase().replace(/\s+/g, '-')}</span>
                      <span className="block text-xs text-slate-500 truncate">{cmd.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className={`mx-composer max-sm:flex max-sm:flex-wrap max-sm:items-end max-sm:gap-0.5 max-sm:p-[5px] ${isDragging ? 'is-dragging' : ''}`}
      >
        {/* Attached chart preview */}
        {chartImage && (
          <div className="px-3 pt-3 max-sm:basis-full max-sm:px-1 max-sm:pt-1 max-sm:pb-1">
            <div className="inline-flex items-center gap-2.5 pl-1.5 pr-2 py-1.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] mx-rise">
              <img
                src={chartImage}
                alt="Attached chart"
                className="w-10 h-10 max-sm:w-8 max-sm:h-8 rounded-xl max-sm:rounded-lg object-cover bg-slate-900"
                referrerPolicy="no-referrer"
              />
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-200 truncate max-w-[180px]">
                  {chartFileName || (isPasted ? 'Pasted chart' : 'Chart image')}
                </div>
                <div className="text-[11px] text-slate-500 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ready for vision analysis
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChartImage(null);
                  setChartFileName('');
                  setIsPasted(false);
                  if (onClearInitialChart) onClearInitialChart();
                }}
                className="ml-1 w-6 h-6 rounded-full hover:bg-white/[0.1] text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Remove chart"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={compact ? (chartImage ? 'Ask about it…' : 'Ask any market…') : chartImage ? 'Ask about this chart…' : 'Ask about any market, or type /'}
          rows={1}
          className="block w-full bg-transparent text-[15px] leading-6 resize-none focus:outline-none px-4 pt-3.5 pb-1 max-h-[200px] min-h-[52px] max-sm:order-2 max-sm:w-auto max-sm:flex-1 max-sm:min-w-0 max-sm:px-1.5 max-sm:py-1.5 max-sm:min-h-9 max-sm:max-h-[132px]"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1 max-sm:contents">
          <div className="flex items-center gap-1 max-sm:contents">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 max-sm:order-1 max-sm:mb-0.5 ${
                chartImage ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
              title="Attach a chart screenshot (or paste with Ctrl+V)"
              aria-label="Attach chart image"
            >
              <ImagePlus className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={cycleTimeframe}
              className="h-8 px-2.5 max-sm:px-2 rounded-full text-xs font-medium font-mono text-slate-300 hover:text-white hover:bg-white/[0.06] border border-white/[0.08] transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0 max-sm:order-3 max-sm:mb-0.5"
              title="Change timeframe"
              aria-label={`Timeframe ${timeframe} (tap to change)`}
            >
              <Clock className="w-3.5 h-3.5 text-slate-500 max-sm:hidden" />
              {timeframe}
            </button>

            <button
              type="button"
              onClick={() => setSlMode(prev => (prev === 'tight' ? 'normal' : 'tight'))}
              className={`h-8 px-2.5 max-sm:w-8 max-sm:px-0 max-sm:justify-center rounded-full text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 border shrink-0 max-sm:order-4 max-sm:mb-0.5 ${
                slMode === 'tight'
                  ? 'text-amber-200 bg-amber-500/10 border-amber-500/30'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border-white/[0.08]'
              }`}
              title={`Stop-loss mode: ${slMode === 'tight' ? 'Tight' : 'Normal'} (click to toggle)`}
              aria-label={`Stop-loss mode: ${slMode === 'tight' ? 'Tight' : 'Normal'}`}
            >
              {slMode === 'tight' ? <Crosshair className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5 text-slate-500" />}
              <span className="hidden sm:inline">{slMode === 'tight' ? 'Tight SL' : 'Normal SL'}</span>
            </button>
          </div>

          {isLoading ? (
            <button
              type="button"
              onClick={onStopAnalysis}
              className="h-9 w-9 rounded-full bg-white text-slate-950 flex items-center justify-center transition hover:bg-slate-200 active:scale-95 cursor-pointer shrink-0 max-sm:order-5"
              title="Stop"
              aria-label="Stop analysis"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : credits <= 0 ? (
            <span className="h-9 px-3 max-sm:px-2.5 rounded-full text-xs font-medium text-rose-300 bg-rose-500/10 inline-flex items-center gap-1.5 shrink-0 max-sm:order-5 whitespace-nowrap">
              <AlertCircle className="w-3.5 h-3.5" /> <span className="max-sm:hidden">Out of credits</span>
              <span className="sm:hidden">No credits</span>
            </span>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() && !chartImage}
              className={`h-9 w-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 max-sm:order-5 ${
                input.trim() || chartImage
                  ? 'bg-white text-slate-950 hover:bg-slate-200 cursor-pointer shadow-[0_0_0_4px_rgba(139,92,246,0.15)]'
                  : 'bg-white/[0.06] text-slate-500 cursor-not-allowed'
              }`}
              title="Send (Enter)"
              aria-label="Send"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </form>

      <p className="text-center text-[11px] text-slate-500 mt-2 max-sm:mt-1.5 max-sm:text-[10px]">
        <MarketXText className="text-[11px]" /> is AI and can make mistakes. Always manage your risk.
      </p>
    </div>
  );
};
