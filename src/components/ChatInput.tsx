import { isProFeatureId } from '../utils/proFeatures';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { RdmTimeframePicker } from './RdmTimeframePicker';
import { rdmLabel } from '../utils/preferences';
import { STYLE_INFO, styleFramesLabel } from '../utils/tradeStyle';
import { MarketXText } from './MarketXText';
import { openMatt } from '../utils/matt';
import { normalizeSpokenPrompt, voiceCommand } from '../utils/voice';
import { useVoiceInput, VoiceMicButton, VoiceStatus } from './VoiceInput';
import { extractAssetInfo } from '../utils/localStrategyEngine';
import {
  ArrowUp,
  ShieldCheck,
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
  Timer,
  SlidersHorizontal,
  Bot,
  Plug,
  Lock,
  BellRing,
  NotebookPen,
  Activity,
  LineChart,
  Shuffle,
  Radar,
  Trophy,
  CandlestickChart,
  MessageCircleQuestion,
  Landmark,
  LayoutGrid,
} from 'lucide-react';

// Every timeframe the analysis engine supports (value sent to the server, label shown)
const TIMEFRAMES: { value: string; label: string }[] = [
  // Random: the server scans every timeframe and serves the strongest valid setup, saying which timeframe it used
  { value: 'RDM', label: 'RDM' },
  { value: '1M', label: '1m' },
  { value: '3M', label: '3m' },
  { value: '5M', label: '5m' },
  { value: '15M', label: '15m' },
  { value: '30M', label: '30m' },
  { value: '1H', label: '1H' },
  { value: '2H', label: '2H' },
  { value: '4H', label: '4H' },
  { value: '6H', label: '6H' },
  { value: '8H', label: '8H' },
  { value: '12H', label: '12H' },
  { value: '1D', label: '1D' },
  { value: '1W', label: '1W' },
];
const TF_KEY = 'mx_timeframe';

/** True when the text names a market (the asset parser falls back to Bitcoin when it finds none). */
function namesAnAsset(text: string): boolean {
  if (!text.trim()) return false;
  const a = extractAssetInfo(text);
  return a.symbol !== 'BTC/USDT' || /\b(BTC|XBT|BITCOIN)\b/i.test(text);
}

const MAX_CHART_SIDE = 1600;
/** Decodes an uploaded image and re-encodes it at most 1600px on its longest side (sharp enough to read a price
 * axis, small enough to upload fast). Rejects files the browser can't open as an image. */
function prepareChartImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!w || !h) return reject(new Error('empty'));
      const scale = Math.min(1, MAX_CHART_SIDE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const g = canvas.getContext('2d');
      if (!g) return reject(new Error('canvas'));
      g.fillStyle = '#ffffff'; // transparent PNGs get a solid background instead of black
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}
const timeframeLabel = (v: string) => TIMEFRAMES.find(t => t.value === v)?.label || v;

// Slash-command menu shown when the user types "/" in the chat input
const SLASH_COMMANDS = [
  { id: 'matt', label: 'Matt', description: 'Your MarketX help: features, your account, promos and the markets', icon: MessageCircleQuestion },
  { id: 'watchlist', label: 'Watchlist', description: 'Add pairs and get told when a setup builds, 24/7', icon: Radar },
  { id: 'alerts', label: 'Price Alerts', description: 'Get notified the moment price reaches your level', icon: BellRing },
  { id: 'journal', label: 'Trade Journal', description: 'Log your trades and review your win rate', icon: NotebookPen },
  { id: 'trackrecord', label: 'Track Record', description: 'How MarketX signals played out, scored by price', icon: Trophy },
  { id: 'fundamental', label: 'Fundamental Analysis', description: 'CPI, NFP, PPI, rate decisions: the likely outcome and the pairs it moves', icon: Landmark },
  { id: 'strategy', label: 'Strategy Builder', description: 'Build your own strategy (or pick SMC, ICT…) and run it in every analysis', icon: Target },
  { id: 'preference', label: 'Preference Mode', description: 'Your defaults, risk per trade and how results look', icon: SlidersHorizontal },
  { id: 'safety', label: 'Token Safety', description: 'Check any Solana token before you buy: type its $ticker or address', icon: ShieldCheck },
  { id: 'agent', label: 'Trading Agent', description: 'Autonomous agent that monitors your setups', icon: Bot },
  { id: 'mt5', label: 'MT5 Connector', description: 'Link your MetaTrader 5 account', icon: Plug },
  { id: 'indicators', label: 'Indicators', description: 'Add your favourite indicators to every analysis', icon: Activity },
  { id: 'tradingview', label: 'Connect TradingView', description: 'Link TradingView and analyze straight from your charts', icon: LineChart },
] as const;
// Commands that already work (the rest are in private testing)
const LIVE_COMMANDS = new Set<string>(['matt', 'watchlist', 'alerts', 'journal', 'trackrecord', 'preference', 'safety', 'strategy', 'fundamental']);

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
  /** A live slash command was chosen (e.g. 'alerts'); return true when it was handled */
  onCommand?: (id: string) => boolean;
  /** RDM is free; kept for a locked state should it ever be needed again */
  rdmLocked?: boolean;
  /** Chart screenshot analysis is Pro after the free period: attaching, pasting or dropping a chart calls onLockedFeature */
  chartLocked?: boolean;
  onLockedFeature?: (feature: 'RDM' | 'chart' | 'voice') => void;
  /** Voice input is Pro after the free period: the mic offers the upgrade instead of listening */
  voiceLocked?: boolean;
  /** Timeframes RDM scans, from Preference Mode ([] = all); picking RDM shows them to change */
  rdmTimeframes?: string[];
  /** Saves a new RDM choice to Preference Mode (signed in only) */
  onRdmTimeframesChange?: (next: string[]) => Promise<void>;
  /** Confirmation analysis is on (Preference Mode): a chip says so and opens Preference Mode */
  confirmationMode?: boolean;
  /** Trade type from Preference Mode (Scalp, Day, Swing; ANY shows nothing) */
  tradeStyle?: 'ANY' | 'SCALP' | 'DAY' | 'SWING';
  /** The timeframes kept for that trade type (Preference Mode; [] = all of the type's) */
  styleFrames?: string[];
  /** Strategy mode is on: the strategy's name (a chip says so and opens the Strategy Builder) */
  strategyName?: string | null;
  onOpenStrategy?: () => void;
  /** Fundamental Analysis is on: "/fundamental-analysis <topic>" gets a fundamental read (a chip says so and opens the command) */
  fundamentalOn?: boolean;
  onOpenFundamental?: () => void;
  onOpenPreference?: () => void;
  /** Opens Connectors / Plugins (every command in one place) */
  onOpenConnectors?: () => void;
  /** How many commands are switched on (shown as a dot count on the Connectors button) */
  connectorsOn?: number;
  /** Preference Mode defaults: applied when they change (a pick in the composer still stays for the next prompts) */
  defaultTimeframe?: string;
  defaultSlMode?: 'normal' | 'tight';
  /** Badge on the live commands, e.g. "Free till 1 Nov" or "Pro" (default "Live") */
  commandBadge?: string | null;
  isLoading: boolean;
  /** Analyses left today; at 0 new prompts are paused until the refill */
  credits: number;
  /** Local time of the next automatic refill, e.g. "3:00 AM" */
  refillLabel?: string;
  initialChartImage?: string | null;
  initialChartFileName?: string;
  onClearInitialChart?: () => void;
  /** Text put in the input, ready to send (e.g. "/fundamental-analysis USD CPI" from a news alert); `at` makes each one new */
  seedText?: { text: string; at: number } | null;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  onStopAnalysis,
  onCommand,
  rdmLocked = false,
  chartLocked = false,
  voiceLocked = false,
  onLockedFeature,
  rdmTimeframes,
  onRdmTimeframesChange,
  confirmationMode,
  tradeStyle,
  styleFrames,
  onOpenPreference,
  strategyName,
  onOpenStrategy,
  fundamentalOn = false,
  onOpenFundamental,
  onOpenConnectors,
  connectorsOn = 0,
  defaultTimeframe,
  defaultSlMode,
  commandBadge,
  isLoading,
  credits,
  refillLabel = '3:00 AM',
  initialChartImage,
  initialChartFileName,
  onClearInitialChart,
  seedText,
}) => {
  const [input, setInput] = useState('');
  // Phones get the compact one-row composer, which needs a shorter placeholder
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639.98px)').matches);
  // Very narrow screens (small Android phones, or any phone with enlarged text): the shortest placeholders
  const [tiny, setTiny] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 359.98px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 359.98px)');
    const on = () => setTiny(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639.98px)');
    const on = () => setCompact(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  // The chosen timeframe stays selected (also across visits) until the user picks another
  const hadSavedTf = useRef(
    (() => {
      try {
        return !!localStorage.getItem(TF_KEY);
      } catch {
        return false;
      }
    })()
  );
  const [timeframe, setTimeframeState] = useState(() => {
    try {
      const saved = localStorage.getItem(TF_KEY);
      if (saved && TIMEFRAMES.some(t => t.value === saved)) return saved;
    } catch {}
    return defaultTimeframe && TIMEFRAMES.some(t => t.value === defaultTimeframe) ? defaultTimeframe : '4H';
  });
  const setTimeframe = (v: string) => {
    setTimeframeState(v);
    try {
      localStorage.setItem(TF_KEY, v);
    } catch {}
  };
  // RDM became Pro only: a saved RDM pick falls back to 4H
  useEffect(() => {
    if (rdmLocked && timeframe === 'RDM') setTimeframe('4H');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdmLocked, timeframe]);
  const [tfOpen, setTfOpen] = useState(false);
  // The RDM timeframe list stays closed: it drops down only when RDM is tapped, and folds away on Save, Cancel or a second tap
  const [rdmEditing, setRdmEditing] = useState(false);
  useEffect(() => {
    if (!tfOpen) setRdmEditing(false);
  }, [tfOpen]);
  const tfButtonRef = useRef<HTMLButtonElement>(null);
  const tfMenuRef = useRef<HTMLDivElement>(null);
  const [slMode, setSlMode] = useState<'normal' | 'tight'>(defaultSlMode || 'normal');
  // A default changed in Preference Mode applies at once
  const lastDefaults = useRef({ tf: defaultTimeframe, sl: defaultSlMode });
  useEffect(() => {
    const prev = lastDefaults.current;
    // First load of the defaults counts only when no timeframe was picked on this device yet
    const firstLoad = prev.tf === undefined && !hadSavedTf.current;
    if (defaultTimeframe && (firstLoad || (prev.tf !== undefined && defaultTimeframe !== prev.tf)) && TIMEFRAMES.some(t => t.value === defaultTimeframe)) {
      if (!(defaultTimeframe === 'RDM' && rdmLocked)) setTimeframe(defaultTimeframe);
    }
    if (defaultSlMode && defaultSlMode !== prev.sl) setSlMode(defaultSlMode);
    lastDefaults.current = { tf: defaultTimeframe, sl: defaultSlMode };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTimeframe, defaultSlMode]);
  const [chartImage, setChartImage] = useState<string | null>(initialChartImage || null);
  const [chartFileName, setChartFileName] = useState<string>(initialChartFileName || '');
  const [isPasted, setIsPasted] = useState(false);
  // Chart attached but no pair named yet, or the file couldn't be opened as an image
  const [chartNotice, setChartNotice] = useState<'pair' | 'unreadable' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!seedText?.text) return;
    setInput(seedText.text.slice(0, 1500));
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [seedText]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [comingSoonLabel, setComingSoonLabel] = useState<string | null>(null);

  // Slash menu is open while the input is a single "/word" token
  const slashMatch = /^\/(\S*)$/.exec(input);
  // "/trade-journal", "/tradejournal" and "/trade" all find Trade Journal
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase().replace(/[-_]/g, '') : '';
  const filteredCommands = slashMatch
    ? SLASH_COMMANDS.filter(
        c => c.label.toLowerCase().replace(/\s+/g, '').includes(slashQuery) || c.id.includes(slashQuery)
      )
    : [];
  const isSlashMenuOpen = !!slashMatch && !slashDismissed && filteredCommands.length > 0;

  // Keep the highlighted command visible when moving through the (scrollable) list with the arrow keys
  useEffect(() => {
    document.querySelector('[aria-label="Tools"] [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex]);

  useEffect(() => {
    setSlashIndex(0);
    if (!input.startsWith('/')) setSlashDismissed(false);
  }, [input]);

  useEffect(() => {
    if (!comingSoonLabel) return;
    const timer = setTimeout(() => setComingSoonLabel(null), 3000);
    return () => clearTimeout(timer);
  }, [comingSoonLabel]);

  // Modes that change how answers are made: shown as coloured dots on the Tools button (the Tools sheet lists them)
  const activeModes = [
    fundamentalOn ? { id: 'fundamental', label: 'Fundamental Analysis', dot: 'bg-sky-400' } : null,
    strategyName ? { id: 'strategy', label: `Strategy Builder (${strategyName})`, dot: 'bg-violet-400' } : null,
    confirmationMode && !strategyName ? { id: 'confirmation', label: 'Confirmation analysis', dot: 'bg-emerald-400' } : null,
    tradeStyle && tradeStyle !== 'ANY'
      ? { id: 'style', label: `${STYLE_INFO[tradeStyle].label}s only`, dot: tradeStyle === 'SCALP' ? 'bg-cyan-400' : tradeStyle === 'DAY' ? 'bg-amber-400' : 'bg-fuchsia-400' }
      : null,
  ].filter(Boolean) as Array<{ id: string; label: string; dot: string }>;

  const selectSlashCommand = (cmd: (typeof SLASH_COMMANDS)[number]) => {
    // Token Safety runs in the chat: "/token-safety " is kept so the trader types the $ticker or address after it
    if (cmd.id === 'matt') {
      setInput('');
      openMatt();
      return;
    }
    // Fundamental Analysis on: the command goes in the input, followed by what to read ("/fundamental-analysis CPI");
    // off: its panel opens to switch it on
    if (cmd.id === 'fundamental' && fundamentalOn) {
      setInput('/fundamental-analysis ');
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    if (cmd.id === 'safety') {
      setInput('/token-safety ');
      setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    setInput('');
    if (LIVE_COMMANDS.has(cmd.id) && onCommand?.(cmd.id)) {
      textareaRef.current?.blur();
      return;
    }
    setComingSoonLabel(cmd.label);
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

  const chartLockRef = useRef({ chartLocked, onLockedFeature });
  chartLockRef.current = { chartLocked, onLockedFeature };
  const processImageFile = useCallback((file: File, customName?: string, fromPaste: boolean = false) => {
    // Chart screenshots are a Pro feature after the free period: nothing is attached, the upgrade is offered
    if (chartLockRef.current.chartLocked) {
      chartLockRef.current.onLockedFeature?.('chart');
      return;
    }
    if (!file || !file.type.startsWith('image/')) {
      if (file) setChartNotice('unreadable');
      return;
    }
    prepareChartImage(file)
      .then(result => {
        setChartImage(result);
        setChartFileName(customName || file.name || 'Chart_Screenshot.png');
        setIsPasted(fromPaste);
        setChartNotice(null);
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      })
      .catch(() => setChartNotice('unreadable'));
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

  // Voice input (free): the words appear in the box as they are spoken, then go out like a typed prompt.
  // "Open my watchlist" opens the tool; "fundamental analysis CPI" runs the command.
  const voiceBaseRef = useRef('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voice = useVoiceInput({
    onInterim: t => setInput(voiceBaseRef.current ? `${voiceBaseRef.current} ${t}` : t),
    onFinal: t => {
      const tool = voiceCommand(t);
      if (tool) {
        setInput(voiceBaseRef.current);
        const cmd = SLASH_COMMANDS.find(c => c.id === tool);
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      const said = normalizeSpokenPrompt(t);
      const text = voiceBaseRef.current && !said.startsWith('/') ? `${voiceBaseRef.current} ${said}` : said;
      setInput(text);
      handleSubmit(undefined, text);
    },
    onError: message => {
      setInput(voiceBaseRef.current);
      setVoiceError(message);
    },
  });
  const voiceOn = voice.state !== 'idle';
  const toggleVoice = () => {
    if (!voiceOn && voiceLocked) {
      onLockedFeature?.('voice');
      return;
    }
    if (!voiceOn) {
      voiceBaseRef.current = input.trim();
      setVoiceError(null);
      setTfOpen(false);
    }
    voice.toggle();
  };
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 4500);
    return () => clearTimeout(t);
  }, [voiceError]);

  const handleSubmit = (e?: React.FormEvent, spoken?: string) => {
    if (e) e.preventDefault();
    if (isLoading) return;
    if (credits <= 0) return;

    const trimmed = (spoken ?? input).trim();
    if (!trimmed && !chartImage) return;

    // A chart is read from the image alone, so the user only has to say which pair it is
    if (chartImage && !namesAnAsset(trimmed)) {
      setChartNotice('pair');
      textareaRef.current?.focus();
      return;
    }
    setChartNotice(null);
    const promptToSend = trimmed;

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
        if (cmd) selectSlashCommand(cmd);
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

  // Timeframe pop-up: closes on outside tap or Escape; the selected chip is scrolled into view when it opens
  useEffect(() => {
    if (!tfOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (tfMenuRef.current?.contains(t) || tfButtonRef.current?.contains(t)) return;
      setTfOpen(false);
      // The tap only closes the menu; it must not also press whatever sits underneath (e.g. a market card)
      const swallow = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 600);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTfOpen(false);
        tfButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    const sel = tfMenuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    sel?.scrollIntoView({ block: 'nearest', inline: 'center' });
    sel?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tfOpen]);

  // While the timeframe menu is open, the chat's scroll button moves up above it instead of covering a chip
  useEffect(() => {
    const root = document.documentElement;
    const el = tfMenuRef.current;
    if (!tfOpen || !el) return;
    root.style.setProperty('--mx-popover-h', `${el.offsetHeight + 8}px`);
    return () => root.style.setProperty('--mx-popover-h', '0px');
    // The RDM picker changes the menu's height
  }, [tfOpen, timeframe, rdmEditing]);

  const chooseTimeframe = (v: string) => {
    if (v === 'RDM' && rdmLocked) {
      setTfOpen(false);
      onLockedFeature?.('RDM');
      return;
    }
    // RDM keeps the menu open and drops down the list of timeframes it scans (a second tap folds it away)
    if (v === 'RDM' && onRdmTimeframesChange) {
      setRdmEditing(open => (timeframe === 'RDM' ? !open : true));
      setTimeframe(v);
      return;
    }
    setTimeframe(v);
    setTfOpen(false);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const onTfKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const buttons = Array.from(tfMenuRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]') || []);
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    buttons[next]?.focus();
    buttons[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const renderTf = (t: { value: string; label: string }) => {
    const active = t.value === timeframe;
    return (
      <button
        key={t.value}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onClick={() => chooseTimeframe(t.value)}
        className={`snap-start shrink-0 h-9 min-w-[3rem] px-3 rounded-xl text-[13px] font-medium font-mono transition-colors cursor-pointer border ${
          active
            ? 'bg-white text-slate-950 border-white'
            : 'text-slate-300 border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.08] hover:text-white'
        }`}
      >
        {t.value === 'RDM' ? (
          <span className="inline-flex items-center gap-1.5" title={rdmLocked ? 'RDM is a Pro feature' : 'Random: scans every timeframe and picks the best valid setup'}>
            {rdmLocked ? <Lock className="w-3.5 h-3.5 text-amber-300" /> : <Shuffle className="w-3.5 h-3.5" />}
            RDM
            {rdmLocked && <span className="text-[9px] font-sans font-bold text-amber-300">PRO</span>}
          </span>
        ) : (
          t.label
        )}
      </button>
    );
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

      {/* Timeframe pop-up: one horizontal row of every timeframe, anchored to the top of the composer */}
      {tfOpen && (
        <div
          ref={tfMenuRef}
          className="absolute bottom-full left-0 right-0 mb-2 z-30 rounded-2xl bg-[var(--mx-surface-2)] border border-white/[0.1] shadow-[0_16px_48px_-12px_rgba(0,0,0,0.9)] mx-pop-in"
        >
          <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1">
            <span className="text-[11px] font-medium text-slate-400">Timeframe</span>
            <span className="text-[11px] text-slate-500 truncate ml-2">{timeframe === 'RDM' ? `RDM scans ${rdmLabel(rdmTimeframes).replace('All timeframes', 'every timeframe')}` : 'Stays selected until you change it'}</span>
          </div>
          <div role="listbox" aria-label="Timeframe" aria-orientation="horizontal" onKeyDown={onTfKeyDown} className="flex items-center pb-2.5 pt-1">
            {/* RDM stays pinned on the left so it is always in view; the timeframes scroll beside it */}
            <div className="shrink-0 pl-2.5 pr-1.5 mr-0.5 border-r border-white/[0.08]">{TIMEFRAMES.filter(t => t.value === 'RDM').map(renderTf)}</div>
            <div className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto overscroll-x-contain pl-1 pr-2.5 snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TIMEFRAMES.filter(t => t.value !== 'RDM').map(renderTf)}
            </div>
          </div>
          {/* RDM picked: choose which timeframes it searches (saved to Preference Mode, used everywhere) */}
          {timeframe === 'RDM' && !rdmLocked && onRdmTimeframesChange && (
            rdmEditing ? (
              <div className="mx-3 mb-3 pt-2.5 border-t border-white/[0.08] mx-pop-in">
                <div className="mb-1.5 text-[11px] font-medium text-slate-400">RDM searches</div>
                <RdmTimeframePicker
                  compact
                  value={rdmTimeframes || []}
                  onChange={onRdmTimeframesChange}
                  onSaved={() => {
                    setRdmEditing(false);
                    setTfOpen(false);
                    textareaRef.current?.focus({ preventScroll: true });
                  }}
                  onCancel={() => setRdmEditing(false)}
                />
              </div>
            ) : null
          )}
        </div>
      )}

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
            <div role="listbox" aria-label="Tools" className="p-1.5 max-h-[min(60vh,400px)] overflow-y-auto overscroll-contain">
              <div className="px-2.5 pt-1.5 pb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-slate-500">
                <span>Tools</span>
                {filteredCommands.some(c => !LIVE_COMMANDS.has(c.id)) && (
                  <span className="inline-flex items-center gap-1 text-amber-300/80">
                    <Lock className="w-3 h-3" /> Soon: private testing
                  </span>
                )}
              </div>
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
                    onClick={() => selectSlashCommand(cmd)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                      active ? 'bg-white/[0.06] text-white' : 'text-slate-300'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${active ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/[0.04] text-slate-400'}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        /{cmd.label.toLowerCase().replace(/\s+/g, '-')}
                        {LIVE_COMMANDS.has(cmd.id) ? (
                          <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 inline-flex items-center gap-1">
                            <span className="w-1 h-1 rounded-full bg-emerald-400" />{isProFeatureId(cmd.id) ? commandBadge || 'Live' : 'Free'}
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-1.5 py-px rounded-full bg-amber-500/10 text-amber-300/90 border border-amber-500/20">Soon</span>
                        )}
                      </span>
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
        className={`mx-composer ${isDragging ? 'is-dragging' : ''} ${voiceOn ? 'is-listening' : ''}`}
      >
        {chartNotice === 'unreadable' && !chartImage && (
          <div className="px-3 pt-3 max-sm:px-2 max-sm:pt-2">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-[12px] text-rose-200" role="alert">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              That file can't be read as an image. Use a PNG or JPG chart screenshot.
              <button type="button" onClick={() => setChartNotice(null)} aria-label="Dismiss" className="ml-1 w-5 h-5 rounded-full hover:bg-white/[0.08] flex items-center justify-center cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {voiceError && (
          <div className="px-3 pt-3 max-sm:px-2 max-sm:pt-2">
            <div className="mx-rise inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-[12px] text-slate-200" role="alert">
              <AlertCircle className="w-3.5 h-3.5 text-violet-300 shrink-0" />
              {voiceError}
              <button type="button" onClick={() => setVoiceError(null)} aria-label="Dismiss" className="ml-1 w-5 h-5 rounded-full hover:bg-white/[0.08] flex items-center justify-center cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {/* Attached chart preview */}
        {chartImage && (
          <div className="px-3 pt-3 max-sm:px-2 max-sm:pt-2">
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
                {chartNotice === 'pair' ? (
                  <div className="text-[11px] text-amber-300 flex items-center gap-1" role="alert">
                    <AlertCircle className="w-3 h-3" /> Type the pair, e.g. EURUSD or Gold
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Ready, name the pair and send
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setChartImage(null);
                  setChartFileName('');
                  setIsPasted(false);
                  setChartNotice(null);
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
          onChange={e => {
            setInput(e.target.value);
            if (chartNotice === 'pair' && namesAnAsset(e.target.value)) setChartNotice(null);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={voice.state === 'starting' ? 'Waiting for your microphone…' : voice.state === 'listening' ? (tiny || compact ? 'Listening…' : 'Listening… try "Analyze gold on the 4H"') : voice.state === 'transcribing' ? 'Writing down what you said…' : credits <= 0 ? (tiny ? `Back at ${refillLabel}` : `Daily limit reached, back at ${refillLabel}`) : tiny ? (chartImage ? 'Which pair?' : 'Ask MarketX…') : compact ? (chartImage ? 'Which pair? e.g. EURUSD' : 'Ask any market…') : chartImage ? 'Which pair is this chart? e.g. EURUSD, Gold, BTC' : 'Ask about any market, or type /'}
          rows={1}
          className="block w-full bg-transparent text-[15px] leading-6 resize-none focus:outline-none px-4 pt-3.5 pb-1 max-h-[200px] min-h-[52px] max-sm:px-3.5 max-sm:pt-3 max-sm:min-h-[44px] max-sm:max-h-[132px]"
        />

        {/* One slim row under the text: attach + Tools on the left; timeframe, stop mode and send on the right */}
        <div className="flex items-center justify-between gap-1.5 px-2 pb-2 pt-0.5 sm:px-2.5 sm:pb-2.5">
          {voiceOn ? (
            <VoiceStatus state={voice.state} elapsed={voice.elapsed} levelRef={voice.levelRef} onCancel={voice.cancel} />
          ) : (
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => (chartLocked ? onLockedFeature?.('chart') : fileInputRef.current?.click())}
              className={`relative h-8 w-8 rounded-full flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                chartImage ? 'text-cyan-300 bg-cyan-500/10' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
              title={chartLocked ? 'Chart screenshot analysis is a Pro feature' : 'Attach a chart screenshot (or paste with Ctrl+V)'}
              aria-label={chartLocked ? 'Attach chart image (Pro)' : 'Attach chart image'}
            >
              <ImagePlus className="w-4 h-4" />
              {chartLocked && <Lock className="absolute -top-0.5 -right-0.5 w-3 h-3 p-[1px] rounded-full bg-[var(--mx-bg-2)] text-amber-300" aria-hidden="true" />}
            </button>

            {onOpenConnectors && (
              <button
                type="button"
                onClick={onOpenConnectors}
                className={`relative h-8 pl-2 pr-2.5 rounded-full text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                  activeModes.length || connectorsOn
                    ? 'text-slate-100 bg-white/[0.06] hover:bg-white/[0.1]'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
                }`}
                title={activeModes.length ? `Tools · on now: ${activeModes.map(m => m.label).join(', ')}` : 'Tools: price alerts, watchlist, journal, Fundamental Analysis, Strategy Builder and more'}
                aria-label={`Open Tools${activeModes.length || connectorsOn ? ` (${activeModes.length + connectorsOn} on)` : ''}`}
              >
                <LayoutGrid className="w-3.5 h-3.5 text-violet-300" />
                Tools
                {activeModes.length > 0 && (
                  <span className="flex items-center gap-[3px]" aria-hidden="true">
                    {activeModes.map(m => (
                      <span key={m.id} className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
                    ))}
                  </span>
                )}
                {connectorsOn > 0 && !activeModes.length && (
                  <span className="min-w-4 h-4 px-1 rounded-full bg-emerald-500/20 text-[9px] font-bold text-emerald-300 flex items-center justify-center" aria-hidden="true">
                    {connectorsOn}
                  </span>
                )}
              </button>
            )}
          </div>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {!voiceOn && (
            <>
            <button
              ref={tfButtonRef}
              type="button"
              onClick={() => setTfOpen(o => !o)}
              className={`h-8 px-2.5 rounded-full text-xs font-medium font-mono transition-colors cursor-pointer inline-flex items-center gap-1 shrink-0 ${
                tfOpen ? 'text-white bg-white/[0.08]' : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
              title="Change timeframe"
              aria-label={`Timeframe ${timeframeLabel(timeframe)} (tap to change)`}
              aria-haspopup="listbox"
              aria-expanded={tfOpen}
            >
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              {timeframeLabel(timeframe)}
            </button>

            <button
              type="button"
              onClick={() => setSlMode(prev => (prev === 'tight' ? 'normal' : 'tight'))}
              className={`h-8 px-2 rounded-full text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1 shrink-0 ${
                slMode === 'tight' ? 'text-amber-200 bg-amber-500/10' : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'
              }`}
              title={`Stop-loss mode: ${slMode === 'tight' ? 'Tight' : 'Normal'} (tap to switch)`}
              aria-label={`Stop-loss mode: ${slMode === 'tight' ? 'Tight' : 'Normal'}`}
            >
              {slMode === 'tight' ? <Crosshair className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5 text-slate-500" />}
              <span className={tiny ? 'sr-only' : ''}>{slMode === 'tight' ? 'Tight' : 'SL'}</span>
            </button>
            </>
            )}

            {!isLoading && credits > 0 && voice.supported && <VoiceMicButton state={voice.state} onClick={toggleVoice} locked={voiceLocked && !voiceOn} />}
            {voiceOn ? null : isLoading ? (
              <button
                type="button"
                onClick={onStopAnalysis}
                className="ml-0.5 h-9 w-9 rounded-full bg-white text-slate-950 flex items-center justify-center transition hover:bg-slate-200 active:scale-95 cursor-pointer shrink-0"
                title="Stop"
                aria-label="Stop analysis"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : credits <= 0 ? (
              <span
                className="ml-0.5 h-9 px-3 max-sm:px-2.5 rounded-full text-xs font-medium text-amber-200 bg-amber-500/10 border border-amber-500/20 inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                role="status"
                title={`Today's analyses are used up. They refill automatically at ${refillLabel}.`}
              >
                <Clock className="w-3.5 h-3.5" /> <span className="max-sm:hidden">Refills at {refillLabel}</span>
                <span className="sm:hidden">{refillLabel}</span>
              </span>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && !chartImage}
                className={`ml-0.5 h-9 w-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 ${
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
        </div>
      </form>

      <p className="text-center text-[11px] text-slate-500 mt-2 max-sm:mt-1.5 max-sm:text-[10px]">
        <MarketXText className="text-[11px]" /> is SI and can make mistakes. Always manage your risk.
      </p>
    </div>
  );
};
