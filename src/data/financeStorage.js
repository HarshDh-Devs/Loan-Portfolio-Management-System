import { supabase } from '../lib/supabase'

// ── Default data ─────────────────────────────────────────────────────────────
const LOCAL_KEY = 'lpms_finance_data'

function getDefaultData() {
  return {
    cards: [],
    subscriptions: [],
    emis: [],
    expenses: [],
    settings: { available_balance: 0 },
  }
}

// ── Local Storage (offline fallback + cache sync) ────────────────────────────

function getLocalData() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    return raw ? { ...getDefaultData(), ...JSON.parse(raw) } : getDefaultData()
  } catch {
    return getDefaultData()
  }
}

function saveLocalData(data) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
  } catch {
    // Ignore quota / private-mode errors
  }
}

// ── Serialized Write Queue + In-Memory Cache ─────────────────────────────────
//
// ROOT FIX for data corruption (bills swapping, paid not persisting):
//
// Every read-modify-write operation is serialized through a single promise
// chain. This guarantees operations execute one-at-a-time, so no two
// concurrent writes can overwrite each other (the "lost update" race).
//
// The in-memory cache means subsequent reads are instant and always reflect
// the latest state — no stale reads from Supabase mid-operation.

let _cache = null          // In-memory finance data blob (source of truth after load)
let _rowId = null          // Cached Supabase row ID (avoids extra SELECT on every save)
let _cachedUserId = null   // Tracks which user the cache belongs to
let _queue = Promise.resolve()  // Promise chain serializing all mutations

/**
 * Enqueue an async operation so it waits for all prior operations to finish.
 * This is the core concurrency fix — no two operations can overlap.
 */
function serialized(asyncFn) {
  const task = _queue.then(asyncFn)
  _queue = task.catch(() => { })  // Keep the chain alive even on rejection
  return task
}

/**
 * Load finance data into the in-memory cache. First call hits Supabase
 * (or localStorage for offline). Subsequent calls return instantly from cache.
 * Automatically resets if the user session changes.
 */
async function ensureLoaded(session) {
  const userId = session?.user?.id || null

  // If cache exists and belongs to the same user, return it instantly
  if (_cache && _cachedUserId === userId) return _cache

  // Reset for new user / first load
  _cache = null
  _rowId = null
  _cachedUserId = userId

  if (session) {
    const { data, error } = await supabase
      .from('finance_data')
      .select('id, data')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    if (data?.length > 0) {
      _rowId = data[0].id
      _cache = { ...getDefaultData(), ...data[0].data }
    } else {
      _cache = getDefaultData()
    }
  } else {
    _cache = getLocalData()
  }

  saveLocalData(_cache)
  return _cache
}

/**
 * Persist the current cache state to storage. Updates localStorage immediately,
 * then writes to Supabase in a single UPDATE using the cached row ID
 * (no extra SELECT round-trip).
 */
async function persist(session, finData) {
  saveLocalData(finData)
  if (!session) return

  if (_rowId) {
    const { error } = await supabase
      .from('finance_data')
      .update({ data: finData })
      .eq('id', _rowId)
    if (error) throw error
  } else {
    const { data: inserted, error } = await supabase
      .from('finance_data')
      .insert({ user_id: session.user.id, data: finData })
      .select('id')
    if (error) throw error
    if (inserted?.length > 0) _rowId = inserted[0].id
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reset the in-memory cache. Call on logout or when switching users.
 */
export function resetFinanceCache() {
  _cache = null
  _rowId = null
  _cachedUserId = null
}

/**
 * Load all finance data in a single call. Returns { cards, subscriptions,
 * expenses, emis, settings }. Use this instead of calling getCards +
 * getSubscriptions + getExpenses + getSettings separately (avoids 4
 * redundant reads of the same blob).
 */
export function loadAllFinanceData(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return {
      cards: d.cards || [],
      subscriptions: d.subscriptions || [],
      expenses: d.expenses || [],
      emis: d.emis || [],
      settings: d.settings || { available_balance: 0 },
    }
  })
}

export function getFinanceData(session) {
  return serialized(() => ensureLoaded(session))
}

export function saveFinanceData(session, data) {
  return serialized(async () => {
    _cache = data
    await persist(session, data)
  })
}

export function patchFinanceData(session, mutator) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    mutator(d)
    await persist(session, d)
    return d
  })
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function getCards(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return d.cards || []
  })
}

export function addCard(session, card) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    const maxOrder = (d.cards || []).reduce((m, c) => Math.max(m, c.sort_order ?? -1), -1)
    const newCard = { ...card, id: crypto.randomUUID(), total_paid: 0, sort_order: maxOrder + 1 }
    d.cards = [...(d.cards || []), newCard]
    await persist(session, d)
    return newCard
  })
}

export function updateCard(session, id, updates) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.cards = (d.cards || []).map(c => c.id === id ? { ...c, ...updates } : c)
    await persist(session, d)
  })
}

export function deleteCard(session, id) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.cards = (d.cards || []).filter(c => c.id !== id)
    await persist(session, d)
  })
}

export function reorderCards(session, orderedIds) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    const orderMap = Object.fromEntries(orderedIds.map((id, i) => [id, i]))
    d.cards = (d.cards || []).map(c =>
      orderMap[c.id] == null ? c : { ...c, sort_order: orderMap[c.id] }
    )
    await persist(session, d)
  })
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export function getSubscriptions(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return d.subscriptions || []
  })
}

export function addSubscription(session, sub) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    const newSub = { ...sub, id: crypto.randomUUID(), total_paid: 0 }
    d.subscriptions = [...(d.subscriptions || []), newSub]
    await persist(session, d)
    return newSub
  })
}

export function updateSubscription(session, id, updates) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.subscriptions = (d.subscriptions || []).map(s => s.id === id ? { ...s, ...updates } : s)
    await persist(session, d)
  })
}

export function deleteSubscription(session, id) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.subscriptions = (d.subscriptions || []).filter(s => s.id !== id)
    await persist(session, d)
  })
}

// ── Manual EMIs ──────────────────────────────────────────────────────────────

export function getManualEmis(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return d.emis || []
  })
}

export function addManualEmi(session, emi) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    const newEmi = { ...emi, id: crypto.randomUUID(), total_paid: 0 }
    d.emis = [...(d.emis || []), newEmi]
    await persist(session, d)
    return newEmi
  })
}

export function updateManualEmi(session, id, updates) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.emis = (d.emis || []).map(e => e.id === id ? { ...e, ...updates } : e)
    await persist(session, d)
  })
}

export function deleteManualEmi(session, id) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.emis = (d.emis || []).filter(e => e.id !== id)
    await persist(session, d)
  })
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export function getExpenses(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return d.expenses || []
  })
}

export function addExpense(session, expense) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    const newExp = { ...expense, id: crypto.randomUUID(), total_paid: 0 }
    d.expenses = [...(d.expenses || []), newExp]
    await persist(session, d)
    return newExp
  })
}

export function updateExpense(session, id, updates) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.expenses = (d.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e)
    await persist(session, d)
  })
}

export function deleteExpense(session, id) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.expenses = (d.expenses || []).filter(e => e.id !== id)
    await persist(session, d)
  })
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(session) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    return d.settings || { available_balance: 0 }
  })
}

export function saveSettings(session, settings) {
  return serialized(async () => {
    const d = await ensureLoaded(session)
    d.settings = { ...(d.settings || {}), ...settings }
    await persist(session, d)
  })
}
