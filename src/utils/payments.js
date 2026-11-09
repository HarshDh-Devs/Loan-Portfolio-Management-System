// ── Payment state transitions ───────────────────────────────────────────────
//
// Pure functions: given the CURRENT saved item, return the field updates for an
// action. They are run inside the storage layer against the freshest data, so
// totals and history are never computed from a stale on-screen copy.

import { cycleValue, getUpcomingDueCycleKey, normalizeMonthKey } from './cardDue'

const num = (v) => Number(v) || 0

/**
 * Which billing cycle a card's bill belongs to after an edit.
 * An outstanding bill from a past cycle stays attached to that cycle, so an
 * overdue bill stays overdue when you correct its amount or the card details.
 * Otherwise the bill is attached to the next upcoming due date.
 */
export function billCycleFor(card, dueDay = card.due_date, today = new Date()) {
  const current = normalizeMonthKey(card.bill_cycle)
  if (!card.paid && num(card.bill_amount) > 0 && current && card.due_date) {
    const upcoming = getUpcomingDueCycleKey(card.due_date, today)
    if (upcoming && cycleValue(current) < cycleValue(upcoming)) return current
  }
  if (dueDay) return getUpcomingDueCycleKey(dueDay, today)
  return current || null
}

/**
 * Mark paid (or undo it). `billOverride` is a bill typed on screen but not yet
 * saved; it is used as the bill being paid so the typed amount isn't lost.
 *
 * Marking paid stores `settle_undo` with exactly what changed, so undoing
 * restores the bill and removes the recorded payment instead of leaving a
 * phantom payment in the totals.
 */
export function toggleSettledUpdates(item, type, billOverride) {
  const isCard = type === 'card'
  const amountField = isCard ? 'bill_amount' : 'amount'

  if (!item.paid) {
    const hasOverride = billOverride !== undefined && billOverride !== null
    const bill = hasOverride ? num(billOverride) : num(item[amountField])
    const now = new Date().toISOString()
    const paymentId = crypto.randomUUID()

    const prevCycle = isCard
      ? (hasOverride ? billCycleFor({ ...item, bill_amount: bill }) : (item.bill_cycle ?? null))
      : null

    const updates = {
      paid: true,
      total_paid: num(item.total_paid) + bill,
      settle_undo: {
        payment_id: isCard && bill > 0 ? paymentId : null,
        amount: bill,
        prev: {
          [amountField]: bill,
          last_paid_amount: item.last_paid_amount ?? null,
          last_paid_at: item.last_paid_at ?? null,
          bill_cycle: prevCycle,
          settled_cycle: item.settled_cycle ?? null,
        },
      },
    }

    if (isCard) {
      updates.last_paid_amount = bill
      updates.last_paid_at = now
      if (bill > 0) {
        updates.payment_history = [...(item.payment_history || []), { id: paymentId, amount: bill, paid_at: now }]
      }
      updates.bill_amount = 0
      updates.settled_cycle = prevCycle || getUpcomingDueCycleKey(item.due_date)
    } else {
      updates.amount = 0
    }
    return updates
  }

  // Undo a settlement.
  const undo = item.settle_undo
  if (!undo) {
    // Settled before undo tracking existed: nothing reliable to reverse.
    return { paid: false }
  }

  const updates = {
    paid: false,
    settle_undo: null,
    [amountField]: undo.prev?.[amountField] ?? 0,
    total_paid: Math.max(0, num(item.total_paid) - num(undo.amount)),
  }
  if (isCard) {
    updates.payment_history = (item.payment_history || []).filter(p => !undo.payment_id || p.id !== undo.payment_id)
    updates.last_paid_amount = undo.prev?.last_paid_amount ?? null
    updates.last_paid_at = undo.prev?.last_paid_at ?? null
    updates.bill_cycle = undo.prev?.bill_cycle ?? item.bill_cycle ?? null
    updates.settled_cycle = undo.prev?.settled_cycle ?? null
  }
  return updates
}

/**
 * Delete one payment from a card's history, keeping every related field
 * consistent: total paid, the "last paid" record (so the deleted payment is
 * not re-added on the next load) and the undo record.
 * Returns null when the payment is already gone (so a double click can't
 * subtract it twice).
 */
export function removePaymentUpdates(card, payment) {
  const history = card.payment_history || []
  let idx = payment.id ? history.findIndex(p => p.id === payment.id) : -1
  if (idx < 0) {
    idx = history.findIndex(p => p.paid_at === payment.paid_at && num(p.amount) === num(payment.amount))
  }
  const isLastPaidRecord = Boolean(card.last_paid_at) && card.last_paid_at === payment.paid_at
  if (idx < 0 && !isLastPaidRecord) return null

  const nextHistory = idx >= 0 ? history.filter((_, i) => i !== idx) : history
  const updates = {
    payment_history: nextHistory,
    total_paid: Math.max(0, num(card.total_paid) - num(payment.amount)),
  }

  if (isLastPaidRecord) {
    const latest = nextHistory.reduce(
      (best, p) => (!best || new Date(p.paid_at) > new Date(best.paid_at) ? p : best),
      null,
    )
    updates.last_paid_amount = latest ? num(latest.amount) : null
    updates.last_paid_at = latest ? latest.paid_at : null
  }

  const undo = card.settle_undo
  const removed = idx >= 0 ? history[idx] : payment
  if (undo && ((undo.payment_id && removed.id === undo.payment_id) || (!removed.id && isLastPaidRecord))) {
    // The settlement's payment is gone; undoing it later must not subtract it again.
    updates.settle_undo = { ...undo, payment_id: null, amount: 0 }
  }
  return updates
}
