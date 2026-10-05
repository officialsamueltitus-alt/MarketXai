import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Oldest browsers the CSS must render correctly on. iPhones/iPads on iOS 14–16.3 lack oklch()/color-mix()/
// @property, which Tailwind v4 uses; Lightning CSS adds plain-colour fallbacks, flattens nesting and adds
// -webkit- prefixes for these targets. (major << 16 | minor << 8)
const cssTargets = {
  safari: 14 << 16,
  ios_saf: 14 << 16,
  chrome: 87 << 16,
  edge: 88 << 16,
  firefox: 78 << 16,
  samsung: 14 << 16,
};

export default defineConfig(({ mode }) => {
  return {
    plugins: [react(), tailwindcss()],
    // Production: no console output in the browser (nothing about the app's internals in DevTools)
    esbuild: mode === 'production' ? { drop: ['console' as const, 'debugger' as const], legalComments: 'none' as const } : undefined,
    css: {
      transformer: 'lightningcss' as const,
      lightningcss: { targets: cssTargets },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '/src': path.resolve(__dirname, './src'),
      },
    },
    build: {
      sourcemap: false, // Security: seal raw source code and engine models from browser DevTools / inspect
      minify: 'esbuild' as const,
      // JS syntax for Safari 14+ (iOS 14+), matching the CSS targets
      target: ['es2020', 'safari14', 'chrome87', 'edge88', 'firefox78'],
      cssMinify: 'lightningcss' as const,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          // Stable vendor chunks cache across deploys; Markdown and modals are split out and load on demand
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
            if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
