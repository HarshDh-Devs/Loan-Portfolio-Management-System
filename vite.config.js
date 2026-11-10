/* global process, Buffer */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Runs the Vercel functions in /api during `npm run dev`, so AI features
// work locally too. (On Vercel these files are deployed as server functions.)
function vercelApiInDev() {
  return {
    name: 'vercel-api-in-dev',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost')
        const match = url.pathname.match(/^\/api\/([\w-]+)\/?$/)
        if (!match) return next()

        let mod
        try {
          mod = await server.ssrLoadModule(`/api/${match[1]}.js`)
        } catch {
          return next()
        }

        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks).toString('utf8')
        req.body = raw
        if (raw && /application\/json/.test(req.headers['content-type'] || '')) {
          try { req.body = JSON.parse(raw) } catch { /* leave as text */ }
        }
        req.query = Object.fromEntries(url.searchParams)
        res.status = (code) => { res.statusCode = code; return res }
        res.json = (obj) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(obj))
          return res
        }

        try {
          await mod.default(req, res)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Make .env / .env.local values (e.g. GROQ_API_KEY) visible to the /api functions in dev.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return {
    plugins: [react(), vercelApiInDev()],
  }
})
