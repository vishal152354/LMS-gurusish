import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The FastAPI backend serves the API on :7860. In development every API path is
// proxied there, so the app can use relative URLs and avoid CORS entirely.
// In staging/production the API lives on its own origin (VITE_API_BASE_URL).
const API_PREFIXES = ['/student', '/professor', '/orchestrator', '/audio', '/health']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:7860'
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
    server: {
      port: 5173,
      // /student/... and /professor/... are also app routes — a browser page load
      // (Accept: text/html) gets the SPA; API calls (XHR/fetch) go to FastAPI.
      proxy: Object.fromEntries(API_PREFIXES.map((p) => [p, {
        target,
        changeOrigin: true,
        bypass: (req: { headers: { accept?: string } }) => (req.headers.accept?.includes('text/html') ? '/index.html' : undefined),
      }])),
    },
    build: {
      sourcemap: mode !== 'production',
      rollupOptions: {
        output: {
          // Long-lived vendor chunks, grouped by package, so app releases don't bust them
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (/node_modules\/(react|react-dom|scheduler|react-router)\//.test(id)) return 'vendor-react'
            if (/node_modules\/(@reduxjs|react-redux|redux|redux-persist|immer|reselect)/.test(id)) return 'vendor-state'
            if (/node_modules\/(zod|react-hook-form|@hookform)\//.test(id)) return 'vendor-forms'
            if (/node_modules\/(recharts|d3-|victory-vendor|recharts-scale)/.test(id)) return 'vendor-charts'
            if (/node_modules\/(socket\.io|engine\.io)/.test(id)) return 'vendor-socket'
            if (/node_modules\/@radix-ui\//.test(id)) return 'vendor-radix'
            if (/node_modules\/@dnd-kit\//.test(id)) return 'vendor-dnd'
          },
        },
      },
    },
  }
})
