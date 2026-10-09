import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A remote dev server (Amp orb portal, tunnel, ...) receives requests with its
// public hostname, which Vite blocks by default. Set VITE_ALLOWED_HOSTS to a
// comma-separated allowlist to opt in; a leading dot matches subdomains
// (e.g. ".onamp.dev"). Local development keeps Vite's default localhost rules.
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

export default defineConfig({
  plugins: [react()],
  server: {
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
    proxy: {
      '/auth': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})

