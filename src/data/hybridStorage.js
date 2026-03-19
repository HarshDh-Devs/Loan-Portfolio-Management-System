import { supabase } from '../lib/supabase'

const LOCAL_KEY = 'lpms_loans'

function getLocalLoans() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) return JSON.parse(raw)
    const examples = [
      {
        id: 'example-1',
        nickname: 'Example Loan 1',
        type: 'Personal',
        lender: 'HDFC Bank',
        accountNumber: '',
        principal: 500000,
        annualInterestRate: 10.5,
        tenureMonths: 48,
        emiAmount: 12834,
        disbursementDate: '2023-06-01',
        firstEmiDate: '2023-07-01',
        fees: { processingFee: 5000, processingFeeGST: 900, insuranceCharges: 0, otherCharges: [] },
        prepayment: { allowed: true, chargePercent: 2, chargeFlatAmount: 0, minimumAmount: 10000, lockInMonths: 0 },
        foreclosure: { allowed: true, chargePercent: 3, chargeFlatAmount: 0, lockInMonths: 0 },
        gstOnInterest: false, gstOnInterestRate: 18,
        createdAt: new Date().toISOString(), monthlySnapshots: [],
      },
      {
        id: 'example-2',
        nickname: 'Example Loan 2',
        type: 'Car',
        lender: 'Kotak Mahindra Bank',
        accountNumber: '',
        principal: 650000,
        annualInterestRate: 9.2,
        tenureMonths: 60,
        emiAmount: 13521,
        disbursementDate: '2022-09-01',
        firstEmiDate: '2022-10-01',
        fees: { processingFee: 3500, processingFeeGST: 630, insuranceCharges: 0, otherCharges: [] },
        prepayment: { allowed: true, chargePercent: 2.5, chargeFlatAmount: 0, minimumAmount: 5000, lockInMonths: 0 },
        foreclosure: { allowed: true, chargePercent: 4, chargeFlatAmount: 0, lockInMonths: 0 },
        gstOnInterest: false, gstOnInterestRate: 18,
        createdAt: new Date().toISOString(), monthlySnapshots: [],
      },
    ]
    saveLocalLoans(examples)
    return examples
  } catch { return [] }
}

function saveLocalLoans(loans) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(loans))
}

async function getCloudLoans() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []

  const { data, error } = await supabase
    .from('loans')
    .select('id, data')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) throw error
  return data && data.length > 0 ? data[0].data : []
}

async function saveCloudLoans(loans) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not logged in')

  const { data: existing } = await supabase
    .from('loans')
    .select('id')
    .eq('user_id', session.user.id)
    .order('created_at', { ascending: false })
    .limit(1)

  if (existing && existing.length > 0) {
    const { error } = await supabase
      .from('loans')
      .update({ data: loans })
      .eq('id', existing[0].id)
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('loans')
      .insert({ user_id: session.user.id, data: loans })
    if (error) throw error
  }
}

export async function getLoans(session) {
  if (session) return await getCloudLoans()
  return getLocalLoans()
}

export async function addLoan(loan, session) {
  const loans = await getLoans(session)
  const toSave = {
    ...loan,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    monthlySnapshots: [],
  }
  const updated = [...loans, toSave]
  if (session) await saveCloudLoans(updated)
  else saveLocalLoans(updated)
  return toSave
}

export async function updateLoan(id, updates, session) {
  const loans = await getLoans(session)
  const updated = loans.map(l => l.id === id ? { ...l, ...updates } : l)
  if (session) await saveCloudLoans(updated)
  else saveLocalLoans(updated)
  return updated.find(l => l.id === id)
}

export async function deleteLoan(id, session) {
  const loans = await getLoans(session)
  const updated = loans.filter(l => l.id !== id)
  if (session) await saveCloudLoans(updated)
  else saveLocalLoans(updated)
}

export async function getLoanById(id, session) {
  const loans = await getLoans(session)
  return loans.find(l => l.id === id) ?? null
}

export async function migrateLocalToCloud() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return 0

  const localLoans = getLocalLoans()
  // Filter out example loans — never migrate those to cloud
  const realLocalLoans = localLoans.filter(l => l.id !== 'example-1' && l.id !== 'example-2')
  if (realLocalLoans.length === 0) return 0

  const cloudLoans = await getCloudLoans()
  const merged = [...cloudLoans]
  let count = 0
  for (const loan of realLocalLoans) {
    if (!cloudLoans.find(c => c.id === loan.id)) {
      merged.push(loan)
      count++
    }
  }
  await saveCloudLoans(merged)
  localStorage.removeItem(LOCAL_KEY)
  return count
}

export const LOAN_TYPES = [
  'Personal', 'Home', 'Car', 'Education', 'Credit Card', 'BNPL'
]