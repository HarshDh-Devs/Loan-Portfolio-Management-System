import { useEffect, useState } from 'react'
import { getLoans, deleteLoan, migrateLocalToCloud } from '../data/hybridStorage'
import { getCurrentLoanState, calculateTrueCost, calculateForeclosureSavings } from '../math/engine'
import { formatINR, formatINRCompact, formatDate, formatPct } from '../utils/format'
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

export default function Dashboard({ session }) {
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
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

  async function handleDelete(id) {
    if (!window.confirm('Delete this loan? This cannot be undone.')) return
    try {
      await deleteLoan(id, session)
      setLoans(prev => prev.filter(l => l.id !== id))
    } catch (err) {
      alert('Failed to delete. Please try again.')
    }
  }

  const states = loans.map(l => ({
    loan: l,
    state: getCurrentLoanState(l),
    trueCost: calculateTrueCost(l),
  }))

  const totalOutstanding = states.reduce((s, { state }) => s + state.outstanding, 0)
  const totalEMI = loans.reduce((s, l) => s + l.emiAmount, 0)
  const totalIntRemaining = states.reduce((s, { state }) => s + state.interestRemaining, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Dashboard" />

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
              <SummaryCard label="Active Loans" value={loans.length} />
            </div>

            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-widest">Your Loans</p>
              <button onClick={() => navigate('/add')} className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 font-medium">
                + Add Loan
              </button>
            </div>

            {loans.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 text-sm mb-4">No loans added yet.</p>
                <button onClick={() => navigate('/add')} className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">
                  + Add your first loan
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {states.map(({ loan, state, trueCost }) => (
                  <LoanCard key={loan.id} loan={loan} state={state} trueCost={trueCost} navigate={navigate} onDelete={handleDelete} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
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

function LoanCard({ loan, state, trueCost, navigate, onDelete }) {
  const badge = BADGE_COLORS[loan.type] || 'bg-gray-100 text-gray-600'

  const currentMonth = state.emisPaid + 1
  const fc = calculateForeclosureSavings(loan, currentMonth)

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-900 text-sm">{loan.nickname}</p>
          <p className="text-xs text-gray-400 mt-0.5">{loan.lender}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge}`}>{loan.type}</span>
      </div>
      <div className="grid grid-cols-2 gap-y-2 text-sm">
        <Stat label="Outstanding" value={formatINR(state.outstanding)} valueClass="text-red-500 font-medium" />
        <Stat label="EMI / month" value={formatINR(loan.emiAmount)} />
        <Stat label="Interest left" value={formatINR(state.interestRemaining)} />
        <Stat label="Stated Rate" value={formatPct(loan.annualInterestRate)} valueClass="text-blue-600" />
        <Stat label="Effective APR" value={formatPct(trueCost.effectiveAPR)} valueClass="text-amber-600" />
        {fc.feasible ? (
          <>
            <Stat label="Preclosure Charge" value={formatPct(loan.foreclosure?.chargePercent ?? 0)} valueClass="text-orange-500" />
            <Stat label="Preclosure Charge Amt" value={formatINR(fc.foreclosureCharge)} valueClass="text-orange-600 font-medium" />
          </>
        ) : (
          <Stat label="Preclosure" value="Not allowed" valueClass="text-gray-400" />
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
          <div className="bg-green-400" style={{ width: `${Math.round((state.principalPaid / (state.principalPaid + state.interestPaid)) * 100)}%` }} />
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
        <button onClick={() => onDelete(loan.id)} className="flex-1 text-xs py-1.5 rounded-md border border-red-100 text-red-400 hover:bg-red-50">Delete</button>
      </div>
    </div>
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