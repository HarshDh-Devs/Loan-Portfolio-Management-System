// Loan Insights logic — plain math, no AI. Every number on the Insights page
// comes from here, so it is exact and the same every time.
//
// Key ideas
// • Fees you already paid are gone either way, so they don't affect what to
//   close next. What matters is the interest you'd still pay from today.
// • Closing a loan early is like an investment: you pay the outstanding amount
//   plus the closure charge now, and stop paying the remaining EMIs. Its yearly
//   "return" is compared with a safe option (a bank FD, ~7% a year).
// • The closure charge "pays for itself" after the months of interest it saves.

import {
  generateAmortizationSchedule,
  getCurrentLoanState,
  calculateTrueCost,
  chargeAt,
  chargePercentAt,
  calculatePrepaymentSavings,
} from '../math/engine'

export const SAFE_RETURN = 7 // % a year, roughly what a bank FD pays before tax

const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0)

function emiFor(P, annualRate, n) {
  const r = annualRate / 1200
  if (r === 0) return P / n
  const f = Math.pow(1 + r, n)
  return (P * r * f) / (f - 1)
}

/** Yearly % return of paying `outlay` now to avoid `flows` (one per month). */
function annualReturn(outlay, flows) {
  if (!(outlay > 0) || !flows.length) return null
  const npv = (r) => flows.reduce((s, cf, i) => s + cf / Math.pow(1 + r, i + 1), 0) - outlay
  if (npv(0) <= 0) return npv(0) === 0 ? 0 : null // saves less than it costs
  let lo = 0
  let hi = 1
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (npv(mid) > 0) lo = mid
    else hi = mid
  }
  return Math.round(((lo + hi) / 2) * 12 * 10000) / 100
}

function monthsBetween(fromDate, toISO) {
  const to = new Date(toISO)
  return (to.getFullYear() - fromDate.getFullYear()) * 12 + (to.getMonth() - fromDate.getMonth())
}

/** Everything about one loan, as of today. */
export function analyseLoan(loan, today = new Date()) {
  const schedule = generateAmortizationSchedule(loan)
  const state = getCurrentLoanState(loan)
  const gstFactor = loan.gstOnInterest ? 1 + (loan.gstOnInterestRate ?? 18) / 100 : 1
  const rate = Number(loan.annualInterestRate) || 0
  const realRate = Math.round(rate * gstFactor * 100) / 100
  const remaining = schedule.slice(state.emisPaid)
  const interestLeft = sum(remaining, r => r.interestComponent) * gstFactor
  const monthlyInterest = (state.outstanding * rate / 1200) * gstFactor
  const nextRow = remaining[0]
  const monthlyPayment = nextRow ? nextRow.emiPaid + nextRow.interestComponent * (gstFactor - 1) : 0
  const endDate = schedule.length ? schedule[schedule.length - 1].date : null
  const trueCost = calculateTrueCost(loan)

  const warnings = []
  const expectedEmi = loan.principal > 0 && rate > 0 && loan.tenureMonths > 0 ? emiFor(loan.principal, rate, loan.tenureMonths) : null
  if (expectedEmi && Math.abs(expectedEmi - loan.emiAmount) > Math.max(2, loan.emiAmount * 0.01)) {
    warnings.push(`The saved EMI (₹${Math.round(loan.emiAmount).toLocaleString('en-IN')}) doesn't match the amount, rate and tenure (₹${Math.round(expectedEmi).toLocaleString('en-IN')}), so these numbers may be off. Check this loan's details.`)
  }

  const fc = loan.foreclosure || {}
  let close
  if (state.isCompleted || !remaining.length) {
    close = { status: 'done' }
  } else if (fc.allowed === false) {
    close = { status: 'not-allowed' }
  } else if (fc.lockInMonths > 0 && state.emisPaid < fc.lockInMonths) {
    close = { status: 'locked', unlockDate: schedule[fc.lockInMonths - 1]?.date || null }
  } else {
    const charge = chargeAt(fc, state.emisPaid, state.outstanding)
    const payout = state.outstanding + charge.total
    const flows = remaining.map(r => r.emiPaid + r.interestComponent * (gstFactor - 1))
    close = {
      status: 'possible',
      charge,
      payout,
      interestSaved: interestLeft,
      net: interestLeft - charge.total,
      recoveryMonths: monthlyInterest > 0 ? charge.total / monthlyInterest : 0,
      returnPct: annualReturn(payout, flows),
      termsUnknown: fc.allowed == null && !(fc.chargePercent > 0) && !(fc.chargeTiers?.length) && !(fc.chargeFlatAmount > 0),
      nextChargePercent: (() => {
        const later = (fc.chargeTiers || []).filter(t => Number(t.afterEmis) > state.emisPaid).sort((a, b) => a.afterEmis - b.afterEmis)[0]
        return later ? { percent: Number(later.percent), afterEmis: Number(later.afterEmis), date: schedule[Number(later.afterEmis) - 1]?.date || null } : null
      })(),
    }
  }

  // Verdict in plain words.
  let verdict
  if (close.status === 'done') verdict = { key: 'done', label: 'Paid off', tone: 'gray' }
  else if (close.status === 'not-allowed') verdict = { key: 'blocked', label: "Can't close early", tone: 'gray' }
  else if (close.status === 'locked') verdict = { key: 'locked', label: 'Locked for now', tone: 'gray' }
  else if (close.net <= 0) verdict = { key: 'skip', label: 'Not worth closing', tone: 'red' }
  else if (state.emisRemaining <= 3) verdict = { key: 'nearly', label: 'Almost done', tone: 'gray' }
  else if ((close.returnPct ?? 0) >= SAFE_RETURN + 3) verdict = { key: 'best', label: 'Top priority', tone: 'green' }
  else if ((close.returnPct ?? 0) >= SAFE_RETURN) verdict = { key: 'good', label: 'Worth prepaying', tone: 'green' }
  else verdict = { key: 'low', label: 'Low priority', tone: 'amber' }

  const notes = []
  if (close.status === 'possible' && close.termsUnknown) notes.push('Foreclosure charges are not saved for this loan, so no charge is assumed. Add them in Edit for exact numbers.')
  if (close.status === 'possible' && close.nextChargePercent && close.nextChargePercent.percent < close.charge.percent) {
    const d = close.nextChargePercent.date ? new Date(close.nextChargePercent.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : `EMI ${close.nextChargePercent.afterEmis}`
    notes.push(`The closure charge drops to ${close.nextChargePercent.percent}% after ${close.nextChargePercent.afterEmis} EMIs (around ${d}).`)
  }
  if (loan.type === 'Home') notes.push('Home loan interest can lower your income tax (old tax regime), so its real cost may be less than shown.')
  if (loan.gstOnInterest) notes.push(`18% GST is charged on the interest, so it really costs ${realRate}% a year, not ${rate}%.`)

  return {
    loan,
    state,
    schedule,
    rate,
    realRate,
    interestLeft,
    monthlyInterest,
    monthlyPayment,
    endDate,
    monthsLeft: endDate ? Math.max(0, monthsBetween(today, endDate)) : 0,
    trueCost,
    close,
    verdict,
    warnings,
    notes,
  }
}

const VERDICT_ORDER = { best: 0, good: 1, low: 2, nearly: 3, skip: 4, locked: 5, blocked: 6, done: 7 }

/** Whole-portfolio summary and the "close first" order. */
export function analysePortfolio(loans, today = new Date()) {
  const items = loans.map(l => analyseLoan(l, today)).filter(a => a.verdict.key !== 'done')
  const ranked = [...items].sort((a, b) =>
    VERDICT_ORDER[a.verdict.key] - VERDICT_ORDER[b.verdict.key] ||
    (b.close.returnPct ?? b.realRate) - (a.close.returnPct ?? a.realRate))

  const endDates = items.map(a => a.endDate).filter(Boolean).sort()
  return {
    items,
    ranked,
    totals: {
      outstanding: sum(items, a => a.state.outstanding),
      monthlyPayment: sum(items, a => a.monthlyPayment),
      interestLeft: sum(items, a => a.interestLeft),
      monthlyInterest: sum(items, a => a.monthlyInterest),
      debtFreeDate: endDates[endDates.length - 1] || null,
    },
  }
}

/**
 * Where to put a lump sum. Goes loan by loan from the best return; closes a
 * loan fully when the money covers it, otherwise part-prepays. Money is only
 * used where it beats a safe ~7% FD.
 */
export function planExtraMoney(items, amount) {
  let left = Math.max(0, Number(amount) || 0)
  const steps = []

  const candidates = items
    .filter(a => a.verdict.key !== 'done' && a.state.emisRemaining > 0)
    .map(a => {
      const pre = a.loan.prepayment || {}
      const pct = chargePercentAt(pre, a.state.emisPaid) * (pre.gstOnCharge ? 1.18 : 1)
      const yearsLeft = Math.max(a.state.emisRemaining / 12, 1 / 12)
      return { a, partReturn: a.realRate - pct / yearsLeft }
    })
    .sort((x, y) => Math.max(y.a.close.returnPct ?? 0, y.partReturn) - Math.max(x.a.close.returnPct ?? 0, x.partReturn))

  for (const { a, partReturn } of candidates) {
    if (left < 1000) break
    const { loan, state, close } = a
    if (close.status === 'possible' && close.net > 0 && (close.returnPct ?? 0) >= SAFE_RETURN && left >= close.payout) {
      steps.push({ a, action: 'close', pay: close.payout, interestSaved: close.interestSaved, charge: close.charge.total, net: close.net, monthsSaved: state.emisRemaining, emiFreed: a.monthlyPayment })
      left -= close.payout
      continue
    }
    const pre = loan.prepayment || {}
    if (pre.allowed === false || (pre.lockInMonths > 0 && state.emisPaid < pre.lockInMonths) || partReturn < SAFE_RETURN) continue
    const pct = chargePercentAt(pre, state.emisPaid) * (pre.gstOnCharge ? 1.18 : 1)
    const flat = pct > 0 ? 0 : (Number(pre.chargeFlatAmount) || 0) * (pre.gstOnCharge ? 1.18 : 1)
    let toLoan = Math.floor((left - flat) / (1 + pct / 100))
    toLoan = Math.min(toLoan, Math.floor(state.outstanding) - 1)
    if (toLoan < 1000 || (pre.minimumAmount > 0 && toLoan < pre.minimumAmount)) continue
    const sim = calculatePrepaymentSavings(loan, toLoan, state.emisPaid + 1)
    if (!sim.feasible || sim.netSavings <= 0) continue
    steps.push({ a, action: 'part', pay: toLoan + sim.prepaymentCharge, toLoan, interestSaved: sim.interestSaved, charge: sim.prepaymentCharge, net: sim.netSavings, monthsSaved: sim.monthsSaved, emiFreed: 0 })
    left -= toLoan + sim.prepaymentCharge
  }

  return {
    steps,
    leftOver: left,
    totalNet: sum(steps, s => s.net),
    totalMonthsSaved: sum(steps, s => s.monthsSaved),
    emiFreed: sum(steps, s => s.emiFreed),
  }
}
