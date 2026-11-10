// Opens the uploaded files in the browser and turns them into pages:
//  • PDF pages with real text → text lines that keep table rows together
//  • scanned PDF pages and photos → images (made only when needed)
// Password-protected PDFs are unlocked here, in the browser. The password
// is never sent anywhere.

import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const MAX_PAGES_PER_FILE = 80
const IMAGE_MAX_SIDE = 1700
const IMAGE_MAX_DATAURL = 1_400_000 // ~1 MB of JPEG per page

export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export class SkipFile extends Error {
  constructor(message) { super(message); this.name = 'SkipFile' }
}

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}
function isImage(file) {
  return /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
}

// ── Text layout ────────────────────────────────────────────────

/**
 * Rebuild visual lines from pdf.js text items. Items on the same baseline are
 * joined left-to-right; wide gaps (table columns) become " | " so a label
 * stays next to its value.
 */
export function linesFromTextItems(items) {
  const parts = []
  for (const it of items) {
    if (typeof it.str !== 'string') continue
    const str = it.str.replace(/\s+/g, ' ')
    if (!str.trim()) continue
    const t = it.transform
    const h = Math.hypot(t[2], t[3]) || it.height || 10
    parts.push({ x: t[4], y: t[5], h, w: it.width || str.length * h * 0.5, str })
  }
  parts.sort((p, q) => q.y - p.y || p.x - q.x)

  const lines = []
  for (const p of parts) {
    // Only the most recent lines can share a baseline (parts are sorted by y).
    let line = null
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
      const l = lines[i]
      if (Math.abs(l.y - p.y) <= Math.max(1.5, Math.min(l.h, p.h) * 0.45)) { line = l; break }
    }
    if (line) {
      line.items.push(p)
      line.h = Math.max(line.h, p.h)
    } else {
      lines.push({ y: p.y, h: p.h, items: [p] })
    }
  }

  lines.sort((a, b) => b.y - a.y)
  return lines.map(l => {
    l.items.sort((p, q) => p.x - q.x)
    let out = ''
    let prevEnd = null
    let prevCharW = 0
    for (const it of l.items) {
      const charW = it.w / Math.max(1, it.str.length)
      if (prevEnd != null) {
        const gap = it.x - prevEnd
        const cw = Math.max(prevCharW, charW, 1)
        if (gap > cw * 3 || gap > 20) out += ' | '
        else if (gap > cw * 0.25 && !out.endsWith(' ') && !it.str.startsWith(' ')) out += ' '
      }
      out += it.str
      prevEnd = it.x + it.w
      prevCharW = charW
    }
    return out.replace(/\s+/g, ' ').replace(/(\s\|\s)+/g, ' | ').trim()
  }).filter(Boolean)
}

/** Pages with almost no text, or text that is mostly unreadable symbols, are treated as scans. */
function looksScanned(lines) {
  const text = lines.join('')
  const chars = text.replace(/[\s|]/g, '')
  if (chars.length < 40) return true
  const readable = (chars.match(/[A-Za-z0-9₹.,%:/()-]/g) || []).length
  return readable / chars.length < 0.5
}

// ── Images ─────────────────────────────────────────────────────

function canvasToJpeg(canvas) {
  let url = canvas.toDataURL('image/jpeg', 0.82)
  if (url.length > IMAGE_MAX_DATAURL) url = canvas.toDataURL('image/jpeg', 0.62)
  if (url.length > IMAGE_MAX_DATAURL) {
    // Still too big: halve the size.
    const small = document.createElement('canvas')
    small.width = Math.round(canvas.width * 0.7)
    small.height = Math.round(canvas.height * 0.7)
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height)
    url = small.toDataURL('image/jpeg', 0.7)
  }
  return url
}

async function renderPdfPage(page) {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(2.5, IMAGE_MAX_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvas, viewport, background: 'white' }).promise
  const url = canvasToJpeg(canvas)
  canvas.width = canvas.height = 0
  return url
}

async function imageFileToJpeg(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const url = canvasToJpeg(canvas)
  canvas.width = canvas.height = 0
  return url
}

// ── Opening PDFs (with passwords) ──────────────────────────────

async function openPdf(bytes, fileName, askPassword) {
  let password
  for (;;) {
    const task = pdfjsLib.getDocument({ data: bytes.slice(), password, isEvalSupported: false })
    try {
      return await task.promise
    } catch (err) {
      if (err?.name !== 'PasswordException') {
        if (err?.name === 'InvalidPDFException') throw new SkipFile(`“${fileName}” is not a valid PDF file.`)
        throw err
      }
      const incorrect = err.code === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
      const answer = askPassword ? await askPassword({ fileName, incorrect }) : null
      if (answer == null) throw new SkipFile(`“${fileName}” is password-protected and was skipped.`)
      password = answer
    }
  }
}

/**
 * Read every file into pages.
 *
 * @param {File[]} files
 * @param {object} opts
 * @param {({fileName, incorrect}) => Promise<string|null>} opts.askPassword
 * @param {(msg:string) => void} [opts.onStatus]
 * @returns {Promise<{ pages: Array, files: Array, skipped: string[], cleanup: () => void }>}
 */
export async function readDocuments(files, { askPassword, onStatus } = {}) {
  const pages = []
  const fileInfo = []
  const skipped = []
  const openDocs = []

  for (let f = 0; f < files.length; f++) {
    const file = files[f]
    onStatus?.(`Opening ${file.name}…`)
    try {
      if (isPdf(file)) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const pdf = await openPdf(bytes, file.name, askPassword)
        openDocs.push(pdf)
        const count = Math.min(pdf.numPages, MAX_PAGES_PER_FILE)
        for (let n = 1; n <= count; n++) {
          onStatus?.(`Reading ${file.name} — page ${n} of ${count}`)
          const page = await pdf.getPage(n)
          const content = await page.getTextContent()
          const lines = linesFromTextItems(content.items)
          const scanned = looksScanned(lines)
          pages.push({
            id: pages.length + 1,
            fileIndex: f,
            fileName: file.name,
            pageNo: n,
            lines: scanned ? [] : lines,
            scanned,
            getImage: () => renderPdfPage(page),
          })
        }
        fileInfo.push({ name: file.name, kind: 'pdf', pages: count, truncated: pdf.numPages > count })
      } else if (isImage(file)) {
        pages.push({
          id: pages.length + 1,
          fileIndex: f,
          fileName: file.name,
          pageNo: 1,
          lines: [],
          scanned: true,
          getImage: () => imageFileToJpeg(file),
        })
        fileInfo.push({ name: file.name, kind: 'image', pages: 1 })
      } else {
        skipped.push(`“${file.name}” is not a PDF or image, so it was skipped.`)
      }
    } catch (err) {
      if (err instanceof SkipFile) skipped.push(err.message)
      else skipped.push(`“${file.name}” could not be opened (${err.message}).`)
    }
  }

  return {
    pages,
    files: fileInfo,
    skipped,
    cleanup: () => openDocs.forEach(d => { try { d.destroy() } catch { /* already closed */ } }),
  }
}
