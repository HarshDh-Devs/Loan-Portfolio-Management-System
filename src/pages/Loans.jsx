import { useEffect, useState } from 'react'
import { getLoans, deleteLoan, migrateLocalToCloud, closeLoan, reopenLoan } from '../data/hybridStorage'
import { getCurrentLoanState, calculateTrueCost, calculateForeclosureSavings, generateAmortizationSchedule } from '../math/engine'
import { formatINR, formatINRCompact, formatDate, formatPct } from '../utils/format'
import { activeLoans, closedLoans, closedLoanSummary, CLOSURE_LABEL } from '../utils/loanStatus'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'

const BADGE_COLORS = {
  Personal: 'bg-purple-100 text-purple-700',
  Home: 'bg-blue-100 text-blue-700',
  Car: 'bg-amber-100 text-amber-700',
  Education: 'bg-green-100 text-green-700',
  'Credit Card': 'bg-red-100 text-red-700',
  BNPL: 'bg-pink-100 text-pink-700',
}

// Local calendar date (not UTC), e.g. "2026-11-10".
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function Loans({ session }) {
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortOption, setSortOption] = useState('none')
  const [closingLoan, setClosingLoan] = useState(null)   // { loan, state, mode: 'close' | 'complete' }
  const [showClosed, setShowClosed] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    async function load() {
      try {
        if (session) await migrateLocalToCloud()
        const data = await getLoans(session)
        setLoans(data)
      } catch (err) {
        console.error('Failed to load loans:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [session])

  const replaceLoan = (saved) => setLoans(prev => prev.map(l => (l.id === saved.id ? saved : l)))

  async function handleClose(loanId, closure) {
    try {
      const saved = await closeLoan(loanId, closure, session)
      replaceLoan(saved)
      setClosingLoan(null)
    } catch (err) {
      alert('Could not close this loan: ' + (err.message || 'Please try again.') + ' Nothing was changed.')
    }
  }

  async function handleReopen(loan) {
    if (!window.confirm(`Reopen "${loan.nickname}"? It will count in your outstanding totals and EMIs again.`)) return
    try {
      replaceLoan(await reopenLoan(loan.id, session))
    } catch (err) {
      alert('Could not reopen this loan: ' + (err.message || 'Please try again.') + ' Nothing was changed.')
    }
  }

  async function handleDeletePermanently(loan) {
    if (!window.confirm(`Permanently delete "${loan.nickname}" and all of its history? This cannot be undone.`)) return
    try {
      await deleteLoan(loan.id, session)
      setLoans(prev => prev.filter(l => l.id !== loan.id))
      setClosingLoan(null)
    } catch {
      alert('Failed to delete. Please try again.')
    }
  }

  const active = activeLoans(loans)
  const closed = closedLoans(loans)

  const states = active.map(l => ({
    loan: l,
    state: getCurrentLoanState(l),
    trueCost: calculateTrueCost(l),
  }))

  const totalOutstanding = states.reduce((s, { state }) => s + state.outstanding, 0)
  const totalEMI = active.reduce((s, l) => s + (Number(l.emiAmount) || 0), 0)
  const totalIntRemaining = states.reduce((s, { state }) => s + state.interestRemaining, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Loans" />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <SummaryCard label="Total Outstanding" value={formatINRCompact(totalOutstanding)} valueClass="text-red-600" />
              <SummaryCard label="Monthly EMI Burden" value={formatINRCompact(totalEMI)} />
              <SummaryCard label="Interest Remaining" value={formatINRCompact(totalIntRemaining)} />
              <SummaryCard label="Active Loans" value={active.length} />
            </div>

            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">Your Loans</p>
                <select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value)}
                  className="text-[10px] font-bold text-green-600 bg-white border border-gray-200 rounded px-2 py-1 uppercase tracking-widest outline-none hover:border-green-400 transition-all cursor-pointer shadow-sm"
                >
                  <option value="none">Default Sort</option>
                  <option value="outstanding_high">Outstanding: High to Low</option>
                  <option value="outstanding_low">Outstanding: Low to High</option>
                  <option value="emi_high">EMI: High to Low</option>
                  <option value="emi_low">EMI: Low to High</option>
                  <option value="rate_high">Rate: High to Low</option>
                  <option value="rate_low">Rate: Low to High</option>
                </select>
              </div>
              <button onClick={() => navigate('/add')} className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 font-medium">
                + Add Loan
              </button>
            </div>

            {active.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm mb-4">
                  {closed.length > 0 ? 'No active loans. All your loans are closed.' : 'No loans added yet.'}
                </p>
                <button onClick={() => navigate('/add')} className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                  + Add {closed.length > 0 ? 'a loan' : 'your first loan'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[...states]
                  .sort((a, b) => {
                    if (sortOption === 'outstanding_high') return b.state.outstanding - a.state.outstanding
                    if (sortOption === 'outstanding_low') return a.state.outstanding - b.state.outstanding
                    if (sortOption === 'emi_high') return b.loan.emiAmount - a.loan.emiAmount
                    if (sortOption === 'emi_low') return a.loan.emiAmount - b.loan.emiAmount
                    if (sortOption === 'rate_high') return b.loan.annualInterestRate - a.loan.annualInterestRate
                    if (sortOption === 'rate_low') return a.loan.annualInterestRate - b.loan.annualInterestRate
                    return 0
                  })
                  .map(({ loan, state, trueCost }) => (
                    <LoanCard
                      key={loan.id}
                      loan={loan}
                      state={state}
                      trueCost={trueCost}
                      navigate={navigate}
                      onClose={() => setClosingLoan({ loan, state, mode: state.isCompleted ? 'complete' : 'close' })}
                    />
                  ))}
              </div>
            )}

            {closed.length > 0 && (
              <ClosedLoansSection
                loans={closed}
                open={showClosed}
                onToggle={() => setShowClosed(v => !v)}
                onReopen={handleReopen}
                onDelete={handleDeletePermanently}
                navigate={navigate}
              />
            )}
          </>
        )}
      </div>

      {closingLoan && (
        <CloseLoanModal
          loan={closingLoan.loan}
          state={closingLoan.state}
          mode={closingLoan.mode}
          onCancel={() => setClosingLoan(null)}
          onConfirm={(closure) => handleClose(closingLoan.loan.id, closure)}
          onDeletePermanently={() => handleDeletePermanently(closingLoan.loan)}
        />
      )}
    </div>
  )
}

function SummaryCard({ label, value, valueClass = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}

function LoanCard({ loan, state, trueCost, navigate, onClose }) {
  const badge = BADGE_COLORS[loan.type] || 'bg-gray-100 text-gray-600'

  const currentMonth = state.emisPaid + 1
  const fc = calculateForeclosureSavings(loan, currentMonth)
  const totalPrincipalInterest = state.principalPaid + state.interestPaid

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-900 text-sm">{loan.nickname}</p>
          <p className="text-xs text-gray-400 mt-0.5">{loan.lender}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge}`}>{loan.type}</span>
      </div>

      {state.isCompleted && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
          <p className="text-xs text-green-700">All EMIs are paid.</p>
          <button onClick={onClose} className="text-xs font-semibold text-green-700 hover:text-green-800 whitespace-nowrap">
            Mark as completed →
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <Stat label="Outstanding" value={formatINR(state.outstanding)} valueClass="text-red-500 font-medium" />
        <Stat label="EMI / month" value={formatINR(loan.emiAmount)} />
        <Stat label="Interest left" value={formatINR(state.interestRemaining)} />
        <Stat label="Stated Rate" value={formatPct(loan.annualInterestRate)} valueClass="text-blue-600" />
        <Stat label="Effective APR" value={formatPct(trueCost.effectiveAPR)} valueClass="text-amber-600" />
        {fc.feasible ? (
          <>
            <Stat label="Foreclosure Charge" value={formatPct(loan.foreclosure?.chargePercent ?? 0)} valueClass="text-orange-500" />
            <Stat label="Foreclosure Charge Amt" value={formatINR(fc.foreclosureCharge)} valueClass="text-orange-600 font-medium" />
          </>
        ) : (
          <Stat label="Foreclosure" value="Not allowed" valueClass="text-gray-400" />
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>{state.emisPaid}/{loan.tenureMonths} EMIs paid</span>
          <span>{state.progressPct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-1.5">
          <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${state.progressPct}%` }} />
        </div>
      </div>
      <div>
        <div className="flex h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-green-400"
            style={{ width: `${totalPrincipalInterest > 0 ? Math.round((state.principalPaid / totalPrincipalInterest) * 100) : 0}%` }}
          />
          <div className="bg-red-300 flex-1" />
        </div>
        <div className="flex gap-3 mt-1">
          <span className="text-xs text-gray-400"><span className="inline-block w-2 h-2 rounded-sm bg-green-400 mr-1" />Principal</span>
          <span className="text-xs text-gray-400"><span className="inline-block w-2 h-2 rounded-sm bg-red-300 mr-1" />Interest</span>
        </div>
      </div>
      <p className="text-xs text-gray-400">Next EMI: <span className="text-gray-600 font-medium">{formatDate(state.nextEmiDate)}</span></p>
      <div className="flex gap-2 mt-1">
        <button onClick={() => navigate(`/loan/${loan.id}`)} className="flex-1 text-xs py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Schedule</button>
        <button onClick={() => navigate(`/simulator?loan=${loan.id}`)} className="flex-1 text-xs py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Simulate</button>
        <button onClick={() => navigate(`/edit/${loan.id}`)} className="flex-1 text-xs py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Edit</button>
        <button onClick={onClose} className="flex-1 text-xs py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 whitespace-nowrap">Close loan</button>
      </div>
    </div>
  )
}

// ── Close / delete dialog ────────────────────────────────────────────────────

function CloseLoanModal({ loan, state, mode, onCancel, onConfirm, onDeletePermanently }) {
  const fc = calculateForeclosureSavings(loan, state.emisPaid + 1)
  const suggestedCharges = fc.feasible ? Math.round(fc.foreclosureCharge) : 0
  const suggestedPayout = Math.round(fc.feasible ? fc.totalPayout : state.outstanding)

  // A loan that ran its full course closed on its last EMI date, not today.
  const lastEmiDate = (() => {
    const today = todayISO()
    const past = generateAmortizationSchedule(loan).filter(r => r.date <= today)
    return past.length ? past[past.length - 1].date : today
  })()

  const [type, setType] = useState(mode === 'complete' ? 'completed' : 'preclosed')
  const [closedOn, setClosedOn] = useState(mode === 'complete' ? lastEmiDate : todayISO())
  const [amountPaid, setAmountPaid] = useState(String(suggestedPayout))
  const [charges, setCharges] = useState(String(suggestedCharges))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const amountNum = parseFloat(amountPaid)
  const chargesNum = parseFloat(charges) || 0
  const invalid =
    !closedOn ||
    closedOn > todayISO() ||
    (type === 'preclosed' && (!(amountNum >= 0) || chargesNum < 0 || chargesNum > amountNum))

  const submit = async (e) => {
    e.preventDefault()
    if (invalid || saving) return
    setSaving(true)
    await onConfirm({
      type,
      closed_on: closedOn,
      amount_paid: type === 'preclosed' ? amountNum : 0,
      charges: type === 'preclosed' ? chargesNum : 0,
      note: note.trim() || null,
    })
    setSaving(false)
  }

  const inputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/30 focus:border-green-500'

  return (
    // Closes only via Cancel / Mark as closed / Delete: a click outside (or a
    // text selection that ends outside) must never throw away what you typed.
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Close or delete “{loan.nickname}”</h3>
          <p className="text-xs text-gray-500 mt-1">
            Closing keeps the loan under <span className="font-medium">Closed loans</span> with its full history. It stops
            counting in your outstanding, EMIs, alerts and suggestions, and you can reopen it any time.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How was it closed">
            {[
              { id: 'preclosed', title: 'Pre-closed', hint: 'Paid off early' },
              { id: 'completed', title: 'Completed', hint: 'All EMIs paid' },
            ].map(opt => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={type === opt.id}
                onClick={() => setType(opt.id)}
                className={`text-left px-3 py-2.5 rounded-lg border transition-colors ${type === opt.id
                  ? 'border-green-500 bg-green-50 ring-1 ring-green-500'
                  : 'border-gray-200 hover:border-gray-300'
                  }`}
              >
                <p className="text-sm font-semibold text-gray-900">{opt.title}</p>
                <p className="text-xs text-gray-500">{opt.hint}</p>
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Closed on</span>
            <input type="date" value={closedOn} max={todayISO()} onChange={(e) => setClosedOn(e.target.value)} className={`${inputClass} mt-1`} required />
          </label>

          {type === 'preclosed' && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Amount paid to close</span>
                <input type="number" min="0" step="any" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} className={`${inputClass} mt-1`} required />
                <span className="text-[11px] text-gray-400">Total paid to the lender, incl. charges</span>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Of which charges</span>
                <input type="number" min="0" step="any" value={charges} onChange={(e) => setCharges(e.target.value)} className={`${inputClass} mt-1`} />
                <span className="text-[11px] text-gray-400">Foreclosure fee + GST</span>
              </label>
            </div>
          )}

          <label className="block">
            <span className="text-xs font-medium text-gray-600">Note (optional)</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. NOC received" className={`${inputClass} mt-1`} />
          </label>

          {type === 'preclosed' && chargesNum > amountNum && (
            <p className="text-xs text-red-600">Charges can&apos;t be more than the amount paid.</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3 bg-gray-50">
          <button type="button" onClick={onDeletePermanently} className="text-xs font-medium text-red-500 hover:text-red-600">
            Delete permanently
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-white">
              Cancel
            </button>
            <button
              type="submit"
              disabled={invalid || saving}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Mark as closed'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// ── Closed loans (history) ───────────────────────────────────────────────────

function ClosedLoansSection({ loans, open, onToggle, onReopen, onDelete, navigate }) {
  const sorted = [...loans].sort((a, b) => String(b.closure?.closed_on || '').localeCompare(String(a.closure?.closed_on || '')))

  return (
    <section className="mt-10">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">Closed loans</span>
          <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{loans.length}</span>
        </span>
        <span className={`text-gray-400 text-sm transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="mt-3 bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
          {sorted.map(loan => {
            const s = closedLoanSummary(loan)
            const c = loan.closure || {}
            return (
              <div key={loan.id} className="px-4 sm:px-5 py-4 grid grid-cols-2 md:grid-cols-[minmax(180px,1.4fr)_repeat(4,minmax(90px,1fr))_auto] gap-x-5 gap-y-3 items-center">
                <div className="col-span-2 md:col-span-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate" title={loan.nickname}>{loan.nickname}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${c.type === 'preclosed' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                      {CLOSURE_LABEL[c.type] || 'Closed'}
                    </span>
                    <span className="text-xs text-gray-400">{loan.lender || loan.type}</span>
                  </div>
                  {c.note && <p className="text-xs text-gray-500 mt-1 truncate" title={c.note}>{c.note}</p>}
                </div>
                <Stat label="Closed on" value={formatDate(c.closed_on)} />
                <Stat label="Total paid" value={formatINR(s.totalPaid)} valueClass="text-gray-900 font-medium" />
                <Stat label="Interest paid" value={formatINR(s.interestPaid)} valueClass="text-red-500" />
                <Stat
                  label={c.type === 'preclosed' ? 'Interest saved' : 'EMIs paid'}
                  value={c.type === 'preclosed' ? formatINR(s.interestSaved) : `${s.emisPaid}/${loan.tenureMonths}`}
                  valueClass={c.type === 'preclosed' ? 'text-green-600 font-medium' : 'text-gray-800'}
                />
                <div className="col-span-2 md:col-span-1 flex gap-2 md:justify-end">
                  <button onClick={() => navigate(`/loan/${loan.id}`)} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Schedule</button>
                  <button onClick={() => onReopen(loan)} className="text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">Reopen</button>
                  <button onClick={() => onDelete(loan)} className="text-xs px-3 py-1.5 rounded-md border border-red-100 text-red-400 hover:bg-red-50">Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, valueClass = 'text-gray-800' }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-sm ${valueClass}`}>{value}</p>
    </div>
  )
}
