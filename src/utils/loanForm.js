// Shared by Add Loan and Edit Loan: the form's shape, converting between a
// saved loan and the form, and validation. Keeping one copy means both pages
// always save the same fields (Edit Loan used to wipe prepayment terms).

export const emptyLoanForm = {
  nickname: '', type: 'Personal', lender: '', accountNumber: '',
  principal: '', annualInterestRate: '', interestType: '', tenureMonths: '', emiAmount: '',
  disbursementDate: '', firstEmiDate: '', apr: '',
  processingFee: '', processingFeeGST: '', insuranceCharges: '', otherCharges: [],
  gstOnInterest: false,
  prepaymentAllowed: 'null', prepaymentChargePercent: '', prepaymentChargeFlatAmount: '',
  prepaymentMinimumAmount: '', prepaymentLockInMonths: '', prepaymentChargeGst: false, prepaymentSteps: [],
  foreclosureAllowed: 'true', foreclosureChargePercent: '', foreclosureChargeFlatAmount: '',
  foreclosureLockInMonths: '', foreclosureChargeGst: false, foreclosureSteps: [],
}

// Charges that change after some EMIs, e.g. "3% up to 36 EMIs, 2% after".
// The form keeps the starting rate in ...ChargePercent and later rates as steps.
function tiersToForm(terms) {
  const tiers = (terms?.chargeTiers || []).filter(t => Number.isFinite(Number(t.percent)))
    .sort((a, b) => (Number(a.afterEmis) || 0) - (Number(b.afterEmis) || 0))
  if (!tiers.length) return { start: null, steps: [] }
  const startTier = tiers.find(t => !(Number(t.afterEmis) > 0))
  return {
    start: startTier ? Number(startTier.percent) : null,
    steps: tiers.filter(t => Number(t.afterEmis) > 0).map(t => ({ afterEmis: String(t.afterEmis), percent: String(t.percent) })),
  }
}

function stepsToTiers(startPercent, steps) {
  const valid = steps
    .filter(st => st.afterEmis !== '' && st.percent !== '' && Number(st.afterEmis) > 0)
    .map(st => ({ afterEmis: Math.round(Number(st.afterEmis)), percent: Number(st.percent) }))
    .sort((a, b) => a.afterEmis - b.afterEmis)
  return valid.length ? [{ afterEmis: 0, percent: startPercent }, ...valid] : []
}

const str = (v) => (v === null || v === undefined ? '' : String(v))
const tri = (v) => (v === true ? 'true' : v === false ? 'false' : 'null')

/** Saved loan → form values. */
export function loanToForm(loan) {
  const pre = loan.prepayment || {}
  const fc = loan.foreclosure || {}
  // Old loans stored "unknown" prepayment terms as zeros — show them as blank.
  const preNum = (v) => (pre.allowed == null && !v ? '' : str(v))
  const preTiers = tiersToForm(pre)
  const fcTiers = tiersToForm(fc)
  return {
    ...emptyLoanForm,
    nickname: loan.nickname || '',
    type: loan.type || 'Personal',
    lender: loan.lender || '',
    accountNumber: loan.accountNumber || '',
    principal: str(loan.principal),
    annualInterestRate: str(loan.annualInterestRate),
    interestType: loan.interestType || '',
    tenureMonths: str(loan.tenureMonths),
    emiAmount: str(loan.emiAmount),
    disbursementDate: loan.disbursementDate || '',
    firstEmiDate: loan.firstEmiDate || '',
    apr: str(loan.apr),
    processingFee: loan.fees?.processingFee ? str(loan.fees.processingFee) : '',
    processingFeeGST: loan.fees?.processingFeeGST ? str(loan.fees.processingFeeGST) : '',
    insuranceCharges: loan.fees?.insuranceCharges ? str(loan.fees.insuranceCharges) : '',
    otherCharges: (loan.fees?.otherCharges || []).map(c => ({ name: c.name || '', amount: str(c.amount) })),
    gstOnInterest: loan.gstOnInterest === true,
    prepaymentAllowed: tri(pre.allowed),
    prepaymentChargePercent: preTiers.start != null ? str(preTiers.start) : preNum(pre.chargePercent),
    prepaymentChargeFlatAmount: preNum(pre.chargeFlatAmount),
    prepaymentMinimumAmount: preNum(pre.minimumAmount),
    prepaymentLockInMonths: preNum(pre.lockInMonths),
    prepaymentChargeGst: pre.gstOnCharge === true,
    prepaymentSteps: preTiers.steps,
    foreclosureAllowed: tri(fc.allowed),
    foreclosureChargePercent: fcTiers.start != null ? str(fcTiers.start) : fc.chargePercent ? str(fc.chargePercent) : '',
    foreclosureChargeFlatAmount: fc.chargeFlatAmount ? str(fc.chargeFlatAmount) : '',
    foreclosureLockInMonths: fc.lockInMonths ? str(fc.lockInMonths) : '',
    foreclosureChargeGst: fc.gstOnCharge === true,
    foreclosureSteps: fcTiers.steps,
  }
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const bool = (v) => (v === 'true' ? true : v === 'false' ? false : null)

/**
 * Form values → loan fields to save. `existing` keeps any extra keys inside
 * fees / prepayment / foreclosure that this form doesn't show.
 */
export function formToLoan(form, existing = {}) {
  return {
    nickname: form.nickname.trim(),
    type: form.type,
    lender: form.lender.trim(),
    accountNumber: form.accountNumber.trim(),
    principal: num(form.principal),
    annualInterestRate: num(form.annualInterestRate),
    interestType: form.interestType || null,
    tenureMonths: Math.round(num(form.tenureMonths)),
    emiAmount: num(form.emiAmount),
    disbursementDate: form.disbursementDate,
    firstEmiDate: form.firstEmiDate,
    apr: form.apr === '' ? null : num(form.apr),
    fees: {
      ...(existing.fees || {}),
      processingFee: num(form.processingFee),
      processingFeeGST: num(form.processingFeeGST),
      insuranceCharges: num(form.insuranceCharges),
      otherCharges: form.otherCharges
        .filter(c => c.name.trim() || num(c.amount) > 0)
        .map(c => ({ name: c.name.trim() || 'Other charge', amount: num(c.amount) })),
    },
    gstOnInterest: form.gstOnInterest === true,
    gstOnInterestRate: existing.gstOnInterestRate ?? 18,
    prepayment: {
      ...(existing.prepayment || {}),
      allowed: bool(form.prepaymentAllowed),
      chargePercent: num(form.prepaymentChargePercent),
      chargeFlatAmount: num(form.prepaymentChargeFlatAmount),
      minimumAmount: num(form.prepaymentMinimumAmount),
      lockInMonths: Math.round(num(form.prepaymentLockInMonths)),
      gstOnCharge: form.prepaymentChargeGst === true,
      chargeTiers: stepsToTiers(num(form.prepaymentChargePercent), form.prepaymentSteps || []),
    },
    foreclosure: {
      ...(existing.foreclosure || {}),
      allowed: bool(form.foreclosureAllowed),
      chargePercent: num(form.foreclosureChargePercent),
      chargeFlatAmount: num(form.foreclosureChargeFlatAmount),
      lockInMonths: Math.round(num(form.foreclosureLockInMonths)),
      gstOnCharge: form.foreclosureChargeGst === true,
      chargeTiers: stepsToTiers(num(form.foreclosureChargePercent), form.foreclosureSteps || []),
    },
  }
}

const isNum = (v) => v !== '' && v !== null && Number.isFinite(Number(v))

export function validateLoanForm(form) {
  const e = {}
  if (!form.nickname.trim()) e.nickname = 'Required'
  if (!form.lender.trim()) e.lender = 'Required'
  if (!isNum(form.principal) || Number(form.principal) <= 0) e.principal = 'Enter a valid amount'
  if (!isNum(form.annualInterestRate) || Number(form.annualInterestRate) <= 0 || Number(form.annualInterestRate) >= 100) e.annualInterestRate = 'Enter a valid rate'
  if (!isNum(form.tenureMonths) || Number(form.tenureMonths) < 1 || !Number.isInteger(Number(form.tenureMonths))) e.tenureMonths = 'Enter whole months'
  if (!isNum(form.emiAmount) || Number(form.emiAmount) <= 0) e.emiAmount = 'Enter a valid EMI'
  if (!form.disbursementDate) e.disbursementDate = 'Required'
  if (!form.firstEmiDate) e.firstEmiDate = 'Required'
  const optionalNumbers = [
    'apr', 'processingFee', 'processingFeeGST', 'insuranceCharges',
    'prepaymentChargePercent', 'prepaymentChargeFlatAmount', 'prepaymentMinimumAmount', 'prepaymentLockInMonths',
    'foreclosureChargePercent', 'foreclosureChargeFlatAmount', 'foreclosureLockInMonths',
  ]
  for (const k of optionalNumbers) {
    if (form[k] !== '' && (!isNum(form[k]) || Number(form[k]) < 0)) e[k] = 'Enter a number'
  }
  for (const k of ['prepaymentSteps', 'foreclosureSteps']) {
    if ((form[k] || []).some(st => (st.afterEmis !== '' && (!isNum(st.afterEmis) || Number(st.afterEmis) < 1)) || (st.percent !== '' && (!isNum(st.percent) || Number(st.percent) < 0)))) {
      e[k] = 'Use whole EMIs (1 or more) and a percentage'
    }
  }
  if (form.otherCharges.some(c => c.amount !== '' && (!isNum(c.amount) || Number(c.amount) < 0))) e.otherCharges = 'Amounts must be numbers'
  return e
}
