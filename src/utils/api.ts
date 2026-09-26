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
  (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_API_URL || import.meta.env?.VITE_BACKEND_URL)) ||
  ''
).replace(/\/+$/, '');

export function getApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (!API_BASE_URL) return cleanEndpoint;
  return `${API_BASE_URL}${cleanEndpoint}`;
}
