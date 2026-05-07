import { supabase } from '../lib/supabase'

// ── Local Storage Keys ──────────────────────────────────────────────────────
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
    if (raw) {
      const parsed = JSON.parse(raw)
      return { ...getDefaultData(), ...parsed }
    }
    return getDefaultData()
  } catch {
    return getDefaultData()
  }
}

function saveLocalData(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
}

// ── Supabase helpers ────────────────────────────────────────────────────────
async function getCloudData(session) {
  try {
    const { data, error } = await supabase
      .from('finance_data')
      .select('id, data')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (error) {
      // Table may not exist yet — fall back to local
      console.warn('finance_data table not found, using localStorage:', error.message)
      return getLocalData()
    }
    return data && data.length > 0 ? { ...getDefaultData(), ...data[0].data } : getDefaultData()
  } catch (err) {
    console.warn('Cloud finance data fetch failed, using localStorage:', err)
    return getLocalData()
  }
}

async function saveCloudData(session, financeData) {
  try {
    const { data: existing, error: selError } = await supabase
      .from('finance_data')
      .select('id')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(1)

    if (selError) {
      // Table doesn't exist — fall back to local
      saveLocalData(financeData)
      return
    }

    if (existing && existing.length > 0) {
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
    // Also keep localStorage in sync
    saveLocalData(financeData)
  } catch (err) {
    console.warn('Cloud finance data save failed, saving locally:', err)
    saveLocalData(financeData)
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getFinanceData(session) {
  if (session) return await getCloudData(session)
  return getLocalData()
}

export async function saveFinanceData(session, data) {
  if (session) await saveCloudData(session, data)
  else saveLocalData(data)
}

// ── Cards ───────────────────────────────────────────────────────────────────

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

// ── Subscriptions ───────────────────────────────────────────────────────────

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

// ── Manual EMIs ─────────────────────────────────────────────────────────────

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

// ── Expenses ────────────────────────────────────────────────────────────────

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

// ── Settings (Available Balance) ────────────────────────────────────────────

export async function getSettings(session) {
  const d = await getFinanceData(session)
  return d.settings || { available_balance: 0 }
}

export async function saveSettings(session, settings) {
  const d = await getFinanceData(session)
  d.settings = { ...(d.settings || {}), ...settings }
  await saveFinanceData(session, d)
}

// ── Supabase SQL migration hint ─────────────────────────────────────────────
// Run this in your Supabase SQL editor to enable cloud sync for finance data:
//
// create table if not exists finance_data (
//   id uuid primary key default gen_random_uuid(),
//   user_id uuid references auth.users(id) on delete cascade not null,
//   data jsonb not null default '{}',
//   created_at timestamptz default now()
// );
// alter table finance_data enable row level security;
// create policy "Users manage own finance data" on finance_data
//   for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
