// Serve the real editor routes on a real socket, for manual and scripted checks.
// Usage: node tools/serve-editor.mjs [port] [dshHome]
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { registerRoutes } from '../lib/api.js'
import { resolveConfig } from '../lib/rules.js'
import { ensureStore } from '../lib/store.js'

const port = Number(process.argv[2] ?? 8799)
const dshHome = process.argv[3] ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
const config = resolveConfig({ dshHome })
mkdirSync(config.storeDirectory, { recursive: true })
ensureStore(config)

const routes = []
const ctx = {
  get: () => ({
    register(route) {
      routes.push(route)
      return () => {}
    },
  }),
  effect(factory) { factory(); return () => {} },
  logger: { warn: (message) => console.error('[warn]', message) },
}
const registered = registerRoutes(ctx, { config, invalidate: () => {} })

const matches = (path) => {
  const exact = routes.find(route => route.kind === 'exact' && route.path === path)
  if (exact) return exact
  return routes
    .filter(route => route.kind === 'prefix' && path.startsWith(route.path))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
  const route = matches(path)
  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`no route for ${path}\nknown: ${routes.map(r => r.path).join(', ')}\n`)
    return
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(error?.stack ?? error))
  })
})

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/rules`
  process.stdout.write(`editor: ${url}\nroutes: ${registered}\nstore: ${config.storeDirectory}\n`)
})
