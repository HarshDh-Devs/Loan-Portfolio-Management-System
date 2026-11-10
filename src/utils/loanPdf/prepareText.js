// Turns text pages into one compact document for the AI, within Groq's free
// per-request size. Keeps every line that carries loan facts; drops repeated
// headers/footers and long legal paragraphs; shortens long repayment tables
// (keeping the first and last rows); and, if still too long, keeps the pages
// with the most loan terms.

const TERM_PATTERNS = [
  [/key\s*fact|\bkfs\b/i, 6],
  [/sanction/i, 3],
  [/rate of interest|interest rate|\broi\b|per annum|p\.\s?a\./i, 3],
  [/\bemi\b|equated|instal+ment/i, 3],
  [/tenure|tenor|no\.? of (emis|instal)/i, 3],
  [/loan amount|amount of (the )?loan|sanctioned amount|principal/i, 3],
  [/disburs/i, 2],
  [/processing fee|login fee|documentation|stamp duty|insurance|charges/i, 2],
  [/fore-?clos|pre-?clos|pre-?pay|part[\s-]?pay|lock[\s-]?in/i, 3],
  [/annual percentage rate|\bapr\b/i, 3],
  [/repayment schedule|amorti[sz]ation/i, 2],
  [/floating|fixed rate|benchmark|spread|repo|mclr|ebl?r/i, 1],
  [/loan account|application (no|number)|account (no|number)|agreement (no|number)/i, 1],
]

const ANY_TERM = new RegExp(TERM_PATTERNS.map(([re]) => re.source).join('|'), 'i')

const NUMBER_TOKEN = /\d[\d,]*(?:\.\d+)?/g

function scoreLines(lines) {
  const text = lines.join('\n')
  let score = 0
  for (const [re, weight] of TERM_PATTERNS) if (re.test(text)) score += weight
  return score
}

function isScheduleRow(line) {
  const nums = line.match(NUMBER_TOKEN) || []
  const letters = (line.match(/[A-Za-z]/g) || []).length
  return nums.length >= 4 && letters <= 12
}

function shape(line) {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

/** Lines that repeat on many pages (letterheads, footers, page numbers). */
function findRepeatedLines(pages) {
  if (pages.length < 3) return new Set()
  const counts = new Map()
  for (const p of pages) {
    for (const s of new Set(p.lines.map(shape))) counts.set(s, (counts.get(s) || 0) + 1)
  }
  const minPages = Math.max(3, Math.ceil(pages.length * 0.4))
  return new Set([...counts].filter(([s, c]) => c >= minPages && s.length < 140).map(([s]) => s))
}

function compressPage(lines, repeated, seenRepeated) {
  const kept = []
  // 1. Drop repeated headers/footers (keep their first appearance) and legal prose.
  for (const line of lines) {
    const s = shape(line)
    if (repeated.has(s)) {
      if (seenRepeated.has(s)) continue
      seenRepeated.add(s)
    }
    const hasDigit = /\d/.test(line)
    const hasTerm = ANY_TERM.test(line)
    if (!hasTerm && !hasDigit && line.length > 90) continue
    if (!hasTerm && line.length > 220) continue
    kept.push(line)
  }

  // 2. Shorten long runs of repayment-schedule rows.
  const out = []
  let scheduleRows = 0
  for (let i = 0; i < kept.length;) {
    if (!isScheduleRow(kept[i])) { out.push(kept[i]); i++; continue }
    let j = i
    while (j < kept.length && isScheduleRow(kept[j])) j++
    const run = kept.slice(i, j)
    scheduleRows += run.length
    if (run.length > 6) {
      out.push(...run.slice(0, 3))
      out.push(`[… ${run.length - 5} more table rows not shown …]`)
      out.push(...run.slice(-2))
    } else {
      out.push(...run)
    }
    i = j
  }
  return { text: out.join('\n'), scheduleRows }
}

export function pageLabel(page) {
  return `[Page ${page.id} — ${page.fileName}, page ${page.pageNo}]`
}

/**
 * @param {Array} pages  text pages from readDocuments (scanned === false)
 * @param {number} budgetChars  max characters of document text to send
 * @returns {{ text: string, includedPageIds: number[], omittedPageIds: number[], scheduleRows: number }}
 */
export function buildDocumentText(pages, budgetChars) {
  const repeated = findRepeatedLines(pages)
  const seen = new Set()
  let scheduleRows = 0
  const prepared = pages.map(p => {
    const c = compressPage(p.lines, repeated, seen)
    scheduleRows += c.scheduleRows
    return { page: p, text: c.text, score: scoreLines(p.lines), len: c.text.length + 60 }
  }).filter(p => p.text.trim())

  let included = prepared
  const total = prepared.reduce((s, p) => s + p.len, 0)
  if (total > budgetChars) {
    // Keep the most informative pages first (ties: earlier pages first).
    const ranked = [...prepared].sort((a, b) => b.score - a.score || a.page.id - b.page.id)
    included = []
    let used = 0
    for (const p of ranked) {
      if (used + p.len <= budgetChars) { included.push(p); used += p.len }
    }
    if (included.length === 0 && ranked.length) {
      // A single page bigger than the budget: keep its lines that carry loan terms or numbers first.
      const top = ranked[0]
      const lines = top.text.split('\n')
      const important = lines.filter(l => ANY_TERM.test(l) || /\d/.test(l))
      included = [{ ...top, text: important.join('\n').slice(0, budgetChars - 200) }]
    }
    included.sort((a, b) => a.page.id - b.page.id)
  }

  const includedIds = included.map(p => p.page.id)
  const omittedIds = pages.map(p => p.id).filter(id => !includedIds.includes(id))
  let text = included.map(p => `${pageLabel(p.page)}\n${p.text}`).join('\n\n')
  if (omittedIds.length) text += `\n\n[Pages ${omittedIds.join(', ')} were left out: no loan terms found on them.]`

  return { text, includedPageIds: includedIds, omittedPageIds: omittedIds, scheduleRows }
}

/** Plain text of every text page, used to confirm the AI's quotes really exist. */
export function fullText(pages) {
  return pages.filter(p => !p.scanned).map(p => p.lines.join('\n')).join('\n')
}
