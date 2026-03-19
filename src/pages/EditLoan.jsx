import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getLoanById, updateLoan, LOAN_TYPES } from '../data/hybridStorage'
import Navbar from '../components/Navbar'

function F({ label, name, value, onChange, errors, type = 'text', placeholder = '', required = false }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}
        className={`w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition ${errors[name] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`} />
      {errors[name] && <p className="text-xs text-red-500 mt-1">{errors[name]}</p>}
    </div>
  )
}

function S({ label, name, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">{label}</label>
      <select name={name} value={value} onChange={onChange}
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="grid grid-cols-3 gap-x-5 gap-y-4">{children}</div>
    </div>
  )
}

export default function EditLoan({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [errors, setErrors] = useState({})
  const [form, setForm] = useState(null)

  useEffect(() => {
    async function load() {
      const loan = await getLoanById(id, session)
      if (!loan) { navigate('/'); return }
      setForm({
        nickname: loan.nickname || '',
        type: loan.type || 'Personal',
        lender: loan.lender || '',
        accountNumber: loan.accountNumber || '',
        principal: loan.principal || '',
        annualInterestRate: loan.annualInterestRate || '',
        tenureMonths: loan.tenureMonths || '',
        emiAmount: loan.emiAmount || '',
        disbursementDate: loan.disbursementDate || '',
        firstEmiDate: loan.firstEmiDate || '',
        processingFee: loan.fees?.processingFee || '',
        processingFeeGST: loan.fees?.processingFeeGST || '',
        insuranceCharges: loan.fees?.insuranceCharges || '',
        gstOnInterest: loan.gstOnInterest || false,
        foreclosureAllowed: loan.foreclosure?.allowed === true ? 'true' : loan.foreclosure?.allowed === false ? 'false' : 'null',
        foreclosureChargePercent: loan.foreclosure?.chargePercent || '',
        foreclosureChargeFlatAmount: loan.foreclosure?.chargeFlatAmount || '',
      })
    }
    load()
  }, [id])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (errors[name]) setErrors(er => ({ ...er, [name]: null }))
  }

  function validate() {
    const e = {}
    if (!form.nickname.trim()) e.nickname = 'Required'
    if (!form.lender.trim()) e.lender = 'Required'
    if (!form.principal || Number(form.principal) <= 0) e.principal = 'Enter valid amount'
    if (!form.annualInterestRate || isNaN(form.annualInterestRate)) e.annualInterestRate = 'Enter valid rate'
    if (!form.tenureMonths || isNaN(form.tenureMonths)) e.tenureMonths = 'Enter valid tenure'
    if (!form.emiAmount || isNaN(form.emiAmount)) e.emiAmount = 'Enter valid EMI'
    if (!form.disbursementDate) e.disbursementDate = 'Required'
    if (!form.firstEmiDate) e.firstEmiDate = 'Required'
    return e
  }

  async function handleSubmit() {
    const e = validate()
    if (Object.keys(e).length > 0) { setErrors(e); return }
    const n = (v) => Number(v) || 0
    const b = (v) => v === 'true' ? true : v === 'false' ? false : null
    await updateLoan(id, {
      nickname: form.nickname.trim(), type: form.type,
      lender: form.lender.trim(), accountNumber: form.accountNumber.trim(),
      principal: n(form.principal), annualInterestRate: n(form.annualInterestRate),
      tenureMonths: n(form.tenureMonths), emiAmount: n(form.emiAmount),
      disbursementDate: form.disbursementDate, firstEmiDate: form.firstEmiDate,
      fees: { processingFee: n(form.processingFee), processingFeeGST: n(form.processingFeeGST), insuranceCharges: n(form.insuranceCharges), otherCharges: [] },
      gstOnInterest: form.gstOnInterest, gstOnInterestRate: 18,
      prepayment: { allowed: null, chargePercent: 0, chargeFlatAmount: 0, minimumAmount: 0, lockInMonths: 0 },
      foreclosure: { allowed: b(form.foreclosureAllowed), chargePercent: n(form.foreclosureChargePercent), chargeFlatAmount: n(form.foreclosureChargeFlatAmount), lockInMonths: 0 },
    }, session)
    navigate('/')
  }

  if (!form) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const fp = { onChange: handleChange, errors }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Add Loan" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Edit Loan</h1>
            <p className="text-sm text-gray-400 mt-1">Update the details for this loan.</p>
          </div>
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600">← Back to Dashboard</button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 px-10 py-8">
          <Section title="Basic Details">
            <F label="Loan Nickname" name="nickname" value={form.nickname} {...fp} placeholder="e.g. HDFC Personal Loan" required />
            <S label="Loan Type" name="type" value={form.type} onChange={handleChange} options={LOAN_TYPES.map(t => ({ value: t, label: t }))} />
            <F label="Lender Name" name="lender" value={form.lender} {...fp} placeholder="e.g. HDFC Bank" required />
            <F label="Account Number" name="accountNumber" value={form.accountNumber} {...fp} placeholder="Optional" />
            <F label="Principal Amount (₹)" name="principal" value={form.principal} {...fp} type="number" placeholder="500000" required />
            <F label="Annual Interest Rate (%)" name="annualInterestRate" value={form.annualInterestRate} {...fp} type="number" placeholder="10.5" required />
            <F label="Tenure (months)" name="tenureMonths" value={form.tenureMonths} {...fp} type="number" placeholder="48" required />
            <F label="EMI Amount (₹)" name="emiAmount" value={form.emiAmount} {...fp} type="number" placeholder="12834" required />
            <F label="Disbursement Date" name="disbursementDate" value={form.disbursementDate} {...fp} type="date" required />
            <F label="First EMI Date" name="firstEmiDate" value={form.firstEmiDate} {...fp} type="date" required />
          </Section>

          <div className="border-t border-gray-100 my-2" />

          <div className="mt-6">
            <Section title="Fees & Charges" subtitle="Enter 0 if not applicable">
              <F label="Processing Fee (₹)" name="processingFee" value={form.processingFee} {...fp} type="number" placeholder="5000" />
              <F label="GST on Processing Fee (₹)" name="processingFeeGST" value={form.processingFeeGST} {...fp} type="number" placeholder="900" />
              <F label="Insurance Charges (₹)" name="insuranceCharges" value={form.insuranceCharges} {...fp} type="number" placeholder="0" />
              <div className="col-span-3 mt-1">
                <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">GST on Interest — Credit Card / Insta Loans</label>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.gstOnInterest === true} onChange={e => setForm(f => ({ ...f, gstOnInterest: e.target.checked }))} className="w-4 h-4 accent-green-600" />
                    <span className="text-sm text-gray-700">Apply 18% GST on interest component each month</span>
                  </label>
                  {form.gstOnInterest && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">GST added on top of EMI monthly</span>}
                </div>
                {form.gstOnInterest && <p className="text-xs text-gray-400 mt-2">Monthly outflow = EMI + (interest component × 18%).</p>}
              </div>
            </Section>
          </div>

          <div className="border-t border-gray-100 my-2" />

          <div className="mt-6">
            <Section title="Foreclosure Terms">
              <S label="Foreclosure Allowed?" name="foreclosureAllowed" value={form.foreclosureAllowed} onChange={handleChange}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }, { value: 'null', label: 'Not Sure' }]} />
              <F label="Charge (%)" name="foreclosureChargePercent" value={form.foreclosureChargePercent} {...fp} type="number" placeholder="3" />
              <F label="Flat Charge (₹)" name="foreclosureChargeFlatAmount" value={form.foreclosureChargeFlatAmount} {...fp} type="number" placeholder="0" />
            </Section>
          </div>

          <div className="flex items-center justify-between pt-6 mt-4 border-t border-gray-100">
            <button onClick={() => navigate('/')} className="px-6 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">Cancel</button>
            <button onClick={handleSubmit} className="px-10 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition">Save Changes →</button>
          </div>
        </div>
      </div>
    </div>
  )
}