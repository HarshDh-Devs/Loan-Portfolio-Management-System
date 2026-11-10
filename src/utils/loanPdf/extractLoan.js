// Runs the whole document → loan terms pipeline:
//   1. read files in the browser (text pages and scanned pages)
//   2. text pages → gpt-oss (one compact request)
//   3. scanned pages → vision model, 2 pages per request, only if key terms are still missing
//   4. clean every value (numbers, dates, enums) and merge the results

import { askAI } from '../../lib/ai'
import { readDocuments } from './readDocuments'
import { buildDocumentText, fullText } from './prepareText'
import { FIELD_DEFS, LOAN_SCHEMA, SYSTEM_PROMPT, textUserMessage, visionUserText } from './prompt'

const CORE_FIELDS = ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']
const TEXT_BUDGET_CHARS = 8_000 // ≈ 2,500 tokens: with the rules, format and answer this fits Groq's free 8K tokens/minute
const MIN_BUDGET_CHARS = 3_000
const MAX_VISION_PAGES = 6
const VISION_BATCH = 1 // each image counts as 2,048 tokens, so one page per request stays under 8K

// ── Value cleaning ─────────────────────────────────────────────

export function parseNumber(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  let s = String(v).toLowerCase()
  let mult = 1
  if (/crore|\bcr\b/.test(s)) mult = 1e7
  else if (/lakh|lac|\blk?\b/.test(s)) mult = 1e5
  s = s.replace(/[^\d.-]/g, '')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n * mult : null
}

export function parseDate(v) {
  if (!v) return null
  const s = String(v).trim()
  let y, mo, d, m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, mo, d] = [+m[1], +m[2], +m[3]]
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    d = +m[1]; mo = +m[2]; y = +m[3]
    if (y < 100) y += 2000
  } else return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  if (y < 1990 || y > 2100) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function cleanValue(def, value) {
  switch (def.kind) {
    case 'number': {
      const n = parseNumber(value)
      return n != null && n >= 0 ? Math.round(n * 100) / 100 : null
    }
    case 'integer': {
      const n = parseNumber(value)
      return n != null && n >= 0 ? Math.round(n) : null
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : null
    case 'date':
      return parseDate(value)
    case 'enum':
      return def.values.includes(value) && !/^unknown$/i.test(value) ? value : null
    default: {
      const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value)
      return s && !/^(null|n\/?a|not (stated|available|mentioned))$/i.test(s) ? s.slice(0, 120) : null
    }
  }
}

function cleanQuote(q) {
  return typeof q === 'string' && q.trim() ? q.trim().replace(/\s+/g, ' ').slice(0, 220) : null
}

export function normalizeResult(raw, source) {
  const fields = {}
  for (const [key, def] of Object.entries(FIELD_DEFS)) {
    const f = raw?.[key] || {}
    const value = cleanValue(def, f.value)
    fields[key] = value == null ? null : {
      value,
      page: Number.isInteger(f.page) ? f.page : null,
      quote: cleanQuote(f.quote),
      source,
    }
  }

  const otherCharges = (Array.isArray(raw?.otherCharges) ? raw.otherCharges : [])
    .map(c => ({
      name: cleanValue({ kind: 'string' }, c?.name) || 'Other charge',
      amount: cleanValue({ kind: 'number' }, c?.amount),
      page: Number.isInteger(c?.page) ? c.page : null,
      quote: cleanQuote(c?.quote),
      source,
    }))
    .filter(c => c.amount > 0)

  const s = raw?.schedule || {}
  const num = v => cleanValue({ kind: 'number' }, v)
  const schedule = {
    found: s.found === true,
    page: Number.isInteger(s.page) ? s.page : null,
    firstDate: parseDate(s.firstDate),
    firstOpeningBalance: num(s.firstOpeningBalance),
    firstInterest: num(s.firstInterest),
    firstPrincipal: num(s.firstPrincipal),
    firstInstallment: num(s.firstInstallment),
    installmentCount: cleanValue({ kind: 'integer' }, s.installmentCount),
  }

  return {
    documentType: typeof raw?.documentType === 'string' ? raw.documentType : 'other_loan_document',
    fields,
    otherCharges,
    schedule,
    notes: (Array.isArray(raw?.notes) ? raw.notes : []).filter(n => typeof n === 'string' && n.trim()).slice(0, 3),
  }
}

function betterDocType(a, b) {
  const weak = ['not_a_loan_document', 'other_loan_document']
  return weak.includes(a) && !weak.includes(b) ? b : a
}

export function mergeResults(a, b) {
  if (!a) return b
  if (!b) return a
  const fields = {}
  for (const key of Object.keys(FIELD_DEFS)) fields[key] = a.fields[key] ?? b.fields[key] ?? null
  const otherCharges = [...a.otherCharges]
  for (const c of b.otherCharges) {
    if (!otherCharges.some(x => x.name.toLowerCase() === c.name.toLowerCase() || x.amount === c.amount)) otherCharges.push(c)
  }
  return {
    documentType: betterDocType(a.documentType, b.documentType),
    fields,
    otherCharges,
    schedule: a.schedule.found ? a.schedule : b.schedule,
    notes: [...new Set([...a.notes, ...b.notes])].slice(0, 4),
  }
}

function missingCore(result) {
  return !result || CORE_FIELDS.some(k => !result.fields[k])
}

function isTooLarge(err) {
  return err?.status === 413 || /too_large|request_too_large|context_length/.test(err?.code || '') ||
    /too large|reduce the length|context length|maximum context/i.test(err?.message || '')
}

/**
 * @param {File[]} files
 * @param {object} opts
 * @param {(info:{fileName:string, incorrect:boolean}) => Promise<string|null>} opts.askPassword
 * @param {(msg:string) => void} [opts.onStatus]
 * @param {AbortSignal} [opts.signal]
 */
export async function extractLoan(files, { askPassword, onStatus, signal } = {}) {
  const doc = await readDocuments(files, { askPassword, onStatus })
  try {
    if (!doc.pages.length) {
      throw new Error(doc.skipped[0] || 'No readable pages were found in these files.')
    }
    const textPages = doc.pages.filter(p => !p.scanned)
    const scanPages = doc.pages.filter(p => p.scanned)
    const onWait = (s) => onStatus?.(`Groq's free per-minute limit reached — continuing in ${s} seconds…`)
    const notes = []
    let result = null
    const usedPageIds = []

    if (textPages.length) {
      let budget = TEXT_BUDGET_CHARS
      for (;;) {
        const built = buildDocumentText(textPages, budget)
        const n = built.includedPageIds.length
        onStatus?.(`Reading the loan terms with AI (${n} page${n === 1 ? '' : 's'})…`)
        try {
          const raw = await askAI({
            task: 'loan-text',
            schema: LOAN_SCHEMA,
            schemaName: 'loan_terms',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: textUserMessage(built.text) },
            ],
            signal,
            onWait,
          })
          result = normalizeResult(raw, 'text')
          usedPageIds.push(...built.includedPageIds)
          break
        } catch (err) {
          if (isTooLarge(err)) {
            // Send less of the document — but only if there is actually less to send.
            const next = Math.max(MIN_BUDGET_CHARS, Math.round(Math.min(budget, built.text.length) * 0.6))
            if (next < budget && next < built.text.length) {
              budget = next
              continue
            }
            throw new Error("This document is too big for Groq's free limit in one request. Try uploading only the Key Fact Statement or sanction letter pages.")
          }
          throw err
        }
      }
    }

    if (scanPages.length && missingCore(result)) {
      const queue = scanPages.slice(0, MAX_VISION_PAGES)
      try {
        for (let i = 0; i < queue.length; i += VISION_BATCH) {
          const batch = queue.slice(i, i + VISION_BATCH)
          onStatus?.(`Preparing scanned page${batch.length > 1 ? 's' : ''} ${batch.map(p => p.id).join(' & ')}…`)
          const images = []
          for (const p of batch) images.push(await p.getImage())
          onStatus?.(`Reading scanned page${batch.length > 1 ? 's' : ''} ${batch.map(p => p.id).join(' & ')} with AI…`)
          const raw = await askAI({
            task: 'loan-vision',
            schema: LOAN_SCHEMA,
            schemaName: 'loan_terms',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: visionUserText(batch) },
                  ...images.map(url => ({ type: 'image_url', image_url: { url } })),
                ],
              },
            ],
            signal,
            onWait,
          })
          result = mergeResults(result, normalizeResult(raw, 'vision'))
          usedPageIds.push(...batch.map(p => p.id))
          if (!missingCore(result)) break
        }
        if (scanPages.length > MAX_VISION_PAGES && missingCore(result)) {
          notes.push(`Only the first ${MAX_VISION_PAGES} scanned pages were read.`)
        }
      } catch (err) {
        if (err?.name === 'AbortError' || !result) throw err
        notes.push(`Scanned pages could not be read: ${err.message}`)
      }
    }

    return {
      ...result,
      notes: [...(result?.notes || []), ...notes],
      pages: doc.pages.map(p => ({ id: p.id, fileName: p.fileName, pageNo: p.pageNo, scanned: p.scanned })),
      files: doc.files,
      skipped: doc.skipped,
      usedPageIds,
      sourceText: fullText(textPages),
    }
  } finally {
    doc.cleanup()
  }
}
