import { supabase } from '../lib/supabase'

export const LOAN_TYPES = [
  'Personal', 'Home', 'Car', 'Education', 'Credit Card', 'BNPL'
]

// ── Auth ─────────────────────────────────────────────────────

export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}

// ── Internal helper ───────────────────────────────────────────

async function getUserLoansRow() {
  const { data, error } = await supabase
    .from('loans')
    .select('id, data')
    .single()

  if (error && error.code === 'PGRST116') return null
  if (error) throw error
  return data
}

// ── Loans CRUD ───────────────────────────────────────────────

export async function getLoans() {
  const row = await getUserLoansRow()
  return row ? row.data : []
}

export async function saveAllLoans(loans) {
  const row = await getUserLoansRow()
  if (row) {
    const { error } = await supabase
      .from('loans')
      .update({ data: loans })
      .eq('id', row.id)
    if (error) throw error
  } else {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('loans')
      .insert({ user_id: user.id, data: [] })
    if (error) throw error

    const { error: updateError } = await supabase
      .from('loans')
      .update({ data: loans })
      .eq('user_id', user.id)
    if (updateError) throw updateError
  }
}

export async function addLoan(loan) {
  const loans = await getLoans()
  const toSave = {
    ...loan,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    monthlySnapshots: [],
  }
  await saveAllLoans([...loans, toSave])
  return toSave
}

export async function updateLoan(id, updates) {
  const loans = await getLoans()
  const updated = loans.map(l => l.id === id ? { ...l, ...updates } : l)
  await saveAllLoans(updated)
  return updated.find(l => l.id === id)
}

export async function deleteLoan(id) {
  const loans = await getLoans()
  await saveAllLoans(loans.filter(l => l.id !== id))
}

export async function getLoanById(id) {
  const loans = await getLoans()
  return loans.find(l => l.id === id) ?? null
}

export function createLoanTemplate() {
  return {
    id: crypto.randomUUID(),
    nickname: '',
    type: 'Personal',
    lender: '',
    accountNumber: '',
    principal: 0,
    annualInterestRate: 0,
    tenureMonths: 0,
    emiAmount: 0,
    disbursementDate: '',
    firstEmiDate: '',
    fees: {
      processingFee: 0,
      processingFeeGST: 0,
      insuranceCharges: 0,
      otherCharges: [],
    },
    prepayment: {
      allowed: null,
      chargePercent: 0,
      chargeFlatAmount: 0,
      minimumAmount: 0,
      lockInMonths: 0,
    },
    foreclosure: {
      allowed: null,
      chargePercent: 0,
      chargeFlatAmount: 0,
      lockInMonths: 0,
    },
    gstOnInterest: false,
    gstOnInterestRate: 18,
    createdAt: new Date().toISOString(),
    monthlySnapshots: [],
  }
}