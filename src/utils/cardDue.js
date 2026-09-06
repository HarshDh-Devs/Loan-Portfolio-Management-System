export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function normalizeMonthKey(key) {
  if (!key) return null
  const [year, month] = String(key).split('-').map(Number)
  if (!year || !month) return String(key)
  return `${year}-${String(month).padStart(2, '0')}`
}

export function cycleValue(key) {
  if (!key) return 0
  const [year, month] = String(key).split('-').map(Number)
  return year * 12 + month
}

export function getUpcomingDueCycleKey(dueDay, today = new Date()) {
  const day = Number(dueDay)
  if (!day) return null
  const year = today.getFullYear()
  const month = today.getMonth()
  const dueThisMonth = Math.min(day, lastDayOfMonth(year, month))
  if (today.getDate() <= dueThisMonth) return monthKey(today)
  return monthKey(new Date(year, month + 1, 1))
}

function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function dueDateInCycle(dueDay, cycleKey) {
  const day = Number(dueDay)
  if (!day || !cycleKey) return null
  const [year, month] = String(cycleKey).split('-').map(Number)
  const clamped = Math.min(day, lastDayOfMonth(year, month - 1))
  return startOfDay(new Date(year, month - 1, clamped))
}

export function getUpcomingDueDate(dueDay, today = new Date()) {
  const key = getUpcomingDueCycleKey(dueDay, today)
  return dueDateInCycle(dueDay, key)
}

export function daysUntilDueDay(dueDay, today = new Date()) {
  const next = getUpcomingDueDate(dueDay, today)
  if (!next) return 1000
  const t = startOfDay(today)
  return Math.round((next - t) / (1000 * 60 * 60 * 24))
}

export function dueSortKey(item, today = new Date()) {
  if (!item?.due_date) return 1000
  const upcoming = getUpcomingDueCycleKey(item.due_date, today)
  const billedCycle = item.bill_cycle
  const unpaid = !item.paid && ((item.bill_amount || item.amount || 0) > 0)
  if (unpaid && billedCycle && upcoming && cycleValue(billedCycle) < cycleValue(upcoming)) {
    return cycleValue(billedCycle) - cycleValue(upcoming)
  }
  return daysUntilDueDay(item.due_date, today)
}

export function compareUpcomingDue(a, b) {
  return dueSortKey(a) - dueSortKey(b)
}

export function nextCardCycleUpdates(card, today, monthChanged) {
  if (!card.paid) return null

  if (!card.due_date) {
    return monthChanged ? { paid: false } : null
  }

  const upcoming = getUpcomingDueCycleKey(card.due_date, today)
  const settled = card.settled_cycle || card.bill_cycle
  if (settled) {
    return upcoming && settled !== upcoming ? { paid: false } : null
  }

  const dueThisMonth = Math.min(Number(card.due_date), lastDayOfMonth(today.getFullYear(), today.getMonth()))
  return today.getDate() > dueThisMonth ? { paid: false } : null
}

export function daysBetween(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / (1000 * 60 * 60 * 24))
}

export function formatShortDate(date) {
  if (!date) return ''
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function formatDueCaption(date, daysOverdue = 0) {
  if (!date) return '—'
  const dateStr = formatShortDate(date)
  if (daysOverdue > 0) {
    return `${dateStr} · Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`
  }
  const today = startOfDay(new Date())
  const days = Math.round((startOfDay(date) - today) / (1000 * 60 * 60 * 24))
  if (days === 0) return `${dateStr} · Today`
  if (days === 1) return `${dateStr} · tomorrow`
  if (days > 1) return `${dateStr} · in ${days} days`
  return dateStr
}

export function getCardDueInfo(card, today = new Date()) {
  const dueDay = Number(card.due_date)
  const bill = card.bill_amount || 0

  if (card.paid) {
    const date = dueDay ? getUpcomingDueDate(dueDay, today) : null
    return { status: 'settled', date, daysOverdue: 0, caption: date ? formatDueCaption(date) : 'Settled' }
  }

  if (!dueDay) {
    return {
      status: bill > 0 ? 'upcoming' : 'no_bill',
      date: null,
      daysOverdue: 0,
      caption: 'No due date',
    }
  }

  const upcomingKey = getUpcomingDueCycleKey(dueDay, today)
  const upcomingDate = dueDateInCycle(dueDay, upcomingKey)
  const billed = card.bill_cycle
  const isOverdue = bill > 0 && billed && upcomingKey && cycleValue(billed) < cycleValue(upcomingKey)

  if (isOverdue) {
    const pastDue = dueDateInCycle(dueDay, billed)
    const daysOverdue = Math.max(1, daysBetween(pastDue, today))
    return {
      status: 'overdue',
      date: pastDue,
      daysOverdue,
      caption: formatDueCaption(pastDue, daysOverdue),
    }
  }

  if (bill <= 0) {
    return {
      status: 'no_bill',
      date: upcomingDate,
      daysOverdue: 0,
      caption: formatDueCaption(upcomingDate),
    }
  }

  const days = daysUntilDueDay(dueDay, today)
  let status = 'upcoming'
  if (days === 0) status = 'due_today'
  else if (days > 0 && days <= 3) status = 'due_soon'

  return {
    status,
    date: upcomingDate,
    daysOverdue: 0,
    caption: formatDueCaption(upcomingDate),
  }
}

export const CARD_STATUS = {
  settled: { label: 'Settled', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  overdue: { label: 'Overdue', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  due_today: { label: 'Due today', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  due_soon: { label: 'Due soon', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  no_bill: { label: 'Bill not set', className: 'bg-slate-50 text-slate-500 border-slate-200' },
  upcoming: { label: 'Upcoming', className: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
}

export function cardRowClass(status) {
  if (status === 'overdue') return 'border-rose-200 bg-rose-50/30'
  if (status === 'due_today') return 'border-amber-200 bg-amber-50/40'
  if (status === 'due_soon') return 'border-orange-200'
  if (status === 'settled') return 'border-emerald-100'
  return 'border-gray-200'
}

export function getFeeWaiverInfo(card, today = new Date()) {
  if (!card || card.annual_fee_type !== 'paid') return null
  const feeMonth = card.fee_month || ''
  const currentMonth = MONTH_NAMES[today.getMonth()]
  const feeHitsThisMonth = feeMonth === currentMonth
  const waiver = Number(card.waiver_amount) || 0
  const spent = Number(card.total_paid) || 0
  const remaining = Math.max(0, waiver - spent)
  const met = waiver > 0 && spent >= waiver
  const pct = waiver > 0 ? Math.min(100, Math.round((spent / waiver) * 100)) : 0
  return {
    feeHitsThisMonth,
    feeMonth,
    feeAmount: Number(card.annual_fee) || 0,
    waiver,
    spent,
    remaining,
    met,
    pct,
  }
}

export function ensureCardSortOrder(cards) {
  const maxExisting = cards.reduce((m, c) => Math.max(m, c.sort_order ?? -1), -1)
  let next = maxExisting
  let changed = false
  const assigned = cards.map((c, i) => {
    if (c.sort_order == null) {
      changed = true
      next += 1
      return { ...c, sort_order: cards.some(x => x.sort_order != null) ? next : i }
    }
    return c
  })
  return { cards: assigned, changed }
}
