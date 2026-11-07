// ── Bank / Issuer Brand Config & Auto-Detection ─────────────────────────────

export const BANK_LIST = [
  { id: 'hdfc', name: 'HDFC', fullName: 'HDFC Bank', barColor: 'bg-blue-600', borderLeft: 'border-l-blue-600', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'sbi', name: 'SBI', fullName: 'SBI Card', barColor: 'bg-sky-500', borderLeft: 'border-l-sky-500', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'icici', name: 'ICICI', fullName: 'ICICI Bank', barColor: 'bg-orange-500', borderLeft: 'border-l-orange-500', badgeClass: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'axis', name: 'Axis', fullName: 'Axis Bank', barColor: 'bg-rose-800', borderLeft: 'border-l-rose-800', badgeClass: 'bg-rose-50 text-rose-800 border-rose-200' },
  { id: 'kotak', name: 'Kotak', fullName: 'Kotak Bank', barColor: 'bg-red-600', borderLeft: 'border-l-red-600', badgeClass: 'bg-red-50 text-red-700 border-red-200' },
  { id: 'amex', name: 'Amex', fullName: 'American Express', barColor: 'bg-cyan-600', borderLeft: 'border-l-cyan-600', badgeClass: 'bg-cyan-50 text-cyan-800 border-cyan-200' },
  { id: 'idfc', name: 'IDFC', fullName: 'IDFC FIRST', barColor: 'bg-amber-700', borderLeft: 'border-l-amber-700', badgeClass: 'bg-amber-50 text-amber-800 border-amber-200' },
  { id: 'indusind', name: 'IndusInd', fullName: 'IndusInd Bank', barColor: 'bg-red-800', borderLeft: 'border-l-red-800', badgeClass: 'bg-red-50 text-red-800 border-red-200' },
  { id: 'rbl', name: 'RBL', fullName: 'RBL Bank', barColor: 'bg-indigo-600', borderLeft: 'border-l-indigo-600', badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { id: 'yes', name: 'YES Bank', fullName: 'YES Bank', barColor: 'bg-blue-700', borderLeft: 'border-l-blue-700', badgeClass: 'bg-blue-50 text-blue-800 border-blue-200' },
  { id: 'bob', name: 'BOB', fullName: 'Bank of Baroda', barColor: 'bg-amber-600', borderLeft: 'border-l-amber-600', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'au', name: 'AU Bank', fullName: 'AU Small Finance', barColor: 'bg-purple-600', borderLeft: 'border-l-purple-600', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'federal', name: 'Federal', fullName: 'Federal Bank', barColor: 'bg-blue-500', borderLeft: 'border-l-blue-500', badgeClass: 'bg-blue-50 text-blue-600 border-blue-200' },
  { id: 'scb', name: 'StanC', fullName: 'Standard Chartered', barColor: 'bg-emerald-600', borderLeft: 'border-l-emerald-600', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'hsbc', name: 'HSBC', fullName: 'HSBC', barColor: 'bg-red-700', borderLeft: 'border-l-red-700', badgeClass: 'bg-red-50 text-red-700 border-red-200' },
  { id: 'onecard', name: 'OneCard', fullName: 'OneCard', barColor: 'bg-slate-900', borderLeft: 'border-l-slate-900', badgeClass: 'bg-slate-100 text-slate-800 border-slate-300' },
  { id: 'scapia', name: 'Scapia', fullName: 'Scapia (Federal)', barColor: 'bg-teal-600', borderLeft: 'border-l-teal-600', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200' },
]

/**
 * Detect the bank / issuer for a given card object.
 * Checks card.bank first (if explicitly selected), then scans nickname and card_name.
 */
export function getCardBank(card) {
  if (!card) return null
  const selected = card.bank_id || card.bank
  if (selected) {
    const found = BANK_LIST.find(b => b.id === selected.toLowerCase())
    if (found) return found
  }

  const text = `${card.nickname || ''} ${card.card_name || ''}`.toLowerCase()
  if (text.includes('hdfc')) return BANK_LIST.find(b => b.id === 'hdfc')
  if (text.includes('sbi')) return BANK_LIST.find(b => b.id === 'sbi')
  if (text.includes('icici')) return BANK_LIST.find(b => b.id === 'icici')
  if (text.includes('axis')) return BANK_LIST.find(b => b.id === 'axis')
  if (text.includes('kotak')) return BANK_LIST.find(b => b.id === 'kotak')
  if (text.includes('amex') || text.includes('american express')) return BANK_LIST.find(b => b.id === 'amex')
  if (text.includes('idfc')) return BANK_LIST.find(b => b.id === 'idfc')
  if (text.includes('indusind')) return BANK_LIST.find(b => b.id === 'indusind')
  if (text.includes('rbl')) return BANK_LIST.find(b => b.id === 'rbl')
  if (text.includes('yes bank') || text.includes('yes ') || text.startsWith('yes')) return BANK_LIST.find(b => b.id === 'yes')
  if (text.includes('bob') || text.includes('baroda')) return BANK_LIST.find(b => b.id === 'bob')
  if (text.includes('au ') || text.includes('au small') || text.includes('aubank')) return BANK_LIST.find(b => b.id === 'au')
  if (text.includes('scapia')) return BANK_LIST.find(b => b.id === 'scapia')
  if (text.includes('federal')) return BANK_LIST.find(b => b.id === 'federal')
  if (text.includes('standard chartered') || text.includes('stanc') || text.includes('scb')) return BANK_LIST.find(b => b.id === 'scb')
  if (text.includes('hsbc')) return BANK_LIST.find(b => b.id === 'hsbc')
  if (text.includes('onecard') || text.includes('one card')) return BANK_LIST.find(b => b.id === 'onecard')

  return null
}
