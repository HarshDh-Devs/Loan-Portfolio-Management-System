import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getLoanById } from '../data/hybridStorage'
import { generateAmortizationSchedule, getCurrentLoanState, calculateTrueCost } from '../math/engine'
import { formatINR, formatDate, formatPct, formatTenure } from '../utils/format'
import Navbar from '../components/Navbar'

export default function LoanDetail({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [loan, setLoan] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const data = await getLoanById(id, session)
      setLoan(data)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!loan) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-gray-500 mb-4">Loan not found.</p>
        <button onClick={() => navigate('/')} className="text-green-600 text-sm hover:underline">← Back to Dashboard</button>
      </div>
    </div>
  )

  const schedule = generateAmortizationSchedule(loan)
  const state = getCurrentLoanState(loan)
  const tc = calculateTrueCost(loan)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const totalFees = (loan.fees.processingFee || 0) + (loan.fees.processingFeeGST || 0) + (loan.fees.insuranceCharges || 0)
  const totalInterest = schedule.reduce((s, r) => s + r.interestComponent, 0)
  const totalGST = schedule.reduce((s, r) => s + (r.gstOnInterest || 0), 0)
  const hasGST = loan.gstOnInterest === true

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Dashboard" />

      <div className="max-w-6xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-600 mb-2 block">← Back to Dashboard</button>
            <h1 className="text-xl font-semibold text-gray-900">{loan.nickname}</h1>
            <p className="text-sm text-gray-400 mt-0.5">{loan.lender} · {loan.type} Loan · {formatTenure(loan.tenureMonths)}</p>
          </div>
          <button onClick={() => navigate(`/simulator?loan=${loan.id}`)} className="px-5 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 font-medium">
            Run Simulator →
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard label="Outstanding Principal" value={formatINR(state.outstanding)} valueClass="text-red-500" />
          <StatCard label="Interest Remaining" value={formatINR(state.interestRemaining)} />
          <StatCard label="Interest Paid So Far" value={formatINR(state.interestPaid)} />
          <StatCard label="Stated Interest Rate" value={formatPct(loan.annualInterestRate)} valueClass="text-blue-600" />
          <StatCard label="Effective APR" value={formatPct(tc.effectiveAPR)} valueClass="text-amber-600" />
        </div>

        {hasGST && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-6 flex items-center gap-3">
            <span className="text-amber-500 text-lg">⚠</span>
            <div>
              <p className="text-sm font-medium text-amber-700">18% GST on interest applies to this loan</p>
              <p className="text-xs text-amber-600 mt-0.5">Total GST over tenure: <span className="font-semibold">{formatINR(totalGST)}</span> — charged separately on top of EMI each month.</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">True Cost Breakdown</h2>
          <div className={`grid grid-cols-2 gap-6 ${hasGST ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
            <CostItem label="Principal" value={formatINR(loan.principal)} color="bg-green-500" />
            <CostItem label="Total Interest" value={formatINR(totalInterest)} color="bg-red-400" />
            {hasGST && <CostItem label="GST on Interest" value={formatINR(totalGST)} color="bg-orange-400" />}
            <CostItem label="Total Fees" value={formatINR(totalFees)} color="bg-amber-400" />
            <CostItem label="Total Outflow" value={formatINR(tc.totalAmountPaid)} color="bg-gray-800" bold />
          </div>
          <div className="mt-5">
            <div className="flex h-3 rounded-full overflow-hidden w-full">
              <div className="bg-green-500" style={{ width: `${(loan.principal / tc.totalAmountPaid) * 100}%` }} />
              <div className="bg-red-400" style={{ width: `${(totalInterest / tc.totalAmountPaid) * 100}%` }} />
              {hasGST && <div className="bg-orange-400" style={{ width: `${(totalGST / tc.totalAmountPaid) * 100}%` }} />}
              <div className="bg-amber-400 flex-1" />
            </div>
            <div className="flex gap-5 mt-2 flex-wrap">
              <Legend color="bg-green-500" label="Principal" />
              <Legend color="bg-red-400" label="Interest" />
              {hasGST && <Legend color="bg-orange-400" label="GST on Interest" />}
              <Legend color="bg-amber-400" label="Fees" />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-4 gap-4 text-sm">
            <div><span className="text-gray-400">Stated rate: </span><span className="font-medium">{formatPct(loan.annualInterestRate)}</span></div>
            <div><span className="text-gray-400">Monthly rate: </span><span className="font-medium">{formatPct(loan.annualInterestRate / 12, 3)}</span></div>
            <div><span className="text-gray-400">Effective APR: </span><span className="font-medium text-amber-600">{formatPct(tc.effectiveAPR)}</span></div>
            <div><span className="text-gray-400">Fee uplift: </span><span className="font-medium text-red-500">+{formatPct(tc.rateDiff)}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Amortization Schedule</h2>
            <span className="text-xs text-gray-400">{schedule.length} months · current month highlighted</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-400 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left font-medium">Month</th>
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-right font-medium">Outstanding Principal</th>
                  <th className="px-4 py-3 text-right font-medium">Closing Balance</th>
                  <th className="px-4 py-3 text-right font-medium">Principal</th>
                  <th className="px-4 py-3 text-right font-medium">Interest</th>
                  {hasGST && <th className="px-4 py-3 text-right font-medium text-orange-500">GST (18%)</th>}
                  <th className="px-4 py-3 text-right font-medium">Monthly EMI</th>
                  {hasGST && <th className="px-4 py-3 text-right font-medium text-orange-500">Total Outflow</th>}
                  <th className="px-4 py-3 text-right font-medium">Cum. Interest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {schedule.map((row) => {
                  const rowDate = new Date(row.date)
                  const isPast = rowDate < today
                  const isCurrentMonth = rowDate.getFullYear() === today.getFullYear() && rowDate.getMonth() === today.getMonth()
                  return (
                    <tr key={row.month} className={`${isCurrentMonth ? 'bg-green-50 font-medium' : ''} ${isPast && !isCurrentMonth ? 'opacity-50' : ''} hover:bg-gray-50 transition`}>
                      <td className="px-4 py-2.5 text-gray-500">
                        <span className={`${isCurrentMonth ? 'bg-green-500 text-white px-2 py-0.5 rounded-full text-xs' : ''}`}>{row.month}</span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{formatDate(row.date)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-700">{formatINR(row.openingBalance)}</td>
                      <td className="px-4 py-2.5 text-right text-gray-500">{formatINR(row.closingBalance)}</td>
                      <td className="px-4 py-2.5 text-right text-green-600">{formatINR(row.principalComponent)}</td>
                      <td className="px-4 py-2.5 text-right text-red-400">{formatINR(row.interestComponent)}</td>
                      {hasGST && <td className="px-4 py-2.5 text-right text-orange-400">{formatINR(row.gstOnInterest)}</td>}
                      <td className="px-4 py-2.5 text-right text-gray-700">{formatINR(row.emiPaid)}</td>
                      {hasGST && <td className="px-4 py-2.5 text-right font-medium text-gray-800">{formatINR(row.totalMonthlyOutflow)}</td>}
                      <td className="px-4 py-2.5 text-right text-gray-400">{formatINR(row.cumulativeInterestPaid)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, valueClass = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}

function CostItem({ label, value, color, bold }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-lg ${bold ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>{value}</p>
    </div>
  )
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-gray-400">
      <span className={`w-2.5 h-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  )
}