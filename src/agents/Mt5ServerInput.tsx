import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/apiClient';
import { MT5_BROKER_SERVERS, suggestMt5Servers } from '../utils/mt5Servers';

/** MT5 server box with suggestions: common brokers' servers at once, then the live server directory as the trader types */
export const Mt5ServerInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Array<{ broker: string; server: string }>>([]);
  const [active, setActive] = useState(-1);
  const local = useMemo(
    () => (value.trim() ? suggestMt5Servers(value, 12) : MT5_BROKER_SERVERS.slice(0, 10).map(b => ({ broker: b.broker, server: b.servers[0] }))),
    [value]
  );
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return setLive([]);
    const t = setTimeout(() => {
      apiFetch<{ servers: Array<{ broker: string; server: string }> }>(`/api/agent/mt5/servers?q=${encodeURIComponent(q)}`)
        .then(r => setLive(r.servers || []))
        .catch(() => setLive([]));
    }, 300);
    return () => clearTimeout(t);
  }, [value]);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...local, ...live].filter(x => {
      const k = x.server.toLowerCase();
      if (seen.has(k) || k === value.trim().toLowerCase()) return false;
      seen.add(k);
      return true;
    }).slice(0, 12);
  }, [local, live, value]);
  const pick = (server: string) => {
    onChange(server);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => {
          onChange(e.target.value.slice(0, 80));
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive(i => Math.min(items.length - 1, i + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(i => Math.max(0, i - 1)));
          else if (e.key === 'Enter' && active >= 0) (e.preventDefault(), pick(items[active].server));
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Server, e.g. Exness-MT5Real8"
        aria-label="MT5 server"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        className="ag-input w-full"
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-30 left-0 right-0 sm:right-auto sm:min-w-[260px] mt-1 max-h-60 overflow-y-auto rounded-xl border border-white/[0.1] bg-[var(--mx-surface-2,#141821)] shadow-xl py-1">
          {!value.trim() && <li className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">Popular brokers · type to search</li>}
          {items.map((x, i) => (
            <li key={x.server} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(x.server)}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
              >
                <span className="text-[13px] text-white truncate">{x.server}</span>
                {x.broker && <span className="text-[10px] text-slate-500 shrink-0">{x.broker}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
