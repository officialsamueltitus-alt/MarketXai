// Paystack's inline checkout, shared by the Plans window and the Trading Agent subscription
let paystackLoading: Promise<void> | null = null;
/** Injects Paystack's inline checkout script once (resolves when ready, rejects after 10s or on error). */
export function loadPaystack(): Promise<void> {
  if (typeof window === 'undefined' || (window as any).PaystackPop) return Promise.resolve();
  if (paystackLoading) return paystackLoading;
  paystackLoading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://js.paystack.co/v1/inline.js';
    el.async = true;
    const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      paystackLoading = null;
      el.remove();
      reject(new Error('failed'));
    };
    document.head.appendChild(el);
  });
  return paystackLoading;
}


declare global {
  interface Window {
    PaystackPop?: {
      setup: (options: {
        key: string;
        email: string;
        amount: number; // in lowest currency unit, e.g. cents
        currency?: string;
        ref?: string;
        channels?: string[];
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      }) => {
        openIframe: () => void;
      };
    };
  }
}

export {};
