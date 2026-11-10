/* global process */
// api/ai.js
// One server route for every AI feature. The Groq key stays on the server,
// and each feature ("task") is pinned to its own model, so a busy feature
// can't use up another feature's free per-model limit.
//
// To change a model later, edit TASKS below — nothing else needs to change.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

const TASKS = {
  // Reading loan documents that have real text in them.
  'loan-text': {
    model: 'openai/gpt-oss-120b',
    temperature: 0,
    reasoning_effort: 'low', // copying values needs little reasoning; saves free tokens
    include_reasoning: false,
    maxTokens: 2600,
  },
  // Reading scanned / photographed loan documents (page images).
  'loan-vision': {
    model: 'qwen/qwen3.8-27b',
    temperature: 0,
    reasoning_effort: 'none',
    reasoning_format: 'hidden',
    maxTokens: 2000,
    allowImages: true,
  },
  // Insights page: portfolio analysis and loan comparison.
  insights: {
    model: 'openai/gpt-oss-120b',
    temperature: 0.3,
    reasoning_effort: 'low',
    include_reasoning: false,
    maxTokens: 3500,
  },
  // Card Insights page: summarising public Reddit posts.
  'card-intel': {
    model: 'openai/gpt-oss-20b',
    temperature: 0.2,
    reasoning_effort: 'low',
    include_reasoning: false,
    maxTokens: 2500,
  },
}

// Optional parameters Groq may reject on some models. If Groq says one of
// these is unsupported, the request is retried once without it.
const OPTIONAL_PARAMS = ['reasoning_effort', 'reasoning_format', 'include_reasoning']

const MAX_BODY_CHARS = 4_000_000 // stay under Vercel's 4.5 MB request limit
const MAX_IMAGES = 3

export const config = { maxDuration: 60 }

function parseRetryAfter(headers) {
  const direct = Number(headers.get('retry-after'))
  if (Number.isFinite(direct) && direct > 0) return Math.ceil(direct)
  // e.g. "7.66s", "2m59.56s", "1h2m3s"
  const reset = headers.get('x-ratelimit-reset-tokens') || headers.get('x-ratelimit-reset-requests')
  if (!reset) return null
  let total = 0
  for (const [, num, unit] of reset.matchAll(/([\d.]+)(ms|h|m|s)/g)) {
    const n = Number(num)
    total += unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : unit === 's' ? n : n / 1000
  }
  return total > 0 ? Math.ceil(total) : null
}

function countImages(messages) {
  let n = 0
  for (const m of messages) {
    if (Array.isArray(m.content)) n += m.content.filter(p => p?.type === 'image_url').length
  }
  return n
}

function validMessages(messages) {
  return Array.isArray(messages) && messages.length > 0 && messages.length <= 12 &&
    messages.every(m => m && ['system', 'user', 'assistant'].includes(m.role) &&
      (typeof m.content === 'string' || Array.isArray(m.content)))
}

async function callGroq(key, payload) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  let data = null
  try { data = await response.json() } catch { /* non-JSON error page */ }
  return { response, data }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const key = process.env.GROQ_API_KEY || process.env.VITE_GROQ_API_KEY
  if (!key) {
    return res.status(500).json({
      error: 'The AI key is not set up yet. Add GROQ_API_KEY in Vercel → Settings → Environment Variables.',
      code: 'missing_key',
    })
  }

  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  const { task, messages, schema, schemaName, maxTokens } = body || {}

  const cfg = TASKS[task]
  if (!cfg) return res.status(400).json({ error: `Unknown AI task "${task}"` })
  if (!validMessages(messages)) return res.status(400).json({ error: 'Invalid messages' })

  const images = countImages(messages)
  if (images > 0 && !cfg.allowImages) return res.status(400).json({ error: 'This task does not accept images' })
  if (images > MAX_IMAGES) return res.status(400).json({ error: `At most ${MAX_IMAGES} images per request` })
  if (JSON.stringify(messages).length > MAX_BODY_CHARS) {
    return res.status(413).json({ error: 'The document is too large to send in one request.', code: 'too_large' })
  }

  const payload = {
    model: cfg.model,
    messages,
    temperature: cfg.temperature,
    max_completion_tokens: Math.min(Number(maxTokens) || cfg.maxTokens, cfg.maxTokens),
  }
  for (const p of OPTIONAL_PARAMS) if (cfg[p] !== undefined) payload[p] = cfg[p]
  if (schema && typeof schema === 'object') {
    payload.response_format = {
      type: 'json_schema',
      json_schema: { name: String(schemaName || 'result').replace(/[^\w-]/g, '_').slice(0, 60), strict: true, schema },
    }
  }

  try {
    let { response, data } = await callGroq(key, payload)

    // Recover from 400s that are about request options, not the content:
    //  • an optional parameter this model doesn't accept → drop it
    //  • strict JSON schema not accepted (e.g. with images) → plain JSON mode
    //  • the model's JSON failed validation → try once more
    for (let attempt = 0; attempt < 3 && response.status === 400; attempt++) {
      const msg = String(data?.error?.message || '')
      const bad = OPTIONAL_PARAMS.filter(p => p in payload && msg.includes(p))
      if (bad.length) {
        bad.forEach(p => delete payload[p])
      } else if (payload.response_format?.type === 'json_schema' && /json_schema|response_format|structured output/i.test(msg)) {
        payload.response_format = { type: 'json_object' }
        payload.messages = [
          ...payload.messages,
          { role: 'system', content: `Reply with one JSON object that matches this JSON schema exactly:\n${JSON.stringify(schema)}` },
        ]
      } else if (data?.error?.code !== 'json_validate_failed') {
        break
      }
      ;({ response, data } = await callGroq(key, payload))
    }

    if (!response.ok) {
      const status = response.status
      const message = data?.error?.message || `Groq returned an error (${status})`
      const code = data?.error?.code || (status === 429 ? 'rate_limited' : status === 413 ? 'too_large' : 'groq_error')
      return res.status(status).json({ error: message, code, retryAfter: status === 429 ? parseRetryAfter(response.headers) : null })
    }

    const choice = data?.choices?.[0]
    const content = choice?.message?.content ?? ''
    if (choice?.finish_reason === 'length') {
      return res.status(502).json({ error: 'The AI ran out of room before finishing its answer.', code: 'truncated' })
    }
    return res.status(200).json({ content, model: data?.model || cfg.model, usage: data?.usage || null })
  } catch (err) {
    return res.status(502).json({ error: 'Could not reach Groq: ' + err.message, code: 'network' })
  }
}
