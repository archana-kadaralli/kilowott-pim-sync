import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createWooMiddleware } from './server/woo-api.mjs'

function wooApiPlugin(env) {
  return {
    name: 'kilowott-woo-api-proxy',
    configureServer(server) {
      server.middlewares.use(createWooMiddleware({ env }))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createWooMiddleware({ env }))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), wooApiPlugin(env)],
    // The app is same-origin and the sync proxy handles its own request
    // guards; Vite's CORS middleware would otherwise answer cross-origin
    // preflights before the proxy can reject them.
    server: { cors: false },
    preview: { cors: false },
  }
})
