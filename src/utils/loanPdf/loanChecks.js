// Turns the AI's extraction into form values, and checks the form with exact
// math — no AI involved. Each field gets a status:
//   verified — confirmed by an independent calculation
//   found    — copied from the document, with page and quote
//   check    — something doesn't add up (with the reason, and a fix when known)
//   missing  — not in the document
//   edited   — changed by the user after extraction
// Checks re-run on every edit, so fixing one field updates the others live.

import { emptyLoanForm } from '../loanForm'
import { pageLabel } from './prepareText'

// form field ← extracted field
export const FORM_TO_EXTRACTED = {
  lender: 'lender',
  type: 'loanType',
  accountNumber: 'accountNumber',
  principal: 'principal',
  annualInterestRate: 'annualInterestRate',
  interestType: 'interestType',
  tenureMonths: 'tenureMonths',
  emiAmount: 'emiAmount',
  disbursementDate: 'disbursementDate',
  firstEmiDate: 'firstEmiDate',
  apr: 'apr',
  processingFee: 'processingFee',
  processingFeeGST: 'processingFeeGST',
  insuranceCharges: 'insuranceCharges',
  prepaymentAllowed: 'prepaymentAllowed',
  prepaymentChargePercent: 'prepaymentChargePercent',
  prepaymentChargeFlatAmount: 'prepaymentChargeFlat',
  prepaymentMinimumAmount: 'prepaymentMinAmount',
  prepaymentLockInMonths: 'prepaymentLockInMonths',
  foreclosureAllowed: 'foreclosureAllowed',
  foreclosureChargePercent: 'foreclosureChargePercent',
  foreclosureChargeFlatAmount: 'foreclosureChargeFlat',
  foreclosureLockInMonths: 'foreclosureLockInMonths',
  prepaymentChargeGst: 'prepaymentChargeGST',
  foreclosureChargeGst: 'foreclosureChargeGST',
}

// A quote for these fields must actually talk about that topic.
const TOPIC = {
  prepayment: /pre-?pay|prepa(y|id)|part[\s-]?pay|part[\s-]?prepay/i,
  foreclosure: /fore-?clos|pre-?clos|pre-?pay|prepa(y|id)|clos(e|ure|ing)/i,
}
function topicOf(formKey) {
  const m = formKey.match(/^(prepayment|foreclosure)(Allowed|ChargePercent|ChargeFlatAmount|Steps|ChargeGst)$/)
  return m ? m[1] : null
}

/**
 * Is the quote about this topic? Checks the quote and, for text PDFs, the
 * lines just above it (a table row often sits under a heading like
 * "Pre-payment / Part Payment charges").
 */
function onTopic(re, extracted, sourceText) {
  if (re.test(extracted.quote)) return true
  if (extracted.source !== 'text' || !sourceText) return true // can't see the context — don't guess
  const norm = (t) => t.toLowerCase().replace(/[|\s]+/g, ' ').trim()
  const hay = norm(sourceText)
  const idx = hay.indexOf(norm(extracted.quote).slice(0, 60))
  if (idx < 0) return true
  return re.test(hay.slice(Math.max(0, idx - 400), idx))
}

const describeSteps = (steps) => (steps || []).map(st => `${st.afterEmis}:${st.percent}`).join(',')

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** First EMI date from an "account opened on day X → EMI on day Y" table. */
export function firstEmiFromRules(disbursementISO, rules) {
  if (!disbursementISO || !rules?.length) return null
  const [y, m, d] = disbursementISO.split('-').map(Number)
  const rule = rules.find(r => d >= r.openedFromDay && d <= r.openedToDay)
  if (!rule) return null
  const total = (m - 1) + rule.monthsLater
  const yy = y + Math.floor(total / 12)
  const mm = (total % 12) + 1
  const dd = Math.min(rule.emiDay, daysInMonth(yy, mm))
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const round2 = (n) => Math.round(n * 100) / 100
const fmtINR = (n) => '₹' + Math.round(n).toLocaleString('en-IN')
const fmtNum = (n) => (Number.isInteger(n) ? String(n) : String(round2(n)))

// ── Loan math ──────────────────────────────────────────────────

export function emiFor(principal, annualRate, months) {
  const r = annualRate / 1200
  if (r === 0) return principal / months
  const f = Math.pow(1 + r, months)
  return (principal * r * f) / (f - 1)
}

/** The reducing-balance yearly rate that produces this EMI. */
export function impliedRate(principal, months, emi) {
  if (!(principal > 0 && months > 0 && emi > 0) || emi * months <= principal) return null
  let lo = 0.0001
  let hi = 300
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (emiFor(principal, mid, months) < emi) lo = mid
    else hi = mid
  }
  const r = (lo + hi) / 2
  return r > 0.05 && r < 200 ? r : null
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

// ── Is the value really in the document? ───────────────────────

const squash = (s) => String(s).toLowerCase().normalize('NFKC').replace(/[\s|,“”"'‘’`]/g, '')
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function quoteInText(quote, sourceText) {
  if (!quote || !sourceText) return null
  const hay = squash(sourceText)
  const pieces = quote.split(/…|\.{3}/).map(squash).filter(p => p.length >= 4)
  if (!pieces.length) return null
  return pieces.every(p => hay.includes(p))
}

function numberInQuote(kind, value, quote) {
  if (!quote || value == null) return null
  const q = squash(quote)
  // Whole-number match: "5" must not match inside "15" or "10.5" ("Rs.5000" is fine).
  const has = (c) => new RegExp(`(?<!\\d)(?<!\\d\\.)${escapeRe(c)}(?!\\d)`).test(q)
  if (kind === 'number' || kind === 'integer') {
    const cands = new Set([String(value), value.toFixed(2), value.toFixed(1)])
    if (value >= 100000) {
      const l = value / 1e5
      cands.add(`${fmtNum(l)}lakh`); cands.add(`${fmtNum(l)}lac`); cands.add(`${fmtNum(l)}l`)
    }
    if (value >= 1e7) cands.add(`${fmtNum(value / 1e7)}crore`).add(`${fmtNum(value / 1e7)}cr`)
    if (kind === 'integer' && value % 12 === 0 && value > 0) {
      cands.add(`${value / 12}year`); cands.add(`${value / 12}yr`)
    }
    return [...cands].some(c => (/[a-z]$/.test(c) ? q.includes(c) : has(c)))
  }
  if (kind === 'date') {
    const [y, m, d] = value.split('-').map(Number)
    const yy = String(y).slice(2)
    const mon = MONTHS[m - 1]
    const yr = `(${y}|${yy})`
    const tests = [
      `(?<!\\d)0?${d}[/.-]0?${m}[/.-]${yr}(?!\\d)`,
      `${y}[/.-]0?${m}[/.-]0?${d}(?!\\d)`,
      `(?<!\\d)0?${d}(st|nd|rd|th)?(of)?[/.-]?${mon}[a-z]*[/.-]?${yr}`,
      `${mon}[a-z]*[/.-]?0?${d}(st|nd|rd|th)?[/.-]?${yr}`,
    ]
    return tests.some(t => new RegExp(t).test(q))
  }
  return null
}

const KIND = {
  principal: 'number', annualInterestRate: 'number', tenureMonths: 'integer', emiAmount: 'number',
  disbursementDate: 'date', firstEmiDate: 'date', apr: 'number',
  processingFee: 'number', processingFeeGST: 'number', insuranceCharges: 'number',
  prepaymentChargePercent: 'number', prepaymentChargeFlatAmount: 'number', prepaymentMinimumAmount: 'number',
  prepaymentLockInMonths: 'integer', foreclosureChargePercent: 'number', foreclosureChargeFlatAmount: 'number',
  foreclosureLockInMonths: 'integer',
}

function makeEvidence(extracted, formValue, extraction, kind, note, formKey = '') {
  const page = extraction.pages.find(p => p.id === extracted.page)
  const quoteFound = extracted.source === 'text' ? quoteInText(extracted.quote, extraction.sourceText) : null
  const numberFound = kind ? numberInQuote(kind, extracted.value, extracted.quote) : null
  let problem = null
  if (!extracted.quote) problem = 'The AI gave no quote for this value'
  else if (quoteFound === false) problem = "The quoted text couldn't be found in the PDF"
  else if (numberFound === false && !note) problem = "This value doesn't appear in the quoted text"
  else if (topicOf(formKey) && !onTopic(TOPIC[topicOf(formKey)], extracted, extraction.sourceText)) {
    problem = `The quoted text doesn't seem to be about ${topicOf(formKey) === 'prepayment' ? 'part-prepayment' : 'foreclosure'}`
  }
  return {
    value: formValue,
    page: extracted.page,
    pageText: page ? pageLabel(page).replace(/^\[|\]$/g, '').replace(/^Page \d+ — /, '') : extracted.page ? `page ${extracted.page}` : null,
    quote: extracted.quote,
    source: extracted.source,
    note: note || null,
    problem,
  }
}

function shortLender(name) {
  return name
    .replace(/\b(limited|ltd\.?|pvt\.?|private|co\.?|company|corporation|corp\.?|india)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,.-]+$/, '')
    .trim()
}

/**
 * Extraction result → { form, evidence }.
 * evidence[formField] = { value, pageText, quote, source, note, problem }
 */
export function extractionToForm(extraction) {
  const f = extraction.fields
  const form = { ...emptyLoanForm, otherCharges: [], foreclosureAllowed: 'null' }
  const evidence = {}

  for (const [formKey, exKey] of Object.entries(FORM_TO_EXTRACTED)) {
    const ex = f[exKey]
    if (!ex) continue
    const value = String(ex.value)
    form[formKey] = formKey.endsWith('ChargeGst') ? ex.value === true : value
    evidence[formKey] = makeEvidence(ex, value, extraction, KIND[formKey], null, formKey)
  }

  // Charges that change after some EMIs (e.g. 3% up to 36 EMIs, then 2%).
  for (const kind of ['prepayment', 'foreclosure']) {
    const tiers = extraction[`${kind}ChargeTiers`] || []
    const later = tiers.filter(t => t.afterEmis > 0)
    if (!later.length) continue
    const start = tiers.find(t => t.afterEmis === 0)
    const pctKey = `${kind}ChargePercent`
    if (start && form[pctKey] === '') {
      form[pctKey] = String(start.percent)
      evidence[pctKey] = makeEvidence({ ...start, value: start.percent }, form[pctKey], extraction, 'number', null, pctKey)
    }
    const steps = later.map(t => ({ afterEmis: String(t.afterEmis), percent: String(t.percent) }))
    form[`${kind}Steps`] = steps
    const first = later[0]
    evidence[`${kind}Steps`] = makeEvidence({ ...first, value: first.percent }, describeSteps(steps), extraction, 'number', null, `${kind}Steps`)
  }

  // Fee shown only as a GST-inclusive total → split it here (exact math, not AI).
  if (f.processingFeeIncludesGST?.value === true && f.processingFee && !f.processingFeeGST) {
    const total = f.processingFee.value
    const base = round2(total / 1.18)
    const gst = round2(total - base)
    form.processingFee = String(base)
    form.processingFeeGST = String(gst)
    const note = `Split from the GST-inclusive fee of ${fmtINR(total)}`
    evidence.processingFee = makeEvidence(f.processingFee, form.processingFee, extraction, 'number', note)
    evidence.processingFeeGST = makeEvidence(f.processingFee, form.processingFeeGST, extraction, 'number', note)
  }

  // A stated charge means it's allowed.
  for (const kind of ['prepayment', 'foreclosure']) {
    const allowedKey = `${kind}Allowed`
    if (form[allowedKey] === 'null' && (form[`${kind}ChargePercent`] !== '' || form[`${kind}ChargeFlatAmount`] !== '')) {
      form[allowedKey] = 'true'
      const src = evidence[`${kind}ChargePercent`] || evidence[`${kind}ChargeFlatAmount`]
      evidence[allowedKey] = { ...src, value: 'true', note: 'A charge is stated, so it is allowed', problem: null }
    }
  }

  // Dates the document doesn't state: estimate them, clearly marked for review.
  if (!form.disbursementDate && f.sanctionDate) {
    form.disbursementDate = f.sanctionDate.value
    const page = extraction.pages.find(p => p.id === f.sanctionDate.page)
    evidence.disbursementDate = {
      value: form.disbursementDate,
      pageText: page ? `${page.fileName}, page ${page.pageNo}` : null,
      quote: f.sanctionDate.quote,
      source: f.sanctionDate.source,
      note: null,
      estimated: true,
      problem: 'Estimated: this is the sanction date. The money usually arrives the same day or a few days later — check your bank statement.',
    }
  }
  if (!form.firstEmiDate && form.disbursementDate && extraction.emiDateRules?.length) {
    const est = firstEmiFromRules(form.disbursementDate, extraction.emiDateRules)
    if (est) {
      form.firstEmiDate = est
      evidence.firstEmiDate = {
        value: est,
        pageText: null,
        quote: null,
        source: 'rule',
        note: null,
        estimated: true,
        problem: "Estimated from the document's EMI date table and the disbursement date — confirm with your first EMI debit.",
      }
    }
  }

  if (form.type === 'Unknown' || !f.loanType) form.type = 'Personal'
  form.gstOnInterest = form.type === 'Credit Card'

  form.otherCharges = extraction.otherCharges.map(c => ({ name: c.name, amount: String(c.amount) }))
  extraction.otherCharges.forEach((c, i) => {
    evidence[`otherCharges.${i}`] = makeEvidence(c, String(c.amount), extraction, null)
  })

  const lender = form.lender ? shortLender(form.lender) : ''
  const typeLabel = form.type === 'Credit Card' ? 'Credit Card EMI' : form.type === 'Other' ? 'Loan' : `${form.type} Loan`
  form.nickname = [lender, f.loanType ? typeLabel : 'Loan'].filter(Boolean).join(' ')

  return { form, evidence }
}

// ── Checks ─────────────────────────────────────────────────────

const RANK = { check: 3, verified: 2, found: 1 }

/**
 * @param {object} form        current form values
 * @param {object|null} extraction  result of extractLoan (null for manual entry)
 * @param {object} evidence    from extractionToForm
 * @returns {{ info: Record<string, {status, messages: string[], fix?: {value, label}, evidence?}>, summary }}
 */
export function checkLoanForm(form, extraction, evidence = {}) {
  const info = {}
  const get = (k) => (info[k] ||= { status: null, messages: [], fix: null, evidence: null })
  const mark = (k, status, message, fix) => {
    const e = get(k)
    if (!e.status || RANK[status] > RANK[e.status]) e.status = status
    if (message && !e.messages.includes(message)) e.messages.push(message)
    if (fix && !e.fix) e.fix = fix
  }
  const n = (k) => {
    const v = form[k]
    if (v === '' || v == null) return null
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }

  const P = n('principal')
  const R = n('annualInterestRate')
  const N = n('tenureMonths')
  const E = n('emiAmount')
  const disb = form.disbursementDate || null
  const first = form.firstEmiDate || null
  const ex = extraction?.fields || {}
  const schedule = extraction?.schedule

  // 1. EMI = f(amount, rate, tenure)
  const flatStated = ex.rateBasis?.value === 'flat'
  if (P && R && N && E) {
    const calc = emiFor(P, R, N)
    const tol = Math.max(2, E * 0.003)
    const ir = impliedRate(P, N, E)
    const flatE = (P + (P * R * N) / 1200) / N
    if (Math.abs(calc - E) <= tol) {
      for (const k of ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']) mark(k, 'verified', 'EMI matches the amount, rate and tenure')
    } else if (Math.abs(flatE - E) <= tol && ir) {
      for (const k of ['principal', 'tenureMonths', 'emiAmount']) mark(k, 'verified', 'EMI matches the amount and tenure')
      mark('annualInterestRate', 'check',
        `${fmtNum(R)}% is a flat rate. This app needs the reducing-balance rate, which is ${ir.toFixed(2)}% for this EMI.`,
        { value: String(round2(ir)), label: `Use ${ir.toFixed(2)}%` })
    } else if (ir && Math.abs(ir - R) <= 0.06) {
      for (const k of ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']) mark(k, 'verified', 'EMI matches the amount, rate and tenure (rounding)')
    } else if (ir && Math.abs(ir - R) <= 0.75) {
      mark('annualInterestRate', 'check',
        `For this amount, tenure and EMI the rate works out to ${ir.toFixed(2)}%, not ${fmtNum(R)}%. Rounding, a broken first month or a floating rate can cause this.`,
        { value: String(round2(ir)), label: `Use ${ir.toFixed(2)}%` })
    } else {
      const ni = ex.numberOfInstallments?.value
      // If exactly one of the four values isn't backed by the document text, it's the likely culprit.
      const core = ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']
      const unbacked = core.filter(k => evidence[k]?.problem && String(form[k]) === String(evidence[k].value))
      if (ni && ni !== N && Math.abs(emiFor(P, R, ni) - E) <= tol) {
        mark('tenureMonths', 'check', `The EMI matches ${ni} instalments, which the document also states.`, { value: String(ni), label: `Use ${ni} months` })
      } else if (unbacked.length === 1) {
        const k = unbacked[0]
        const fixes = {
          emiAmount: { value: String(Math.round(calc)), label: `Use ${fmtINR(calc)}` },
          annualInterestRate: ir ? { value: String(round2(ir)), label: `Use ${ir.toFixed(2)}%` } : null,
        }
        mark(k, 'check', `Likely wrong: the other values give ${k === 'emiAmount' ? `an EMI of ${fmtINR(calc)}` : 'a different result'}, and this value isn't in the document text.`, fixes[k])
      } else {
        const msg = `These don't add up: ${fmtINR(P)} at ${fmtNum(R)}% for ${N} months gives an EMI of ${fmtINR(calc)}, not ${fmtINR(E)}.`
        for (const k of ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']) mark(k, 'check', msg)
      }
    }
  }
  const TI = ex.totalInterest?.value
  if (TI && P && R && N && E) {
    const calcTI = E * N - P
    if (Math.abs(calcTI - TI) <= Math.max(50, TI * 0.003) && Math.abs(emiFor(P, R, N) - E) <= Math.max(2, E * 0.003)) {
      for (const k of ['principal', 'annualInterestRate', 'tenureMonths', 'emiAmount']) mark(k, 'verified', `Total interest matches the document (${fmtINR(TI)})`)
    }
  }
  if (flatStated && R && !(info.annualInterestRate?.status === 'check')) {
    const ir = P && N && E ? impliedRate(P, N, E) : null
    mark('annualInterestRate', 'check', 'The document says this is a flat rate. This app needs the reducing-balance rate.',
      ir ? { value: String(round2(ir)), label: `Use ${ir.toFixed(2)}%` } : null)
  }
  if (ex.interestType?.value === 'floating' && R) get('annualInterestRate').messages.push('Floating rate — it can change over the loan.')

  // 2. Repayment schedule in the document
  if (schedule?.found) {
    const s = schedule
    if (s.installmentCount && N) {
      if (s.installmentCount === N) mark('tenureMonths', 'verified', `The repayment schedule has ${N} instalments`)
      else mark('tenureMonths', 'check', `The repayment schedule has ${s.installmentCount} instalments`, { value: String(s.installmentCount), label: `Use ${s.installmentCount}` })
    }
    if (s.firstOpeningBalance && P && Math.abs(s.firstOpeningBalance - P) <= 1) mark('principal', 'verified', "Matches the repayment schedule's opening balance")
    if (s.firstDate && first) {
      if (s.firstDate === first) mark('firstEmiDate', 'verified', 'Matches the first row of the repayment schedule')
      else mark('firstEmiDate', 'check', `The repayment schedule's first row is dated ${s.firstDate}`, { value: s.firstDate, label: 'Use that date' })
    }
    if (s.firstInterest && P && R) {
      const monthly = (P * R) / 1200
      if (Math.abs(monthly - s.firstInterest) <= Math.max(1, s.firstInterest * 0.01)) {
        mark('annualInterestRate', 'verified', "The schedule's first-month interest matches this rate")
      } else if (disb && first) {
        const days = daysBetween(disb, first)
        const broken = (P * R * days) / 36500
        if (days > 0 && Math.abs(broken - s.firstInterest) <= Math.max(1, s.firstInterest * 0.015)) {
          mark('annualInterestRate', 'verified', "The schedule's first interest matches this rate")
          mark('disbursementDate', 'verified', "The schedule's first interest matches this date")
        }
      }
    }
    if (s.firstInstallment && E && Math.abs(s.firstInstallment - E) <= 1) mark('emiAmount', 'verified', 'Matches the repayment schedule')
  }

  // 3. Dates
  if (disb && first) {
    const days = daysBetween(disb, first)
    if (days < 0) {
      mark('firstEmiDate', 'check', 'The first EMI is before the disbursement date — the two dates may be swapped.')
      mark('disbursementDate', 'check', 'The disbursement date is after the first EMI — the two dates may be swapped.')
    } else if (days < 7) {
      mark('firstEmiDate', 'check', `Only ${days} days after disbursement — please confirm.`)
    } else if (days > 125) {
      mark('firstEmiDate', 'check', `More than 4 months after disbursement — please confirm.`)
    }
  }

  // 4. Fees
  const F = n('processingFee')
  const G = n('processingFeeGST')
  const I = n('insuranceCharges')
  if (F && G) {
    if (Math.abs(G - F * 0.18) <= Math.max(1, F * 0.005)) {
      mark('processingFee', 'verified', 'GST is exactly 18% of this fee')
      mark('processingFeeGST', 'verified', 'Exactly 18% of the processing fee')
    } else {
      mark('processingFeeGST', 'check', `GST on fees is 18%, which would be ${fmtINR(F * 0.18)}.`, { value: String(round2(F * 0.18)), label: `Use ${fmtINR(F * 0.18)}` })
    }
  }
  const net = ex.netDisbursedAmount?.value
  const other = (form.otherCharges || []).reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const deductions = (F || 0) + (G || 0) + (I || 0) + other
  if (net && P && deductions > 0 && Math.abs(P - deductions - net) <= 2) {
    const msg = `Loan amount minus charges equals the net disbursal of ${fmtINR(net)}`
    if (F) mark('processingFee', 'verified', msg)
    if (G) mark('processingFeeGST', 'verified', msg)
    if (I) mark('insuranceCharges', 'verified', msg)
    ;(form.otherCharges || []).forEach((c, i) => { if (Number(c.amount) > 0) mark(`otherCharges.${i}`, 'verified', msg) })
  }

  // 5. Sensible ranges
  if (R != null && (R < 1 || R > 60)) mark('annualInterestRate', 'check', 'Unusual rate — make sure it is a yearly rate.')
  if (N != null && (N < 1 || N > 480)) mark('tenureMonths', 'check', 'Unusual tenure — it should be in months.')
  if (E != null && P != null && E >= P) mark('emiAmount', 'check', 'The EMI is larger than the loan amount.')
  for (const k of ['prepaymentChargePercent', 'foreclosureChargePercent']) {
    const v = n(k)
    if (v != null && v > 10) mark(k, 'check', 'Charges above 10% are unusual — make sure this is a percentage.')
  }
  for (const k of ['prepaymentLockInMonths', 'foreclosureLockInMonths']) {
    const v = n(k)
    if (v != null && N && v >= N) mark(k, 'check', 'The lock-in is as long as the whole loan.')
  }
  for (const kind of ['prepayment', 'foreclosure']) {
    const steps = form[`${kind}Steps`] || []
    if (steps.some(st => Number(st.percent) > 10)) mark(`${kind}Steps`, 'check', 'Charges above 10% are unusual — make sure this is a percentage.')
    if (N && steps.some(st => Number(st.afterEmis) >= N)) mark(`${kind}Steps`, 'check', 'This step starts after the loan would already be over.')
  }
  const apr = n('apr')
  if (apr != null && R && apr < R - 0.05) mark('apr', 'check', 'APR is normally equal to or higher than the interest rate.')

  // 6. Source of each value
  for (const [k, ev] of Object.entries(evidence)) {
    const current = k.startsWith('otherCharges.') ? form.otherCharges?.[Number(k.split('.')[1])]?.amount
      : k.endsWith('Steps') ? describeSteps(form[k])
      : form[k]
    const e = get(k)
    if (current === undefined) { delete info[k]; continue }
    if (String(current) !== String(ev.value)) {
      e.status = e.status === 'check' ? 'check' : e.status === 'verified' ? 'verified' : 'edited'
      e.evidence = { ...ev, edited: true }
      continue
    }
    e.evidence = ev
    if (ev.problem && e.status !== 'verified') mark(k, 'check', ev.problem)
    else mark(k, 'found')
  }

  // 7. What the document didn't have
  if (extraction) {
    for (const [formKey, exKey] of Object.entries(FORM_TO_EXTRACTED)) {
      const e = info[formKey]
      if (e?.status) continue
      const empty = form[formKey] === '' || form[formKey] === 'null'
      if (!ex[exKey] && (empty || formKey === 'type')) {
        get(formKey).status = 'missing'
      }
    }
  }

  const ref = ex.referenceNumber?.value
  if (extraction && ref && !form.accountNumber) {
    const e = get('accountNumber')
    e.messages.push(`The document has a reference number (${ref}). It isn't the loan account number, but you can use it to identify this loan.`)
    e.fix = { value: ref, label: 'Use reference no.' }
  }

  const statuses = Object.values(info).map(e => e.status)
  const summary = {
    verified: statuses.filter(s => s === 'verified').length,
    found: statuses.filter(s => s === 'found').length,
    check: statuses.filter(s => s === 'check').length,
    missing: statuses.filter(s => s === 'missing').length,
  }
  return { info, summary }
}
