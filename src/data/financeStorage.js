import { supabase } from '../lib/supabase'

// ── Default data ─────────────────────────────────────────────────────────────
const LOCAL_KEY = 'lpms_finance_data'

function getDefaultData() {
  return {
    cards: [],
    subscriptions: [],
    emis: [],
    expenses: [],
    custom_trackers: [],
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
    // Ignore quota / private-mode errors (this is only a cache when signed in)
  }
}

// ── Write model ──────────────────────────────────────────────────────────────
//
// All finance data lives in ONE JSON blob per user. Every write goes through
// `mutate()`, which guarantees:
//
//  1. Serialized: writes run one at a time, so two clicks can never interleave.
//  2. Fresh base: each write re-reads the latest saved blob (Supabase row, or
//     localStorage in guest mode) and applies ONLY its own change to it. A tab
//     or device holding an old copy can therefore never overwrite changes made
//     elsewhere; it only adds its own edit on top.
//  3. All-or-nothing: the change is applied to a copy. The in-memory cache and
//     localStorage are only updated after the save succeeds, so a failed save
//     leaves no half-applied or "phantom" values behind.
//  4. Revision counter (`_rev`): bumped on every save, so we can tell when data
//     changed somewhere else and notify the UI to refresh.

let _cache = null          // Last known saved blob (read cache)
let _rowId = null          // Supabase row ID of the user's blob
let _cachedUserId = null   // Which user the cache belongs to
let _queue = Promise.resolve()  // Promise chain serializing all operations

function serialized(asyncFn) {
  const task = _queue.then(asyncFn)
  _queue = task.catch(() => { })  // Keep the chain alive even on rejection
  return task
}

const clone = (obj) => JSON.parse(JSON.stringify(obj))
const revOf = (d) => Number(d?._rev) || 0

// ── Change notifications (another tab/device changed the data) ───────────────

const _listeners = new Set()

export function onFinanceDataChanged(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

function emitChanged(data) {
  const snap = snapshot(data)
  _listeners.forEach(cb => {
    try { cb(snap) } catch (err) { console.error(err) }
  })
}

function snapshot(d) {
  const c = clone(d)
  return {
    cards: c.cards || [],
    subscriptions: c.subscriptions || [],
    expenses: c.expenses || [],
    emis: c.emis || [],
    custom_trackers: c.custom_trackers || [],
    settings: c.settings || { available_balance: 0 },
  }
}

// Guest mode: another tab of this browser saved to localStorage.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LOCAL_KEY || _cachedUserId !== null || !_cache) return
    const fresh = repair(getLocalData())
    if (revOf(fresh) !== revOf(_cache)) {
      _cache = fresh
      emitChanged(_cache)
    }
  })
}

// ── Loading ──────────────────────────────────────────────────────────────────

// Give every tracker entry a unique ID (repairs legacy duplicates).
function repair(d) {
  for (const tracker of d.custom_trackers || []) {
    const seenIds = new Set()
    if (tracker.entries) {
      tracker.entries = tracker.entries.map(entry => {
        if (!entry.id || seenIds.has(entry.id)) {
          return { ...entry, id: crypto.randomUUID() }
        }
        seenIds.add(entry.id)
        return entry
      })
    }
  }
  return d
}

/** Read the latest saved blob from its source of truth (never from the cache). */
async function loadFresh(session) {
  const userId = session?.user?.id || null
  if (userId !== _cachedUserId) {
    _cache = null
    _rowId = null
    _cachedUserId = userId
  }

  if (!session) return repair(getLocalData())

  const { data, error } = await supabase
    .from('finance_data')
    .select('id, data')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  if (data?.length > 0) {
    _rowId = data[0].id
    return repair({ ...getDefaultData(), ...data[0].data })
  }
  _rowId = null
  return getDefaultData()
}

/** Cached read: hits storage only on first load or after a user switch. */
async function ensureLoaded(session) {
  const userId = session?.user?.id || null
  if (_cache && _cachedUserId === userId) return _cache
  const fresh = await loadFresh(session)
  _cache = fresh
  saveLocalData(_cache)
  return _cache
}

async function persist(session, finData) {
  if (!session) {
    // Guest mode: localStorage IS the database, so a failed write must fail loudly.
    localStorage.setItem(LOCAL_KEY, JSON.stringify(finData))
    return
  }
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

/**
 * Apply `mutator(draft)` to the latest saved data and save it.
 * Resolves to (a copy of) whatever the mutator returns. Rejects if the save
 * fails, in which case nothing (cache, localStorage, cloud) has changed.
 */
function mutate(session, mutator) {
  return serialized(async () => {
    const base = await loadFresh(session)
    const draft = clone(base)
    const result = mutator(draft)
    draft._rev = revOf(base) + 1
    draft._saved_at = new Date().toISOString()

    await persist(session, draft)

    const changedElsewhere = Boolean(_cache) && revOf(base) !== revOf(_cache)
    _cache = draft
    saveLocalData(draft)
    if (changedElsewhere) emitChanged(draft)
    return result === undefined || result === null ? result : clone(result)
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

export function resetFinanceCache() {
  _cache = null
  _rowId = null
  _cachedUserId = null
}

/** Load all finance data (cached after the first call). Returns copies. */
export function loadAllFinanceData(session) {
  return serialized(async () => snapshot(await ensureLoaded(session)))
}

/**
 * Re-read the latest saved data (e.g. when the tab regains focus). Notifies
 * `onFinanceDataChanged` listeners if it differs from what this tab had.
 */
export function refreshFinanceData(session) {
  return serialized(async () => {
    const fresh = await loadFresh(session)
    const changed = !_cache || revOf(fresh) !== revOf(_cache)
    _cache = fresh
    saveLocalData(fresh)
    if (changed) emitChanged(fresh)
    return snapshot(fresh)
  })
}

export function getFinanceData(session) {
  return serialized(async () => clone(await ensureLoaded(session)))
}

/** Run `mutator(d)` against the latest saved data and save. Resolves to a snapshot. */
export function patchFinanceData(session, mutator) {
  return mutate(session, (d) => { mutator(d); return snapshot(d) })
}

// ── Generic item helpers (cards / subscriptions / expenses / emis) ───────────

function addItem(session, collection, item, extra = () => ({})) {
  return mutate(session, (d) => {
    const list = d[collection] || []
    const newItem = { total_paid: 0, ...item, ...extra(list), id: crypto.randomUUID() }
    d[collection] = [...list, newItem]
    return newItem
  })
}

/**
 * Update one item using a function of its CURRENT saved value, so derived
 * fields (totals, payment history) are computed from fresh data, not from a
 * possibly stale copy on screen. `fn` may return null for "no change".
 * Resolves to the saved item, or null if it no longer exists.
 */
export function updateItemWith(session, collection, id, fn) {
  return mutate(session, (d) => {
    const list = d[collection] || []
    const current = list.find(x => x.id === id)
    if (!current) return null
    const updates = fn(clone(current))
    if (!updates) return current
    const next = { ...current, ...updates, id: current.id }
    d[collection] = list.map(x => (x.id === id ? next : x))
    return next
  })
}

function updateItem(session, collection, id, updates) {
  return updateItemWith(session, collection, id, () => updates)
}

function deleteItem(session, collection, id) {
  return mutate(session, (d) => {
    d[collection] = (d[collection] || []).filter(x => x.id !== id)
  })
}

const nextSortOrder = (list) => ({
  sort_order: list.reduce((m, c) => Math.max(m, c.sort_order ?? -1), -1) + 1,
})

// New items start counting "total paid" from the current month.
const startedNow = () => {
  const d = new Date()  // local month, not UTC
  return { total_paid_since: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function getCards(session) {
  return serialized(async () => clone((await ensureLoaded(session)).cards || []))
}

export const addCard = (session, card) =>
  addItem(session, 'cards', card, (list) => ({ ...nextSortOrder(list), ...startedNow() }))
export const updateCard = (session, id, updates) => updateItem(session, 'cards', id, updates)
export const deleteCard = (session, id) => deleteItem(session, 'cards', id)

export function reorderCards(session, orderedIds) {
  return mutate(session, (d) => {
    const orderMap = Object.fromEntries(orderedIds.map((id, i) => [id, i]))
    d.cards = (d.cards || []).map(c =>
      orderMap[c.id] == null ? c : { ...c, sort_order: orderMap[c.id] }
    )
  })
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export function getSubscriptions(session) {
  return serialized(async () => clone((await ensureLoaded(session)).subscriptions || []))
}

export const addSubscription = (session, sub) => addItem(session, 'subscriptions', sub, startedNow)
export const updateSubscription = (session, id, updates) => updateItem(session, 'subscriptions', id, updates)
export const deleteSubscription = (session, id) => deleteItem(session, 'subscriptions', id)

// ── Manual EMIs ──────────────────────────────────────────────────────────────

export function getManualEmis(session) {
  return serialized(async () => clone((await ensureLoaded(session)).emis || []))
}

export const addManualEmi = (session, emi) => addItem(session, 'emis', emi, startedNow)
export const updateManualEmi = (session, id, updates) => updateItem(session, 'emis', id, updates)
export const deleteManualEmi = (session, id) => deleteItem(session, 'emis', id)

// ── Expenses ─────────────────────────────────────────────────────────────────

export function getExpenses(session) {
  return serialized(async () => clone((await ensureLoaded(session)).expenses || []))
}

export const addExpense = (session, expense) => addItem(session, 'expenses', expense, startedNow)
export const updateExpense = (session, id, updates) => updateItem(session, 'expenses', id, updates)
export const deleteExpense = (session, id) => deleteItem(session, 'expenses', id)

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(session) {
  return serialized(async () => clone((await ensureLoaded(session)).settings || { available_balance: 0 }))
}

export function saveSettings(session, settings) {
  return mutate(session, (d) => {
    d.settings = { ...(d.settings || {}), ...settings }
  })
}

// ── Custom Trackers ──────────────────────────────────────────────────────────

export function getCustomTrackers(session) {
  return serialized(async () => clone((await ensureLoaded(session)).custom_trackers || []))
}

export function addCustomTracker(session, tracker) {
  return mutate(session, (d) => {
    const maxOrder = (d.custom_trackers || []).reduce((m, c) => Math.max(m, c.sort_order ?? -1), -1)
    const newTracker = {
      show_total: true,
      is_collapsed: false,
      sort_order: maxOrder + 1,
      columns: [
        { id: crypto.randomUUID(), name: 'Date', type: 'date' },
        { id: crypto.randomUUID(), name: 'Amount', type: 'amount' },
        { id: crypto.randomUUID(), name: 'Description', type: 'text' }
      ],
      entries: [],
      ...tracker,
      name: tracker.name || 'Untitled Tracker',
      id: crypto.randomUUID(),
    }
    d.custom_trackers = [...(d.custom_trackers || []), newTracker]
    return newTracker
  })
}

/** Update tracker settings (name, columns, flags). Never touches its entries. */
export function updateCustomTracker(session, id, updates) {
  return mutate(session, (d) => {
    d.custom_trackers = (d.custom_trackers || []).map(t =>
      t.id === id ? { ...t, ...updates, id: t.id, entries: t.entries } : t
    )
  })
}

export function deleteCustomTracker(session, id) {
  return mutate(session, (d) => {
    d.custom_trackers = (d.custom_trackers || []).filter(t => t.id !== id)
  })
}

export function reorderCustomTrackers(session, orderedIds) {
  return mutate(session, (d) => {
    const orderMap = Object.fromEntries(orderedIds.map((id, i) => [id, i]))
    d.custom_trackers = (d.custom_trackers || []).map(t =>
      orderMap[t.id] == null ? t : { ...t, sort_order: orderMap[t.id] }
    )
  })
}

export function addTrackerEntry(session, trackerId, entry) {
  return mutate(session, (d) => {
    const tracker = (d.custom_trackers || []).find(t => t.id === trackerId)
    if (!tracker) return null
    const maxOrder = (tracker.entries || []).reduce((m, e) => Math.max(m, e.sort_order ?? -1), -1)
    const newEntry = {
      values: {},
      notes: [],
      created_at: new Date().toISOString(),
      ...entry,
      id: crypto.randomUUID(),
      sort_order: maxOrder + 1,
    }
    tracker.entries = [...(tracker.entries || []), newEntry]
    return newEntry
  })
}

export function updateTrackerEntry(session, trackerId, entryId, updates) {
  return mutate(session, (d) => {
    const tracker = (d.custom_trackers || []).find(t => t.id === trackerId)
    if (!tracker) return
    tracker.entries = (tracker.entries || []).map(e =>
      e.id === entryId ? { ...e, ...updates, id: e.id } : e
    )
  })
}

/**
 * Update one entry's notes from its CURRENT saved notes (never a stale copy).
 * Resolves to the saved notes array, or null if the entry no longer exists.
 */
export function updateTrackerEntryNotes(session, trackerId, entryId, fn) {
  return mutate(session, (d) => {
    const tracker = (d.custom_trackers || []).find(t => t.id === trackerId)
    const entry = tracker?.entries?.find(e => e.id === entryId)
    if (!entry) return null
    entry.notes = fn([...(entry.notes || [])])
    return entry.notes
  })
}

export function deleteTrackerEntry(session, trackerId, entryId) {
  return mutate(session, (d) => {
    const tracker = (d.custom_trackers || []).find(t => t.id === trackerId)
    if (!tracker) return
    tracker.entries = (tracker.entries || []).filter(e => e.id !== entryId)
  })
}

export function reorderTrackerEntries(session, trackerId, orderedEntryIds) {
  return mutate(session, (d) => {
    const tracker = (d.custom_trackers || []).find(t => t.id === trackerId)
    if (!tracker) return
    const orderMap = Object.fromEntries(orderedEntryIds.map((id, i) => [id, i]))
    tracker.entries = (tracker.entries || []).map(e =>
      orderMap[e.id] == null ? e : { ...e, sort_order: orderMap[e.id] }
    )
  })
}
