import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { createWooMiddleware } from './woo-api.mjs'

/**
 * Minimal standalone server for the built app.
 *
 *   npm run build && npm start
 *
 * Serves `dist/` and mounts the same WooCommerce proxy used by Vite dev/preview.
 * Reads `.env` and `.env.local` itself (values already present in the process
 * environment win, matching Vite's precedence). No external dependencies.
 */

const PORT = Number(process.env.PORT) || 4173
const DIST_DIR = path.resolve(process.cwd(), 'dist')

function loadEnvFile(file) {
  const filePath = path.resolve(process.cwd(), file)
  if (!existsSync(filePath)) return
  const text = readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator === -1) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key && !(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFile('.env')
loadEnvFile('.env.local')

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function sendText(res, status, text) {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(text)
}

function serveStatic(req, res) {
  if (!existsSync(DIST_DIR)) {
    sendText(res, 503, 'No production build found. Run "npm run build" first, then start the server again.')
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    sendText(res, 400, 'Bad request.')
    return
  }

  let filePath = path.resolve(DIST_DIR, `.${pathname}`)
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
    sendText(res, 403, 'Forbidden.')
    return
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const hasExtension = path.extname(pathname) !== ''
    if (hasExtension) {
      sendText(res, 404, 'Not found.')
      return
    }
    filePath = path.join(DIST_DIR, 'index.html')
    if (!existsSync(filePath)) {
      sendText(res, 404, 'Not found.')
      return
    }
  }

  const extension = path.extname(filePath).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME_TYPES[extension] ?? 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (pathname.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  } else {
    res.setHeader('Cache-Control', 'no-cache')
  }
  createReadStream(filePath).pipe(res)
}

const wooMiddleware = createWooMiddleware({ env: process.env })

const server = createServer((req, res) => {
  wooMiddleware(req, res, () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed.')
      return
    }
    serveStatic(req, res)
  })
})

server.listen(PORT, () => {
  console.log(`PIM Sync server ready: http://localhost:${PORT}`)
  console.log(`WooCommerce proxy mounted at /api/woo (reads .env / .env.local, no browser credentials)`)
})
