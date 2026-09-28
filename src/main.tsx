import { StrictMode, Component, ReactNode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

// The admin console is its own lazily-loaded bundle, only fetched on /admin
const AdminApp = lazy(() => import('./admin/AdminApp'));
const isAdminRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/');
// The app itself is a fixed, full-height shell (body can't scroll). The console is a normal scrolling
// page, so it gets its own document styles: native window scroll, touch momentum, selectable text.
if (isAdminRoute) {
  document.documentElement.classList.add('mx-admin-page');
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {isAdminRoute ? (
        <Suspense fallback={<div className="mx-backdrop min-h-[100dvh]" />}>
          <AdminApp />
        </Suspense>
      ) : (
        <App />
      )}
    </AppErrorBoundary>
  </StrictMode>,
);
