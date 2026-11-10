// The loan details form used by Add Loan and Edit Loan.
// When `checks` is given, each field shows whether it was verified by math,
// copied from the document (with page + quote), or needs a look.

import { LOAN_TYPES } from '../data/hybridStorage'

const inputBase = 'w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition'

function inputTone(error, status) {
  if (error) return 'border-red-300 bg-red-50'
  if (status === 'check') return 'border-amber-400 bg-amber-50/60'
  if (status === 'verified') return 'border-green-400'
  return 'border-gray-200'
}

const BADGES = {
  verified: { text: '✓ Verified', cls: 'bg-green-50 text-green-700 border-green-200', title: 'Confirmed by an independent calculation' },
  found: { text: 'From document', cls: 'bg-gray-50 text-gray-500 border-gray-200', title: 'Copied from your document' },
  check: { text: 'Check', cls: 'bg-amber-50 text-amber-700 border-amber-200', title: 'Something here doesn’t add up' },
  missing: { text: 'Not found', cls: 'bg-white text-gray-400 border-gray-200', title: 'Not in the document' },
  edited: { text: 'Edited', cls: 'bg-blue-50 text-blue-600 border-blue-200', title: 'You changed this value' },
}

function StatusBadge({ status }) {
  const b = BADGES[status]
  if (!b) return null
  return <span title={b.title} className={`text-[10px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap ${b.cls}`}>{b.text}</span>
}

function FieldNotes({ entry, onFix }) {
  if (!entry) return null
  const { status, messages, fix, evidence } = entry
  const tone = status === 'check' ? 'text-amber-700' : status === 'verified' ? 'text-green-700' : 'text-gray-500'
  return (
    <div className="mt-1.5 space-y-1">
      {messages.map((m, i) => (
        <p key={i} className={`text-[11px] leading-snug ${tone}`}>{status === 'check' ? '⚠ ' : status === 'verified' ? '✓ ' : ''}{m}</p>
      ))}
      {fix && (
        <button type="button" onClick={onFix}
          className="text-[11px] font-medium px-2 py-0.5 rounded border border-amber-300 text-amber-800 bg-white hover:bg-amber-50">
          {fix.label}
        </button>
      )}
      {evidence && !evidence.edited && evidence.quote && (
        <p className="text-[11px] text-gray-400 leading-snug truncate" title={`${evidence.pageText || ''}\n“${evidence.quote}”`}>
          {evidence.pageText ? <span className="text-gray-500">{evidence.pageText} · </span> : null}“{evidence.quote}”
        </p>
      )}
      {evidence?.note && !evidence.edited && <p className="text-[11px] text-gray-400">{evidence.note}</p>}
      {evidence?.edited && <p className="text-[11px] text-gray-400">Changed by you · document said {evidence.value === 'true' ? 'Yes' : evidence.value === 'false' ? 'No' : evidence.value}</p>}
      {status === 'missing' && <p className="text-[11px] text-gray-400">Not in the document</p>}
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="py-6 first:pt-0 border-b border-gray-100 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-4">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-5">{children}</div>
    </div>
  )
}

export default function LoanForm({ form, setForm, errors, setErrors, checks }) {
  const info = checks?.info || {}

  function setValue(name, value) {
    setForm(f => ({ ...f, [name]: value }))
    if (errors[name]) setErrors(er => ({ ...er, [name]: null }))
  }

  function Label({ name, label, required }) {
    return (
      <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[18px]">
        <label htmlFor={`lf-${name}`} className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <StatusBadge status={info[name]?.status} />
      </div>
    )
  }

  function Field({ name, label, type = 'text', placeholder = '', required = false, step }) {
    const entry = info[name]
    return (
      <div className="min-w-0">
        {Label({ name, label, required })}
        <input id={`lf-${name}`} type={type} name={name} value={form[name]} placeholder={placeholder} step={step}
          inputMode={type === 'number' ? 'decimal' : undefined}
          onChange={e => setValue(name, e.target.value)}
          className={`${inputBase} ${inputTone(errors[name], entry?.status)}`} />
        {errors[name] && <p className="text-xs text-red-500 mt-1">{errors[name]}</p>}
        <FieldNotes entry={entry} onFix={() => entry?.fix && setValue(name, entry.fix.value)} />
      </div>
    )
  }

  function Select({ name, label, options }) {
    const entry = info[name]
    return (
      <div className="min-w-0">
        {Label({ name, label })}
        <select id={`lf-${name}`} name={name} value={form[name]} onChange={e => setValue(name, e.target.value)}
          className={`${inputBase} ${inputTone(null, entry?.status)}`}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <FieldNotes entry={entry} onFix={() => entry?.fix && setValue(name, entry.fix.value)} />
      </div>
    )
  }

  const yesNo = [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }, { value: 'null', label: 'Not sure' }]

  function setCharge(i, key, value) {
    setForm(f => ({ ...f, otherCharges: f.otherCharges.map((c, j) => (j === i ? { ...c, [key]: value } : c)) }))
    if (errors.otherCharges) setErrors(er => ({ ...er, otherCharges: null }))
  }

  // "3% up to 36 EMIs, then 2%": the starting rate is the Charge (%) field,
  // later rates are steps. Plus an "+ 18% GST on the charge" switch.
  function ChargeSteps(kind) {
    const key = `${kind}Steps`
    const steps = form[key] || []
    const entry = info[key]
    const setSteps = (next) => {
      setForm(f => ({ ...f, [key]: next }))
      if (errors[key]) setErrors(er => ({ ...er, [key]: null }))
    }
    const gstKey = `${kind}ChargeGst`
    return (
      <div className="sm:col-span-2 lg:col-span-3 space-y-3">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Charge changes after some EMIs?</p>
            <StatusBadge status={entry?.status} />
          </div>
          {steps.length > 0 && (
            <div className="space-y-2 mb-2">
              {steps.map((st, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
                  <span>After</span>
                  <input type="number" inputMode="numeric" value={st.afterEmis} aria-label="EMIs paid"
                    onChange={e => setSteps(steps.map((x, j) => (j === i ? { ...x, afterEmis: e.target.value } : x)))}
                    className={`${inputBase} border-gray-200 w-20`} placeholder="36" />
                  <span>EMIs, the charge becomes</span>
                  <input type="number" inputMode="decimal" step="0.01" value={st.percent} aria-label="Charge after these EMIs (%)"
                    onChange={e => setSteps(steps.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                    className={`${inputBase} border-gray-200 w-20`} placeholder="2" />
                  <span>%</span>
                  <button type="button" onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                    aria-label="Remove step" className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">×</button>
                </div>
              ))}
            </div>
          )}
          {errors[key] && <p className="text-xs text-red-500 mb-1">{errors[key]}</p>}
          <button type="button" onClick={() => setSteps([...steps, { afterEmis: '', percent: '' }])}
            className="text-xs font-medium text-green-700 hover:text-green-800">+ Add a later rate</button>
          <FieldNotes entry={entry} onFix={() => {}} />
        </div>
        <div>
          <label className="flex items-center gap-2 cursor-pointer w-fit">
            <input type="checkbox" checked={form[gstKey] === true} onChange={e => setForm(f => ({ ...f, [gstKey]: e.target.checked }))} className="w-4 h-4 accent-green-600" />
            <span className="text-sm text-gray-700">18% GST is added on top of the charge</span>
            <StatusBadge status={info[gstKey]?.status} />
          </label>
          <FieldNotes entry={info[gstKey]} onFix={() => {}} />
        </div>
      </div>
    )
  }

  // Plain functions (not components) so inputs keep focus while typing.
  return (
    <div>
      <Section title="Basic Details">
        {Field({ name: 'nickname', label: 'Loan Nickname', placeholder: 'e.g. HDFC Personal Loan', required: true })}
        {Select({ name: 'type', label: 'Loan Type', options: LOAN_TYPES.map(t => ({ value: t, label: t })) })}
        {Field({ name: 'lender', label: 'Lender Name', placeholder: 'e.g. HDFC Bank', required: true })}
        {Field({ name: 'accountNumber', label: 'Loan Account Number', placeholder: 'Optional' })}
        {Field({ name: 'principal', label: 'Loan Amount (₹)', type: 'number', placeholder: '500000', required: true })}
        {Field({ name: 'annualInterestRate', label: 'Interest Rate (% p.a.)', type: 'number', placeholder: '10.5', required: true, step: '0.01' })}
        {Select({ name: 'interestType', label: 'Rate Type', options: [{ value: '', label: 'Not sure' }, { value: 'fixed', label: 'Fixed' }, { value: 'floating', label: 'Floating' }] })}
        {Field({ name: 'tenureMonths', label: 'Tenure (months)', type: 'number', placeholder: '48', required: true })}
        {Field({ name: 'emiAmount', label: 'EMI Amount (₹)', type: 'number', placeholder: '12834', required: true })}
        {Field({ name: 'disbursementDate', label: 'Disbursement Date', type: 'date', required: true })}
        {Field({ name: 'firstEmiDate', label: 'First EMI Date', type: 'date', required: true })}
        {Field({ name: 'apr', label: 'APR from document (%)', type: 'number', placeholder: 'Optional', step: '0.01' })}
      </Section>

      <Section title="Fees & Charges" subtitle="One-time charges · leave blank if none">
        {Field({ name: 'processingFee', label: 'Processing Fee (₹, before GST)', type: 'number', placeholder: '5000' })}
        {Field({ name: 'processingFeeGST', label: 'GST on Processing Fee (₹)', type: 'number', placeholder: '900' })}
        {Field({ name: 'insuranceCharges', label: 'Insurance (₹)', type: 'number', placeholder: '0' })}

        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Other one-time charges</p>
          <div className="space-y-3">
            {form.otherCharges.map((c, i) => {
              const entry = info[`otherCharges.${i}`]
              return (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <input value={c.name} onChange={e => setCharge(i, 'name', e.target.value)} placeholder="e.g. Stamp duty"
                      aria-label="Charge name" className={`${inputBase} border-gray-200 flex-1 min-w-0`} />
                    <input value={c.amount} onChange={e => setCharge(i, 'amount', e.target.value)} placeholder="₹" type="number" inputMode="decimal"
                      aria-label="Charge amount" className={`${inputBase} ${inputTone(null, entry?.status)} w-28 sm:w-36 shrink-0`} />
                    <StatusBadge status={entry?.status} />
                    <button type="button" onClick={() => setForm(f => ({ ...f, otherCharges: f.otherCharges.filter((_, j) => j !== i) }))}
                      aria-label="Remove charge" className="w-8 h-8 shrink-0 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50">×</button>
                  </div>
                  <FieldNotes entry={entry} onFix={() => {}} />
                </div>
              )
            })}
          </div>
          {errors.otherCharges && <p className="text-xs text-red-500 mt-1">{errors.otherCharges}</p>}
          <button type="button" onClick={() => setForm(f => ({ ...f, otherCharges: [...f.otherCharges, { name: '', amount: '' }] }))}
            className="mt-2 text-xs font-medium text-green-700 hover:text-green-800">+ Add a charge</button>
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">GST on interest — credit card / insta loans</p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.gstOnInterest === true} onChange={e => setForm(f => ({ ...f, gstOnInterest: e.target.checked }))} className="w-4 h-4 accent-green-600" />
              <span className="text-sm text-gray-700">Apply 18% GST on the interest part of each EMI</span>
            </label>
            {form.gstOnInterest && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">GST added on top of EMI monthly</span>}
          </div>
        </div>
      </Section>

      <Section title="Part-Prepayment Terms" subtitle="Paying off some of the loan early">
        {Select({ name: 'prepaymentAllowed', label: 'Part-prepayment allowed?', options: yesNo })}
        {Field({ name: 'prepaymentChargePercent', label: (form.prepaymentSteps || []).length ? 'Starting Charge (%)' : 'Charge (%)', type: 'number', placeholder: '2', step: '0.01' })}
        {Field({ name: 'prepaymentChargeFlatAmount', label: 'Flat Charge (₹)', type: 'number', placeholder: '0' })}
        {Field({ name: 'prepaymentMinimumAmount', label: 'Minimum Amount (₹)', type: 'number', placeholder: 'Optional' })}
        {Field({ name: 'prepaymentLockInMonths', label: 'Lock-in (months)', type: 'number', placeholder: '0' })}
        {ChargeSteps('prepayment')}
      </Section>

      <Section title="Foreclosure Terms" subtitle="Closing the whole loan early">
        {Select({ name: 'foreclosureAllowed', label: 'Foreclosure allowed?', options: yesNo })}
        {Field({ name: 'foreclosureChargePercent', label: (form.foreclosureSteps || []).length ? 'Starting Charge (%)' : 'Charge (%)', type: 'number', placeholder: '3', step: '0.01' })}
        {Field({ name: 'foreclosureChargeFlatAmount', label: 'Flat Charge (₹)', type: 'number', placeholder: '0' })}
        {Field({ name: 'foreclosureLockInMonths', label: 'Lock-in (months)', type: 'number', placeholder: '0' })}
        {ChargeSteps('foreclosure')}
      </Section>
    </div>
  )
}
