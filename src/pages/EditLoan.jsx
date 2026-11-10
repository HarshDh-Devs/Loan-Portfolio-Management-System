import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getLoanById, updateLoan } from '../data/hybridStorage'
import Navbar from '../components/Navbar'
import LoanForm from '../components/LoanForm'
import { loanToForm, formToLoan, validateLoanForm } from '../utils/loanForm'
import { checkLoanForm } from '../utils/loanPdf/loanChecks'

export default function EditLoan({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [errors, setErrors] = useState({})
  const [loan, setLoan] = useState(null)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let alive = true
    getLoanById(id, session).then(found => {
      if (!alive) return
      if (!found) { navigate('/'); return }
      setLoan(found)
      setForm(loanToForm(found))
    })
    return () => { alive = false }
  }, [id, session, navigate])

  // Same live math checks as Add Loan (EMI vs amount/rate/tenure, GST, dates).
  const checks = useMemo(() => (form ? checkLoanForm(form, null) : null), [form])

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
      await updateLoan(id, formToLoan(form, loan), session)
      navigate('/')
    } catch (err) {
      setSaveError(`Could not save: ${err?.message || 'unknown error'}. Nothing was changed.`)
      setSaving(false)
    }
  }

  if (!form) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Add Loan" />

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Edit Loan</h1>
            <p className="text-sm text-gray-400 mt-1">Update the details for this loan.</p>
          </div>
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600 whitespace-nowrap">← Back to Dashboard</button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 px-5 sm:px-10 py-8">
          <LoanForm form={form} setForm={setForm} errors={errors} setErrors={setErrors} checks={checks} />

          {saveError && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-6 mt-2 border-t border-gray-100">
            <button onClick={() => navigate('/')} className="px-6 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition">Cancel</button>
            <button onClick={handleSubmit} disabled={saving}
              className="px-10 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Changes →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
