import React, { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string;
  /** Called after the server has deleted the account (clears local state) */
  onDeleted: () => void;
}

// Permanent account deletion: password (for email accounts) plus typing DELETE
export const DeleteAccountModal: React.FC<DeleteAccountModalProps> = ({ isOpen, onClose, email, onDeleted }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setConfirm('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;
  const ready = confirm.trim().toUpperCase() === 'DELETE' && !busy;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/account/delete', { method: 'POST', body: JSON.stringify({ confirm: 'DELETE', password }) });
      onDeleted();
    } catch (err: any) {
      setError(err?.message || 'Could not delete your account. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Delete account">
      <button type="button" aria-label="Cancel" onClick={onClose} className="absolute inset-0 bg-black/70 mx-fade-in cursor-default" />
      <form
        onSubmit={submit}
        className="mx-pop-in relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[var(--mx-surface)] border border-white/[0.08] p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
        <span className="w-11 h-11 rounded-2xl bg-rose-500/15 text-rose-300 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5" />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-white">Delete your account?</h2>
        <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
          This permanently erases your chats, saved setups, credits, rewards and notifications. An active Pro plan ends with no refund. This can't be
          undone.
        </p>

        <label className="block mt-5 text-xs font-medium text-slate-300" htmlFor="del-password">
          Password
        </label>
        <input
          id="del-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Your password"
          className="mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-white/25"
        />
        <p className="mt-1 text-[11px] text-slate-500">Signed up with Google? Leave this empty.</p>

        <label className="block mt-4 text-xs font-medium text-slate-300" htmlFor="del-confirm">
          Type <span className="font-mono text-rose-300">DELETE</span> to confirm
        </label>
        <input
          id="del-confirm"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          className="mt-1.5 w-full h-11 px-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white font-mono focus:outline-none focus:border-white/25"
        />

        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}

        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-full sm:flex-1 rounded-xl border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.05] cursor-pointer"
          >
            Keep my account
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="h-11 w-full sm:flex-1 rounded-xl bg-rose-600 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Delete forever
          </button>
        </div>
        <p className="mt-3 text-[11px] text-slate-500 text-center">A confirmation will be sent to {email}.</p>
      </form>
    </div>
  );
};
