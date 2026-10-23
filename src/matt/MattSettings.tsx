import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Loader2, Lock, Mic, MicOff, Play, Save, Square, UserRound } from 'lucide-react';
import { MattSpeaker, unlockedAudio, unlockSpeech, type MattVoice } from './mattVoice';

// Matt settings (owner-specified): the trader's own choices for Matt, kept on this device: the mic in Matt on or off, and
// Matt's voice (female or male) for Talk back. Opened from the gear at the top of the Matt page (or /matt?settings=1).

const VOICES: Array<{ id: MattVoice; label: string; desc: string }> = [
  { id: 'female', label: 'Female', desc: 'A warm, clear female voice' },
  { id: 'male', label: 'Male', desc: 'A calm, steady male voice' },
];

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    onClick={() => onChange(!on)}
    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer ${on ? 'bg-violet-500' : 'bg-white/[0.12]'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform ${on ? 'translate-x-5' : ''}`} style={{ background: '#fff' }} />
  </button>
);

export const MattSettings: React.FC<{
  micOn: boolean;
  onMic: (on: boolean) => void;
  voice: MattVoice;
  onVoice: (v: MattVoice) => void;
  /** Voice is Pro after 1 Nov 2026: the choices still save, the preview says so */
  voiceAllowed: boolean;
  onClose: () => void;
}> = ({ micOn, onMic, voice, onVoice, voiceAllowed, onClose }) => {
  const [preview, setPreview] = useState<{ id: MattVoice; state: 'loading' | 'playing' } | null>(null);
  // The voice is picked first and kept only when Save is pressed (owner-specified)
  const [draft, setDraft] = useState<MattVoice>(voice);
  const [saved, setSaved] = useState(false);
  const dirty = draft !== voice;
  const pick = (v: MattVoice) => {
    setDraft(v);
    setSaved(false);
  };
  const save = () => {
    onVoice(draft);
    setSaved(true);
  };
  const [note, setNote] = useState<string | null>(null);
  const speaker = useRef<MattSpeaker | null>(null);
  const run = useRef(0);

  const stopPreview = () => {
    run.current++;
    speaker.current?.stop();
    setPreview(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      run.current++;
      speaker.current?.close();
    };
  }, [onClose]);

  /** Matt says hello in that voice (made inside the tap so phones play it) */
  const hear = async (id: MattVoice) => {
    if (preview?.id === id) return stopPreview();
    stopPreview();
    setNote(null);
    if (!speaker.current) {
      unlockSpeech();
      speaker.current = new MattSpeaker(null, unlockedAudio());
    }
    const mine = ++run.current;
    setPreview({ id, state: 'loading' });
    try {
      const r = await fetch('/api/matt/speak', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ greeting: true, voice: id }),
      });
      const d = await r.json().catch(() => null);
      if (mine !== run.current) return;
      if (r.status === 402) {
        setNote(d?.message || 'Talking with Matt is a Pro feature.');
        return setPreview(null);
      }
      setPreview({ id, state: 'playing' });
      if (r.ok && d?.audio) await speaker.current.playWav(d.audio);
      else await speaker.current.speakOnDevice(d?.text || "Hi! I'm Matt, your MarketX guide.", id);
    } catch {
      if (mine === run.current) setNote("Couldn't play the sample. Check your connection and try again.");
    }
    if (mine === run.current) setPreview(null);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[var(--mx-bg)] flex flex-col mx-fade-in" role="dialog" aria-modal="true" aria-label="Matt settings">
      <header className="shrink-0 h-14 mt-[env(safe-area-inset-top)] px-3 sm:px-5 flex items-center gap-2">
        <button type="button" onClick={onClose} aria-label="Back to Matt" className="w-9 h-9 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer">
          <ArrowLeft className="w-[18px] h-[18px]" />
        </button>
        <h1 className="text-[15px] font-semibold text-white">Matt settings</h1>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="max-w-xl mx-auto space-y-6 pt-2">
          {/* Microphone */}
          <section>
            <h2 className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Microphone</h2>
            <div className="mx-card p-4 flex items-start gap-3">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${micOn ? 'bg-violet-500/15 text-violet-200' : 'bg-white/[0.05] text-slate-500'}`}>
                {micOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-100">Mic in Matt</span>
                  <Switch on={micOn} onChange={onMic} label="Mic in Matt" />
                </div>
                <p className="mt-1 text-[12.5px] text-slate-400 leading-relaxed">
                  {micOn
                    ? "The mic shows in Matt's input box: tap it for a Direct question or to Talk back."
                    : "The mic is hidden in Matt. Switch it on to ask questions out loud or talk with Matt."}
                </p>
              </div>
            </div>
          </section>

          {/* Voice */}
          <section>
            <h2 className="px-1 mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Matt's voice</h2>
            <p className="px-1 mb-3 text-[12.5px] text-slate-400 leading-relaxed">The voice Matt answers with when you choose Talk back.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Matt's voice">
              {VOICES.map(v => {
                const on = draft === v.id;
                const p = preview?.id === v.id ? preview.state : null;
                return (
                  <div
                    key={v.id}
                    role="radio"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => pick(v.id)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick(v.id))}
                    className={`mx-card p-3.5 flex items-center gap-3 cursor-pointer transition ${on ? 'ring-2 ring-violet-400/70' : 'hover:bg-white/[0.04]'}`}
                  >
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white' : 'bg-white/[0.06] text-slate-400'}`}>
                      <UserRound className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-100">{v.label}</span>
                      <span className="block text-[12px] text-slate-400">{v.desc}</span>
                    </span>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        hear(v.id);
                      }}
                      aria-label={p ? `Stop the ${v.label.toLowerCase()} sample` : `Hear the ${v.label.toLowerCase()} voice`}
                      title={p ? 'Stop' : 'Hear it'}
                      className="h-8 px-3 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[12px] text-slate-200 inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      {p === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : p === 'playing' ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3.5 h-3.5" />}
                      {p === 'playing' ? 'Stop' : 'Hear it'}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={save}
                disabled={!dirty}
                className="h-10 px-5 rounded-full bg-violet-500 hover:bg-violet-400 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-violet-500 cursor-pointer disabled:cursor-default"
              >
                <Save className="w-4 h-4" /> Save
              </button>
              <span className="text-[12px] text-slate-400" aria-live="polite">
                {dirty ? (
                  `Not saved yet. Matt still uses the ${voice} voice.`
                ) : saved ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <Check className="w-3.5 h-3.5" /> Saved. Matt now talks with the {voice} voice.
                  </span>
                ) : (
                  `Matt talks with the ${voice} voice.`
                )}
              </span>
            </div>
            {note && (
              <p className="mt-3 px-1 text-[12px] text-amber-200 inline-flex items-center gap-1.5" role="alert">
                <Lock className="w-3.5 h-3.5" /> {note}
              </p>
            )}
            {!voiceAllowed && !note && (
              <p className="mt-3 px-1 text-[12px] text-slate-400 inline-flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-amber-300" /> Talking with Matt is part of Pro. Your choice is saved for when you upgrade.
              </p>
            )}
          </section>

          <p className="px-1 text-[11.5px] text-slate-500">These settings are saved on this device.</p>
        </div>
      </div>
    </div>
  );
};
