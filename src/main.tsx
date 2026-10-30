import { StrictMode, Component, ReactNode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { isChunkLoadError, lazyWithReload, reloadForNewVersion } from './utils/lazyReload';

// The admin console is its own lazily-loaded bundle, only fetched on /admin
const AdminApp = lazyWithReload(() => import('./admin/AdminApp'));
const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
// The Site Guide is a standalone page at /blog (any letter case, optional trailing slash)
const BlogPage = lazyWithReload(() => import('./blog/BlogPage'));
const isBlogRoute = /^\/blog\/?$/i.test(window.location.pathname);
if (isBlogRoute && window.location.pathname !== '/blog') {
  history.replaceState(null, '', '/blog' + window.location.search + window.location.hash);
}
// Campaign pages are standalone too (e.g. /campaigns/explain-marketx)
const ExplainCampaignPage = lazyWithReload(() => import('./campaign/ExplainCampaignPage'));
const isCampaignRoute = /^\/campaigns\/explain-marketx\/?$/i.test(window.location.pathname);
if (isCampaignRoute && window.location.pathname !== '/campaigns/explain-marketx') {
  history.replaceState(null, '', '/campaigns/explain-marketx' + window.location.search + window.location.hash);
}
// Signal proofs are public standalone pages (/proof/<id>), verified in the browser
const ProofPage = lazyWithReload(() => import('./proof/ProofPage'));
const isProofRoute = /^\/proof\/sp_[a-z0-9]{8,40}\/?$/.test(window.location.pathname);
// Public MarketX ID checker (/checker?id=<MarketX ID>)
const CheckerPage = lazyWithReload(() => import('./checker/CheckerPage'));
const isCheckerRoute = /^\/checker\/?$/i.test(window.location.pathname);
// Matt, the help assistant (/matt): an app-style full-height chat page
const MattPage = lazyWithReload(() => import('./matt/MattPage'));
const isMattRoute = /^\/matt\/?$/i.test(window.location.pathname);
if (isMattRoute) document.body.classList.remove('select-none');
// The app itself is a fixed, full-height shell (body can't scroll). The console is a normal scrolling
// page, so it gets its own document styles: native window scroll, touch momentum, selectable text.
if (isAdminRoute || isBlogRoute || isCampaignRoute || isProofRoute || isCheckerRoute) {
  document.documentElement.classList.add(isAdminRoute ? 'mx-admin-page' : 'mx-blog-page');
  document.body.classList.remove('overflow-hidden', 'select-none');
}
import './index.css';

// Older Safari / Android WebViews lack Object.hasOwn (used when rendering chat markdown)
if (!(Object as any).hasOwn) {
  (Object as any).hasOwn = (obj: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(obj, key);
}

// Never leave users on a blank screen: show what failed and offer a reload
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('MarketX crashed:', error);
    // A screen from an older deploy could not load: reload onto the new version (once) instead of showing an error
    if (isChunkLoadError(error)) reloadForNewVersion();
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#020617', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#94a3b8', marginBottom: 16 }}>MarketX hit an unexpected error. Reloading usually fixes it.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 18px', borderRadius: 12, background: '#4f46e5', color: '#fff', fontWeight: 600, border: 0 }}>
            Reload
          </button>
          <p style={{ fontSize: 11, color: '#64748b', marginTop: 16, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</p>
        </div>
      </div>
    );
  }
}

// The readable boot screen in index.html (for visitors before the app loads, and for search engines) goes once the app paints
requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('mx-boot')?.remove()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {isAdminRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <AdminApp />
        </Suspense>
      ) : isBlogRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <BlogPage />
        </Suspense>
      ) : isProofRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <ProofPage />
        </Suspense>
      ) : isCheckerRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <CheckerPage />
        </Suspense>
      ) : isMattRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <MattPage />
        </Suspense>
      ) : isCampaignRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <ExplainCampaignPage />
        </Suspense>
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);
