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
} from 'lucide-react';

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
  const [timeframe, setTimeframe] = useState('4H');
  const [slMode, setSlMode] = useState<'normal' | 'tight'>('normal');
  const [chartImage, setChartImage] = useState<string | null>(initialChartImage || null);
  const [chartFileName, setChartFileName] = useState<string>(initialChartFileName || '');
  const [isPasted, setIsPasted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      textareaRef.current.style.height = `${Math.min(160, textareaRef.current.scrollHeight)}px`;
    }
  }, [input]);

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
      `Analyze this uploaded chart image: identify key market structure, order blocks, FVG, trend, and high-probability trade setups.`;

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
      className="w-full max-w-[280px] sm:max-w-[320px] mx-auto"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Uploaded / Pasted Chart Thumbnail Preview Above Input */}
      {chartImage && (
        <div className="mb-1.5 p-1.5 rounded-xl bg-slate-950/95 border border-cyan-500/40 shadow-xl backdrop-blur-xl flex items-center justify-between gap-2 animate-in fade-in slide-in-from-bottom-1 duration-200">
          <div className="flex items-center gap-2 min-w-0">
            <div className="relative shrink-0">
              <img
                src={chartImage}
                alt="Uploaded Chart Preview"
                className="w-8 h-8 rounded-lg object-cover border border-cyan-400/40 shrink-0 bg-slate-900"
                referrerPolicy="no-referrer"
              />
              {isPasted && (
                <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-cyan-500 text-slate-950 flex items-center justify-center text-[8px] font-bold shadow-xs">
                  📋
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-cyan-300 font-mono truncate max-w-[140px]">
                  {chartFileName || (isPasted ? 'Pasted Chart Image' : 'Chart Image')}
                </span>
                <span className="text-[9px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono flex items-center gap-0.5">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  {isPasted ? 'Pasted Ready' : 'Vision Ready'}
                </span>
              </div>
              <span className="text-[9px] text-slate-400 block truncate">
                AI will inspect candlesticks & POIs
              </span>
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
            className="w-5 h-5 rounded-md bg-white/[0.08] hover:bg-rose-500/30 text-slate-400 hover:text-rose-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Remove chart"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Crisp Animated Running Border Beam Turning Around Input Box */}
      <div className={`running-rainbow-wrapper transition-all ${isDragging ? 'ring-2 ring-cyan-400 scale-[1.02]' : ''}`}>
        <div className="border-light-beam" aria-hidden="true" />
        <form
          onSubmit={handleSubmit}
          className="running-rainbow-inner px-2 py-1 relative transition-all flex items-center gap-1 min-h-[34px] sm:min-h-[36px]"
        >
          {/* Chart Image Upload / Paste Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`p-1 rounded font-mono font-semibold transition-all flex items-center justify-center cursor-pointer border shrink-0 ${
              chartImage
                ? 'bg-cyan-500/25 text-cyan-300 border-cyan-500/50 shadow-xs'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white hover:bg-white/[0.08]'
            }`}
            title="Upload or paste (Ctrl+V) chart image for AI vision analysis (PNG, JPG, WEBP)"
          >
            <ImagePlus className="w-2.5 h-2.5 shrink-0" />
          </button>

          {/* Main Ultra-Compact Textarea with onPaste listener */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              chartImage
                ? 'Ask about this chart (or press Enter)...'
                : 'Ask MarketX...'
            }
            rows={1}
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-400 text-xs sm:text-xs resize-none focus:outline-none px-1 py-0.5 max-h-16 leading-tight font-sans min-w-0 self-center"
          />

          {/* Right Controls: Timeframe, Tight SL & Submit in unified single row */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Compact Timeframe Cycler */}
            <button
              type="button"
              onClick={cycleTimeframe}
              className="px-1.5 py-0.5 text-[9px] sm:text-[10px] font-mono font-bold rounded bg-white/[0.06] hover:bg-white/[0.12] text-indigo-300 border border-white/[0.1] transition-all cursor-pointer"
              title={`Timeframe: ${timeframe} (Click to switch)`}
            >
              {timeframe}
            </button>

            {/* Tight SL / Normal SL Toggle Button */}
            <button
              type="button"
              onClick={() => setSlMode(prev => prev === 'tight' ? 'normal' : 'tight')}
              className={`p-1 rounded font-mono font-semibold transition-all flex items-center justify-center cursor-pointer border ${
                slMode === 'tight'
                  ? 'bg-amber-500/25 text-amber-300 border-amber-500/40 shadow-xs'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:text-white'
              }`}
              title={`SL Mode: ${slMode === 'tight' ? 'Tight SL' : 'Normal SL'} (click to toggle)`}
            >
              {slMode === 'tight' ? (
                <Crosshair className="w-2.5 h-2.5 text-amber-400 shrink-0" />
              ) : (
                <Shield className="w-2.5 h-2.5 text-slate-400 shrink-0" />
              )}
            </button>

            {/* Submit or Stop Button */}
            {isLoading ? (
              <button
                type="button"
                onClick={onStopAnalysis}
                className="w-6 h-6 rounded bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center transition-all shadow-md shadow-rose-950/50 hover:scale-105 active:scale-95 cursor-pointer shrink-0 animate-pulse"
                title="Stop analysis"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
              </button>
            ) : credits <= 0 ? (
              <div className="flex items-center gap-0.5 text-[8px] text-rose-400 font-semibold px-1 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 shrink-0">
                <AlertCircle className="w-2 h-2" />
                <span>Refill</span>
              </div>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && !chartImage}
                className={`w-6 h-6 rounded flex items-center justify-center transition-all shadow-md cursor-pointer shrink-0 ${
                  input.trim() || chartImage
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white shadow-indigo-950/40 hover:scale-105 active:scale-95'
                    : 'bg-white/[0.04] text-slate-500 cursor-not-allowed border border-white/[0.06]'
                }`}
                title="Send (Enter)"
              >
                <ArrowUp className="w-3 h-3" />
              </button>
            )}
          </div>
        </form>
      </div>

      {/* User requested exact writeup below input section */}
      <div className="flex items-center justify-center gap-1 text-[8px] sm:text-[9px] text-slate-400 mt-1 text-center truncate">
        <span><MarketXText className="text-[8px] sm:text-[9px]" /> is Ai, do well to re-evaluate feedback</span>
      </div>
    </div>
  );
};
