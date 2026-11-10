import { useState, useRef, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { addLoan } from '../data/hybridStorage'
import Navbar from '../components/Navbar'
import LoanForm from '../components/LoanForm'
import { emptyLoanForm, formToLoan, validateLoanForm } from '../utils/loanForm'
import { extractLoan } from '../utils/loanPdf/extractLoan'
import { extractionToForm, checkLoanForm } from '../utils/loanPdf/loanChecks'

const DOC_TYPE_LABEL = {
  kfs: 'Key Fact Statement',
  sanction_letter: 'Sanction letter',
  loan_agreement: 'Loan agreement',
  repayment_schedule: 'Repayment schedule',
  loan_statement: 'Loan statement',
  other_loan_document: 'Loan document',
  not_a_loan_document: 'Not a loan document',
}

const ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/webp'

function PasswordPrompt({ prompt, onSubmit, onSkip }) {
  const [value, setValue] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [prompt])
  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4">
      <p className="text-sm font-medium text-gray-800">“{prompt.fileName}” is password-protected</p>
      <p className="text-xs text-gray-500 mt-1">
        Banks often use your date of birth (e.g. DDMMYYYY), part of your PAN, or your account number.
        The password is only used here in your browser to open the file — it is never sent anywhere.
      </p>
      {prompt.incorrect && <p className="text-xs text-red-600 mt-2">That password didn’t work. Try again.</p>}
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={e => { e.preventDefault(); if (value) onSubmit(value) }}>
        <input ref={inputRef} type="password" value={value} onChange={e => setValue(e.target.value)} autoComplete="off"
          aria-label="PDF password"
          className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        <button type="submit" disabled={!value} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">Unlock</button>
        <button type="button" onClick={onSkip} className="px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50">Skip this file</button>
      </form>
    </div>
  )
}

function SummaryChip({ tone, children }) {
  const tones = {
    green: 'bg-green-50 text-green-700 border-green-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    light: 'bg-white text-gray-500 border-gray-200',
  }
  return <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${tones[tone]}`}>{children}</span>
}

export default function AddLoan({ session }) {
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const abortRef = useRef(null)
  const pendingPasswordRef = useRef(null)
  const [mode, setMode] = useState('manual')
  const [form, setForm] = useState(emptyLoanForm)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Upload state
  const [phase, setPhase] = useState('idle') // idle | working | done | error
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [fileNames, setFileNames] = useState([])
  const [extraction, setExtraction] = useState(null)
  const [evidence, setEvidence] = useState({})
  const [passwordPrompt, setPasswordPrompt] = useState(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => abortRef.current?.abort(), [])

  const checks = useMemo(() => checkLoanForm(form, extraction, evidence), [form, extraction, evidence])
  const showForm = mode === 'manual' || phase === 'done'

  function resetUpload() {
    abortRef.current?.abort()
    pendingPasswordRef.current?.(null) // let a waiting password question finish
    setPhase('idle'); setStatusMsg(''); setErrorMsg(''); setFileNames([])
    setExtraction(null); setEvidence({}); setPasswordPrompt(null)
  }

  function switchMode(next) {
    if (next === mode) return
    resetUpload()
    setMode(next)
    setForm(emptyLoanForm)
    setErrors({})
  }

  function askPassword({ fileName, incorrect }) {
    return new Promise(resolve => {
      const finish = (pw) => {
        pendingPasswordRef.current = null
        setPasswordPrompt(null)
        resolve(pw)
      }
      pendingPasswordRef.current = finish
      setPasswordPrompt({ fileName, incorrect, resolve: finish })
    })
  }

  async function handleFiles(list) {
    const files = [...(list || [])]
    if (!files.length) return
    resetUpload()
    const controller = new AbortController()
    abortRef.current = controller
    setFileNames(files.map(f => f.name))
    setPhase('working')
    setStatusMsg('Opening files…')
    setErrors({})
    try {
      const ex = await extractLoan(files, { askPassword, onStatus: setStatusMsg, signal: controller.signal })
      if (controller.signal.aborted) return
      const { form: filled, evidence: ev } = extractionToForm(ex)
      setForm(filled)
      setEvidence(ev)
      setExtraction(ex)
      setPhase('done')
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return
      setErrorMsg(err?.message || 'Something went wrong while reading the document.')
      setPhase('error')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSubmit() {
    const e = validateLoanForm(form)
    if (Object.keys(e).length > 0) {
      setErrors(e)
      document.getElementById(`lf-${Object.keys(e)[0]}`)?.focus()
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      await addLoan(formToLoan(form), session)
      navigate('/')
    } catch (err) {
      setSaveError(`Could not save the loan: ${err?.message || 'unknown error'}. Nothing was saved.`)
      setSaving(false)
    }
  }

  const s = checks.summary
  const docType = extraction?.documentType
  const notALoan = docType === 'not_a_loan_document'
  const usedVision = extraction?.pages?.some(p => p.scanned && extraction.usedPageIds?.includes(p.id))

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Add Loan" />

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Add a New Loan</h1>
            <p className="text-sm text-gray-400 mt-1">Upload your loan documents or fill in the details yourself.</p>
          </div>
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600 whitespace-nowrap">← Back</button>
        </div>

        <div className="flex bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {[['manual', 'Manual Entry'], ['pdf', 'Upload Documents']].map(([key, label]) => (
            <button key={key} onClick={() => switchMode(key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition ${mode === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'pdf' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Upload your loan documents</h2>
            <p className="text-xs text-gray-500 mb-4">
              Key Fact Statement (KFS), sanction letter, loan agreement or repayment schedule — PDF, scan or photo.
              You can select several files at once (for example KFS + sanction letter). Every value is shown with the
              page it came from and checked with exact loan math.
            </p>

            {phase !== 'working' && (
              <div
                role="button" tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
                onDragOver={e => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
                className={`border-2 border-dashed rounded-xl p-8 sm:p-10 text-center cursor-pointer transition ${dragging ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-400 hover:bg-green-50'}`}>
                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3 text-xl">📄</div>
                <p className="text-sm font-medium text-gray-700 mb-1">{phase === 'done' ? 'Upload different documents' : 'Click or drop files here'}</p>
                <p className="text-xs text-gray-400">PDF · JPG · PNG · password-protected PDFs work too</p>
              </div>
            )}
            <input ref={fileRef} type="file" accept={ACCEPT} multiple onChange={e => handleFiles(e.target.files)} className="hidden" />

            {phase === 'working' && (
              <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-blue-800">{statusMsg}</p>
                  <p className="text-xs text-blue-600/80 truncate">{fileNames.join(', ')}</p>
                </div>
                <button onClick={resetUpload} className="text-xs text-blue-700 hover:underline shrink-0">Cancel</button>
              </div>
            )}

            {passwordPrompt && (
              <PasswordPrompt prompt={passwordPrompt} onSubmit={pw => passwordPrompt.resolve(pw)} onSkip={() => passwordPrompt.resolve(null)} />
            )}

            {phase === 'error' && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-red-500 text-lg flex-shrink-0">✕</span>
                <div>
                  <p className="text-sm font-medium text-red-700 mb-0.5">Couldn’t read the documents</p>
                  <p className="text-xs text-red-600">{errorMsg}</p>
                  <button onClick={() => { setMode('manual'); setPhase('idle') }} className="text-xs text-red-600 underline mt-2 hover:text-red-700">Fill in manually instead →</button>
                </div>
              </div>
            )}

            {phase === 'done' && extraction && (
              <div className={`mt-4 rounded-xl px-4 py-3 border ${notALoan ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
                <p className={`text-sm font-medium ${notALoan ? 'text-amber-800' : 'text-green-800'}`}>
                  {notALoan
                    ? 'This doesn’t look like a loan document — check the details carefully.'
                    : `${DOC_TYPE_LABEL[docType] || 'Loan document'} read`}
                  <span className="font-normal text-gray-500"> · {fileNames.join(', ')}</span>
                </p>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {s.verified > 0 && <SummaryChip tone="green">✓ {s.verified} verified by math</SummaryChip>}
                  {s.found > 0 && <SummaryChip tone="gray">{s.found} copied with source</SummaryChip>}
                  {s.check > 0 && <SummaryChip tone="amber">⚠ {s.check} to check</SummaryChip>}
                  {s.missing > 0 && <SummaryChip tone="light">{s.missing} not in the document</SummaryChip>}
                </div>
                <p className="text-xs text-gray-600 mt-2.5">
                  Green fields are confirmed by an independent calculation. Look at the amber ones, fill anything missing, then save.
                  {usedVision && ' Some pages were scans, so they were read from images.'}
                </p>
                {(extraction.notes?.length > 0 || extraction.skipped?.length > 0) && (
                  <ul className="mt-2 space-y-1">
                    {[...(extraction.notes || []), ...(extraction.skipped || [])].map((n, i) => (
                      <li key={i} className="text-xs text-amber-700">• {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {showForm && (
          <div className="bg-white rounded-2xl border border-gray-200 px-5 sm:px-10 py-8">
            <LoanForm form={form} setForm={setForm} errors={errors} setErrors={setErrors} checks={checks} />

            {saveError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-6 mt-2 border-t border-gray-100">
              <button onClick={() => navigate('/')} className="px-6 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <div className="flex items-center gap-3">
                {s.check > 0 && <span className="text-xs text-amber-700">{s.check} field{s.check === 1 ? '' : 's'} flagged</span>}
                <button onClick={handleSubmit} disabled={saving}
                  className="px-10 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition disabled:opacity-60">
                  {saving ? 'Saving…' : 'Save Loan →'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
