// ── Loan status (active vs closed) ──────────────────────────────────────────
//
// A closed loan keeps all of its data and is only marked closed:
//   loan.status  = 'closed'
//   loan.closure = {
//     type:        'preclosed' | 'completed',
//     closed_on:   'YYYY-MM-DD',
//     amount_paid: total paid to the lender at closure (incl. charges), 0 if completed,
//     charges:     foreclosure charges included in amount_paid,
//     note:        optional text,
//     closed_at:   ISO timestamp of when it was marked closed,
//   }
// Every screen that shows outstanding amounts, EMIs, alerts or suggestions
// must use `activeLoans()` so closed loans never count.

import { generateAmortizationSchedule } from '../math/engine'

const num = (v) => Number(v) || 0

export const isLoanClosed = (loan) => loan?.status === 'closed'

export const activeLoans = (loans) => (loans || []).filter(l => !isLoanClosed(l))
export const closedLoans = (loans) => (loans || []).filter(isLoanClosed)

export const CLOSURE_LABEL = { preclosed: 'Pre-closed', completed: 'Completed' }

/**
 * What a closed loan cost in the end, based on the EMIs due up to the closure
 * date plus the closure payment.
 */
export function closedLoanSummary(loan) {
  const closure = loan.closure || {}
  const schedule = generateAmortizationSchedule(loan)
  const cutoff = closure.closed_on ? new Date(closure.closed_on) : new Date()
  cutoff.setHours(23, 59, 59, 999)

  const paidRows = schedule.filter(r => new Date(r.date) <= cutoff)
  const futureRows = schedule.filter(r => new Date(r.date) > cutoff)

  const emiTotal = paidRows.reduce((s, r) => s + num(r.emiPaid) + num(r.gstOnInterest), 0)
  const interestPaid = paidRows.reduce((s, r) => s + num(r.interestComponent), 0)
  const closureAmount = closure.type === 'preclosed' ? num(closure.amount_paid) : 0
  const charges = closure.type === 'preclosed' ? num(closure.charges) : 0
  const interestAvoided = futureRows.reduce((s, r) => s + num(r.interestComponent), 0)

  return {
    emisPaid: paidRows.length,
    totalPaid: Math.round(emiTotal + closureAmount),
    interestPaid: Math.round(interestPaid),
    charges: Math.round(charges),
    // Interest you no longer pay because you closed early, net of charges.
    interestSaved: closure.type === 'preclosed' ? Math.round(Math.max(0, interestAvoided - charges)) : 0,
  }
}
