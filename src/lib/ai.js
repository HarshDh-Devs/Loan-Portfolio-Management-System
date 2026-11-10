// Browser-side helper for the /api/ai server route.
// Waits and retries automatically when Groq's free per-minute limit is hit.

export class AIError extends Error {
  constructor(message, { status = 0, code = null, retryAfter = null } = {}) {
    super(message)
    this.name = 'AIError'
    this.status = status
    this.code = code
    this.retryAfter = retryAfter
  }
}

const MAX_WAIT_SECONDS = 75 // longer waits mean the daily limit is used up
const MAX_RATE_RETRIES = 4

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
}

function friendlyWait(seconds) {
  if (seconds < 90) return `${seconds} seconds`
  const mins = Math.round(seconds / 60)
  if (mins < 90) return `${mins} minutes`
  return `${Math.round(mins / 60)} hours`
}

/**
 * Ask the AI. Returns the text reply, or the parsed JSON object when `schema` is given.
 *
 * @param {object} opts
 * @param {'loan-text'|'loan-vision'|'insights'|'card-intel'} opts.task
 * @param {Array} opts.messages      OpenAI-style chat messages
 * @param {object} [opts.schema]     JSON schema — the reply is guaranteed to match it
 * @param {string} [opts.schemaName]
 * @param {number} [opts.maxTokens]
 * @param {AbortSignal} [opts.signal]
 * @param {(seconds:number)=>void} [opts.onWait]  called before waiting out a rate limit
 */
export async function askAI({ task, messages, schema, schemaName, maxTokens, signal, onWait }) {
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, messages, schema, schemaName, maxTokens }),
        signal,
      })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      throw new AIError('Could not reach the AI service. Check your internet connection and try again.', { code: 'network' })
    }

    let data = null
    try { data = await res.json() } catch { /* not JSON */ }

    if (res.ok && data && typeof data.content === 'string') {
      if (!schema) return data.content
      try {
        return JSON.parse(data.content)
      } catch {
        throw new AIError('The AI sent back an answer that could not be read. Please try again.', { code: 'bad_json' })
      }
    }

    if (res.status === 429) {
      const wait = Math.max(2, Number(data?.retryAfter) || 20)
      if (wait > MAX_WAIT_SECONDS) {
        throw new AIError(`Groq's free daily limit is used up. Try again in about ${friendlyWait(wait)}.`, { status: 429, code: 'daily_limit', retryAfter: wait })
      }
      if (attempt < MAX_RATE_RETRIES) {
        onWait?.(wait)
        await sleep(wait * 1000 + 500, signal)
        continue
      }
    }

    if (res.status === 404 && !data) {
      throw new AIError('The AI service is not available here (the /api routes are not running).', { status: 404, code: 'no_api' })
    }

    let message = data?.error || `AI request failed (${res.status})`
    if (data?.code === 'model_decommissioned' || /decommission/i.test(message)) {
      message = 'The AI model used here has been retired by Groq. Update the model name in api/ai.js.'
    }
    throw new AIError(message, { status: res.status, code: data?.code || null, retryAfter: data?.retryAfter ?? null })
  }
}
