/**
 * API Configuration & Endpoint Resolver
 *
 * Supports:
 * 1. Monolithic / Integrated deployment (relative '/api/*')
 * 2. Static Site + Render Backend deployment:
 *    Configure `VITE_API_URL` (or `VITE_BACKEND_URL`) on your static site host (e.g. Render, Vercel, Netlify)
 *    Example: VITE_API_URL=https://marketx-backend.onrender.com
 */

export const API_BASE_URL = (
  // Read statically, so Vite inlines the value at build time and no setting name ships in the bundle
  ((import.meta.env.VITE_API_URL as string | undefined) || (import.meta.env.VITE_BACKEND_URL as string | undefined) || '')
).replace(/\/+$/, '');

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!API_BASE_URL) return cleanEndpoint;
  return `${API_BASE_URL}${cleanEndpoint}`;
}
