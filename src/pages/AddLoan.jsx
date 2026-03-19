import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { addLoan, LOAN_TYPES } from '../data/hybridStorage'
import * as pdfjsLib from 'pdfjs-dist'
import Navbar from '../components/Navbar'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = 'llama-3.3-70b-versatile'

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let fullText = ''
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const lines = {}
    for (const item of content.items) {
      const y = Math.round(item.transform[5] / 5) * 5
      if (!lines[y]) lines[y] = []
      lines[y].push({ x: item.transform[4], str: item.str })
    }
    const sortedYs = Object.keys(lines).map(Number).sort((a, b) => b - a)
    for (const y of sortedYs) {
      const lineItems = lines[y].sort((a, b) => a.x - b.x)
      const lineText = lineItems.map(i => i.str).join('  ')
      if (lineText.trim()) fullText += lineText + '\n'
    }
    fullText += '\n--- Page Break ---\n'
  }
  return fullText
}

function runSanityChecks(parsed) {
  const warnings = []
  const p = parsed.principal
  const emi = parsed.emiAmount
  const rate = parsed.annualInterestRate
  const tenure = parsed.tenureMonths
  if (p && emi) {
    const ratio = emi / p
    if (ratio < 0.004) warnings.push('EMI seems too low for the principal amount — may have been mis-extracted.')
    if (ratio > 0.20) warnings.push('EMI seems very high relative to principal — please verify.')
  }
  if (rate) {
    if (rate > 60) warnings.push(`Interest rate ${rate}% looks very high — this may be a flat rate, not reducing balance.`)
    if (rate < 1) warnings.push(`Interest rate ${rate}% looks unusually low — verify it's not a monthly rate.`)
  }
  if (tenure) {
    if (tenure > 360) warnings.push('Tenure exceeds 30 years — please verify.')
    if (tenure < 1) warnings.push('Tenure is less than 1 month — please verify.')
  }
  if (p && rate && tenure && emi) {
    const r = rate / 100 / 12
    const computedEMI = (p * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1)
    const diff = Math.abs(computedEMI - emi) / computedEMI
    if (diff > 0.15) {
      warnings.push(`Computed EMI (₹${Math.round(computedEMI).toLocaleString('en-IN')}) doesn't match extracted EMI (₹${Number(emi).toLocaleString('en-IN')}). One of principal, rate, tenure, or EMI may be wrong.`)
    }
  }
  if (parsed.disbursementDate && parsed.firstEmiDate) {
    const disburse = new Date(parsed.disbursementDate)
    const firstEmi = new Date(parsed.firstEmiDate)
    const diffDays = (firstEmi - disburse) / (1000 * 60 * 60 * 24)
    if (diffDays < 10) warnings.push('First EMI date is less than 10 days after disbursement — dates may be swapped or wrong.')
    if (diffDays > 120) warnings.push('First EMI date is more than 4 months after disbursement — please verify.')
  }
  return warnings
}

async function parseWithGroq(text) {
  const systemPrompt = `You are a specialist in Indian retail loan documents — KFS (Key Fact Statements), sanction letters, and loan agreements issued by Indian banks and NBFCs.
Extract loan fields precisely. Critical rules:
1. annualInterestRate: ALWAYS the reducing balance rate per annum as a plain number like 10.5.
2. emiAmount: fixed monthly installment only.
3. principal: loan amount sanctioned/disbursed only.
4. disbursementDate vs firstEmiDate: two different dates, never the same.
5. processingFee: base fee excluding GST.
6. foreclosureAllowed: true/false/null.
7. tenureMonths: integer months.
8. type: exactly one of: Personal, Home, Car, Education, Credit Card, BNPL.
9. If not found, return null — never hallucinate.
Return ONLY valid JSON. No markdown, no backticks. Dates in YYYY-MM-DD. Amounts as plain numbers.`

  const userPrompt = `Extract these fields:
nickname, type, lender, accountNumber, principal, annualInterestRate,
isFlatRate (true/false/null), tenureMonths, emiAmount, disbursementDate, firstEmiDate,
processingFee, processingFeeGST, insuranceCharges,
foreclosureAllowed, foreclosureChargePercent, foreclosureChargeFlatAmount,
isLoanDocument (true/false), confidence (high/medium/low).

DOCUMENT TEXT:
${text.slice(0, 14000)}`

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.0, max_tokens: 1200,
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  const raw = data.choices[0].message.content.trim()
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(cleaned)
}

function F({ label, name, value, onChange, errors, type = 'text', placeholder = '', required = false, highlight = false }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type} name={name} value={value} onChange={onChange} placeholder={placeholder}
        className={`w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition
          ${errors[name] ? 'border-red-300 bg-red-50' : highlight ? 'border-amber-300 bg-amber-50' : 'border-gray-200'}`}
      />
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

const confidenceColors = {
  high: 'bg-green-100 text-green-700 border-green-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-red-100 text-red-700 border-red-200',
}

const emptyForm = {
  nickname: '', type: 'Personal', lender: '', accountNumber: '',
  principal: '', annualInterestRate: '', tenureMonths: '', emiAmount: '',
  disbursementDate: '', firstEmiDate: '',
  processingFee: '', processingFeeGST: '', insuranceCharges: '',
  gstOnInterest: false,
  foreclosureAllowed: 'true', foreclosureChargePercent: '', foreclosureChargeFlatAmount: '',
}

export default function AddLoan({ session }) {
  const navigate = useNavigate()
  const fileRef = useRef()
  const [mode, setMode] = useState('manual')
  const [errors, setErrors] = useState({})
  const [pdfStatus, setPdfStatus] = useState('idle')
  const [pdfMessage, setPdfMessage] = useState('')
  const [pdfConfidence, setPdfConfidence] = useState(null)
  const [sanityWarnings, setSanityWarnings] = useState([])
  const [isFlatRateWarning, setIsFlatRateWarning] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    if (errors[name]) setErrors(er => ({ ...er, [name]: null }))
  }

  async function handlePDFUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.type !== 'application/pdf') { setPdfStatus('error'); setPdfMessage('Please upload a PDF file.'); return }
    setPdfStatus('loading'); setPdfMessage('Reading PDF...'); setShowForm(false)
    setSanityWarnings([]); setIsFlatRateWarning(false)
    try {
      setPdfMessage('Extracting text from PDF...')
      const text = await extractTextFromPDF(file)
      if (text.trim().length < 100) {
        setPdfStatus('error'); setPdfMessage('Could not extract text. It may be a scanned image. Fill manually.'); return
      }
      setPdfMessage('Analyzing document with AI...')
      const parsed = await parseWithGroq(text)
      if (!parsed.isLoanDocument) {
        setPdfStatus('wrong'); setPdfMessage('This does not appear to be a loan document. Fill manually.'); return
      }
      const b = (v) => v === true ? 'true' : v === false ? 'false' : 'null'
      const s = (v) => (v !== null && v !== undefined) ? String(v) : ''
      setForm({
        nickname: s(parsed.nickname),
        type: LOAN_TYPES.includes(parsed.type) ? parsed.type : 'Personal',
        lender: s(parsed.lender), accountNumber: s(parsed.accountNumber),
        principal: s(parsed.principal), annualInterestRate: s(parsed.annualInterestRate),
        tenureMonths: s(parsed.tenureMonths), emiAmount: s(parsed.emiAmount),
        disbursementDate: s(parsed.disbursementDate), firstEmiDate: s(parsed.firstEmiDate),
        processingFee: s(parsed.processingFee), processingFeeGST: s(parsed.processingFeeGST),
        insuranceCharges: s(parsed.insuranceCharges),
        gstOnInterest: parsed.type === 'Credit Card',
        foreclosureAllowed: b(parsed.foreclosureAllowed),
        foreclosureChargePercent: s(parsed.foreclosureChargePercent),
        foreclosureChargeFlatAmount: s(parsed.foreclosureChargeFlatAmount),
      })
      setPdfConfidence(parsed.confidence)
      setSanityWarnings(runSanityChecks(parsed))
      if (parsed.isFlatRate === true) setIsFlatRateWarning(true)
      setPdfStatus('success')
      setPdfMessage('Loan document detected. Fields pre-filled. Review everything before saving.')
      setShowForm(true)
    } catch (err) {
      setPdfStatus('error'); setPdfMessage(`Failed to process PDF: ${err.message}`)
    }
    if (fileRef.current) fileRef.current.value = ''
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
    await addLoan({
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

  const fp = { onChange: handleChange, errors }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Add Loan" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Add a New Loan</h1>
            <p className="text-sm text-gray-400 mt-1">Upload a PDF or fill in the details manually.</p>
          </div>
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600">← Back</button>
        </div>

        <div className="flex bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          <button onClick={() => { setMode('manual'); setShowForm(true); setForm(emptyForm); setPdfStatus('idle'); setSanityWarnings([]) }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${mode === 'manual' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Manual Entry
          </button>
          <button onClick={() => { setMode('pdf'); setShowForm(false); setForm(emptyForm); setPdfStatus('idle'); setSanityWarnings([]) }}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition ${mode === 'pdf' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            Upload PDF
          </button>
        </div>

        {mode === 'pdf' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Upload KFS or Sanction Letter</h2>
            <p className="text-xs text-gray-400 mb-4">Upload your Key Fact Statement, sanction letter, or loan agreement PDF. AI will extract all loan details automatically.</p>
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-5">⚠ AI can make mistakes — recheck all fields carefully before saving.</p>
            <div onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-green-400 hover:bg-green-50 transition">
              <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3 text-xl">📄</div>
              <p className="text-sm font-medium text-gray-700 mb-1">Click to upload PDF</p>
              <p className="text-xs text-gray-400">KFS · Sanction Letter · Loan Agreement</p>
              <input ref={fileRef} type="file" accept="application/pdf" onChange={handlePDFUpload} className="hidden" />
            </div>
            {pdfStatus === 'loading' && (
              <div className="mt-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <p className="text-sm text-blue-700">{pdfMessage}</p>
              </div>
            )}
            {pdfStatus === 'success' && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="text-green-600 text-lg flex-shrink-0">✓</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-700 mb-0.5">Document recognized successfully</p>
                    <p className="text-xs text-green-600">{pdfMessage}</p>
                  </div>
                  {pdfConfidence && (
                    <span className={`text-xs font-medium px-2 py-1 rounded-full border ${confidenceColors[pdfConfidence]}`}>
                      {pdfConfidence} confidence
                    </span>
                  )}
                </div>
                {isFlatRateWarning && (
                  <div className="mt-3 pt-3 border-t border-green-200">
                    <p className="text-xs text-amber-700 font-medium">⚠ Flat rate detected</p>
                    <p className="text-xs text-amber-600 mt-0.5">The rate appears to be a flat rate. True reducing balance rate is approximately 1.8× the flat rate. Please verify.</p>
                  </div>
                )}
                {sanityWarnings.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-green-200 space-y-1.5">
                    <p className="text-xs font-medium text-amber-700">⚠ Please review these fields carefully:</p>
                    {sanityWarnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}
                  </div>
                )}
              </div>
            )}
            {(pdfStatus === 'error' || pdfStatus === 'wrong') && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-red-500 text-lg flex-shrink-0">✕</span>
                <div>
                  <p className="text-sm font-medium text-red-700 mb-0.5">{pdfStatus === 'wrong' ? 'Not a loan document' : 'Upload failed'}</p>
                  <p className="text-xs text-red-600">{pdfMessage}</p>
                  <button onClick={() => { setMode('manual'); setShowForm(true) }} className="text-xs text-red-600 underline mt-2 hover:text-red-700">Fill manually instead →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {(mode === 'manual' || showForm) && (
          <div className="bg-white rounded-2xl border border-gray-200 px-10 py-8">
            {mode === 'pdf' && pdfStatus === 'success' && (
              <div className="mb-6 pb-5 border-b border-gray-100">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Review extracted details</p>
                <p className="text-sm text-gray-600">Fields with values were extracted from your PDF. Empty fields were not found — please fill them in.</p>
              </div>
            )}

            <Section title="Basic Details">
              <F label="Loan Nickname" name="nickname" value={form.nickname} {...fp} placeholder="e.g. HDFC Personal Loan" required />
              <S label="Loan Type" name="type" value={form.type} onChange={handleChange} options={LOAN_TYPES.map(t => ({ value: t, label: t }))} />
              <F label="Lender Name" name="lender" value={form.lender} {...fp} placeholder="e.g. HDFC Bank" required />
              <F label="Account Number" name="accountNumber" value={form.accountNumber} {...fp} placeholder="Optional" />
              <F label="Principal Amount (₹)" name="principal" value={form.principal} {...fp} type="number" placeholder="500000" required />
              <F label="Annual Interest Rate (%)" name="annualInterestRate" value={form.annualInterestRate} {...fp} type="number" placeholder="10.5" required highlight={isFlatRateWarning} />
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
                  {form.gstOnInterest && <p className="text-xs text-gray-400 mt-2">Monthly outflow = EMI + (interest component × 18%). This significantly increases the true cost.</p>}
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
              <button onClick={handleSubmit} className="px-10 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition">Save Loan →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}