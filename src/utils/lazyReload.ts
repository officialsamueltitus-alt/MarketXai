import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

// Screens that load on demand (modals, Markdown) live in content-hashed files. A phone can keep an old copy of the
// site open for days; after a new deploy those old files no longer exist, so opening a modal would fail. These
// helpers retry once, then reload the page onto the new version (at most once every 30 seconds, so never a loop).

const RELOAD_KEY = 'mx_chunk_reload_at';

export function isChunkLoadError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load module script|ChunkLoadError|Loading chunk .* failed|Unable to preload CSS/i.test(msg);
}

/** Reloads the page to pick up the newest version. Returns false if it already did so moments ago. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    const w = window as any;
    if (w.__mxChunkReloaded) return false;
    w.__mxChunkReloaded = true;
  }
  window.location.reload();
  return true;
}

export type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  preload: () => Promise<unknown>;
  /** The component itself once downloaded (renders without a Suspense round trip), else null */
  loaded: () => T | null;
};

/** React.lazy that survives a new deploy and can be preloaded ahead of the first tap. */
export function lazyWithReload<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>): PreloadableComponent<T> {
  let pending: Promise<{ default: T }> | null = null;
  let done: T | null = null;
  // Download (shared by preload and render); a flaky mobile connection often succeeds on the second try
  const attempt = (): Promise<{ default: T }> =>
    (pending ??= factory()
      .catch(() =>
        factory().catch(err => {
          pending = null;
          throw err;
        })
      )
      .then(m => ((done = m.default), m)));
  // Only a screen the user actually opens may reload the page; a failed background preload stays silent
  const Component = lazy(() =>
    attempt().catch(err => {
      if (isChunkLoadError(err) && reloadForNewVersion()) return new Promise<{ default: T }>(() => {});
      throw err;
    })
  ) as PreloadableComponent<T>;
  Component.preload = () => attempt().catch(() => {});
  Component.loaded = () => done;
  return Component;
}
