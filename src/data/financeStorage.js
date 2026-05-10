import { supabase } from '../lib/supabase'

// ── Local Storage (cache for non-auth / offline read fallback) ───────────────
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
    // Ignore quota / unavailability errors (e.g. private mode)
  }
}

// ── Supabase (cloud) ─────────────────────────────────────────────────────────

async function getCloudData(session) {
  const { data, error } = await supabase
    .from('finance_data')
    .select('id, data')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error

  const result = data?.length > 0
    ? { ...getDefaultData(), ...data[0].data }
    : getDefaultData()

  saveLocalData(result) // keep local cache in sync for offline reads
  return result
}

async function saveCloudData(session, financeData) {
  const { data: existing, error: selError } = await supabase
    .from('finance_data')
    .select('id')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (selError) throw selError

  if (existing?.length > 0) {
    const { error } = await supabase
      .from('finance_data')
      .update({ data: financeData })
      .eq('id', existing[0].id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('finance_data')
      .insert({ user_id: session.user.id, data: financeData })
    if (error) throw error
  }

  saveLocalData(financeData) // keep local cache in sync
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getFinanceData(session) {
  if (session) return await getCloudData(session)
  return getLocalData()
}

export async function saveFinanceData(session, data) {
  if (session) await saveCloudData(session, data)
  else saveLocalData(data)
}

// ── Cards ────────────────────────────────────────────────────────────────────

export async function getCards(session) {
  const d = await getFinanceData(session)
  return d.cards || []
}

export async function addCard(session, card) {
  const d = await getFinanceData(session)
  const newCard = { ...card, id: crypto.randomUUID(), total_paid: 0 }
  d.cards = [...(d.cards || []), newCard]
  await saveFinanceData(session, d)
  return newCard
}

export async function updateCard(session, id, updates) {
  const d = await getFinanceData(session)
  d.cards = (d.cards || []).map(c => c.id === id ? { ...c, ...updates } : c)
  await saveFinanceData(session, d)
}

export async function deleteCard(session, id) {
  const d = await getFinanceData(session)
  d.cards = (d.cards || []).filter(c => c.id !== id)
  await saveFinanceData(session, d)
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscriptions(session) {
  const d = await getFinanceData(session)
  return d.subscriptions || []
}

export async function addSubscription(session, sub) {
  const d = await getFinanceData(session)
  const newSub = { ...sub, id: crypto.randomUUID(), total_paid: 0 }
  d.subscriptions = [...(d.subscriptions || []), newSub]
  await saveFinanceData(session, d)
  return newSub
}

export async function updateSubscription(session, id, updates) {
  const d = await getFinanceData(session)
  d.subscriptions = (d.subscriptions || []).map(s => s.id === id ? { ...s, ...updates } : s)
  await saveFinanceData(session, d)
}

export async function deleteSubscription(session, id) {
  const d = await getFinanceData(session)
  d.subscriptions = (d.subscriptions || []).filter(s => s.id !== id)
  await saveFinanceData(session, d)
}

// ── Manual EMIs ──────────────────────────────────────────────────────────────

export async function getManualEmis(session) {
  const d = await getFinanceData(session)
  return d.emis || []
}

export async function addManualEmi(session, emi) {
  const d = await getFinanceData(session)
  const newEmi = { ...emi, id: crypto.randomUUID(), total_paid: 0 }
  d.emis = [...(d.emis || []), newEmi]
  await saveFinanceData(session, d)
  return newEmi
}

export async function updateManualEmi(session, id, updates) {
  const d = await getFinanceData(session)
  d.emis = (d.emis || []).map(e => e.id === id ? { ...e, ...updates } : e)
  await saveFinanceData(session, d)
}

export async function deleteManualEmi(session, id) {
  const d = await getFinanceData(session)
  d.emis = (d.emis || []).filter(e => e.id !== id)
  await saveFinanceData(session, d)
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function getExpenses(session) {
  const d = await getFinanceData(session)
  return d.expenses || []
}

export async function addExpense(session, expense) {
  const d = await getFinanceData(session)
  const newExp = { ...expense, id: crypto.randomUUID(), total_paid: 0 }
  d.expenses = [...(d.expenses || []), newExp]
  await saveFinanceData(session, d)
  return newExp
}

export async function updateExpense(session, id, updates) {
  const d = await getFinanceData(session)
  d.expenses = (d.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e)
  await saveFinanceData(session, d)
}

export async function deleteExpense(session, id) {
  const d = await getFinanceData(session)
  d.expenses = (d.expenses || []).filter(e => e.id !== id)
  await saveFinanceData(session, d)
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(session) {
  const d = await getFinanceData(session)
  return d.settings || { available_balance: 0 }
}

export async function saveSettings(session, settings) {
  const d = await getFinanceData(session)
  d.settings = { ...(d.settings || {}), ...settings }
  await saveFinanceData(session, d)
}
