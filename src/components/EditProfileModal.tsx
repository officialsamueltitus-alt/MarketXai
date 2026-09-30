import React, { useState, useRef, useEffect } from 'react';
import { UserProfile } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import {
  X,
  Upload,
  Image as ImageIcon,
  Check,
  User,
  Trash2,
  Sparkles,
  ClipboardPaste,
  Camera
} from 'lucide-react';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onSave: (updated: { displayName: string; username: string; avatarUrl?: string }) => Promise<string | null>;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  onSave,
}) => {
  const [displayName, setDisplayName] = useState(userProfile.displayName || '');
  const [username, setUsername] = useState(userProfile.username || '');
  const [isSaving, setIsSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | undefined>(userProfile.avatarUrl);
  const [dragActive, setDragActive] = useState(false);
  const [pasteSuccess, setPasteSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when opened
  useEffect(() => {
    if (isOpen) {
      setDisplayName(userProfile.displayName || '');
      setUsername(userProfile.username || '');
      setAvatarPreview(userProfile.avatarUrl);
      setError(null);
      setPasteSuccess(false);
    }
  }, [isOpen, userProfile]);

  // Global paste handler when modal is open
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            processImageFile(file);
            setPasteSuccess(true);
            setTimeout(() => setPasteSuccess(false), 2500);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [isOpen]);

  if (!isOpen) return null;

  // Process image file and scale down to 256x256 to protect localStorage quota
  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Selected file is not an image');
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      setError('Image is too large. Please select an image under 8MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const rawDataUrl = loadEvent.target?.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 256;
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxDim) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            setAvatarPreview(optimizedDataUrl);
            setError(null);
          } else {
            setAvatarPreview(rawDataUrl);
            setError(null);
          }
        } catch {
          setAvatarPreview(rawDataUrl);
          setError(null);
        }
      };
      img.onerror = () => {
        setError('Failed to process image');
      };
      img.src = rawDataUrl;
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImageFile(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanUsername = username.trim().toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_]/g, '');
    if (cleanUsername.length < 3) {
      setError('Username must be at least 3 characters (letters, numbers, underscores)');
      return;
    }

    const cleanDisplayName = displayName.trim() || 'MarketX Trader';

    setIsSaving(true);
    const saveError = await onSave({
      displayName: cleanDisplayName,
      username: cleanUsername,
      avatarUrl: avatarPreview,
    });
    setIsSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="relative w-full max-w-md my-auto rounded-3xl bg-[var(--mx-bg)] border border-white/[0.12] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Top Header Background Glow */}
        <div className="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-indigo-600/20 via-cyan-500/10 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white border border-white/[0.1] transition-all cursor-pointer z-20"
          title="Close Modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto relative z-10 flex-1">
          {/* Header */}
          <div className="text-center space-y-1">
            <h3 className="text-lg sm:text-xl font-bold text-white">Edit Trader Profile</h3>
            <p className="text-xs text-slate-400">
              Customize your display name, username, and profile picture
            </p>
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs text-center font-medium">
              {error}
            </div>
          )}

          {pasteSuccess && (
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs text-center font-medium flex items-center justify-center gap-1.5 animate-fadeIn">
              <Check className="w-3.5 h-3.5" />
              <span>Image pasted from clipboard successfully!</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Profile Picture Section */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 block">
                Profile Picture:
              </label>

              {/* Avatar Preview & Quick Actions */}
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-black/40 border border-white/[0.08]">
                <div className="relative shrink-0">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold text-xl shadow-md border-2 border-white/20">
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span>{(username || 'T').substring(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  {userProfile.isVerified && (
                    <div className="absolute -bottom-1 -right-1">
                      <VerifiedBadge size="sm" />
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Upload Gallery</span>
                    </button>

                    {avatarPreview && (
                      <button
                        type="button"
                        onClick={() => setAvatarPreview(undefined)}
                        className="px-2 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                        title="Remove custom photo"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 block truncate">
                    PNG, JPG, WEBP, or GIF up to 4MB
                  </span>
                </div>
              </div>

              {/* Hidden File Input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {/* Display Name Input */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Display Name:
              </label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="e.g. Satoshi Trader"
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-white text-xs font-medium placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                required
              />
            </div>

            {/* Username Input */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300 block">
                Username (@handle):
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                  @
                </span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                  placeholder="username"
                  className="w-full pl-7 pr-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-white text-xs font-mono placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                  required
                />
              </div>
              <span className="text-[10px] text-slate-400 block px-1">
                Used to receive SI credit gifts and identify your market setups.
              </span>
            </div>

            {/* Submit & Cancel Buttons */}
            <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-300 text-xs font-semibold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="disabled:opacity-60 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer active:scale-98"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Changes</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
