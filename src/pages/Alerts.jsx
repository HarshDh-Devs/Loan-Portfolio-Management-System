import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState, generateAmortizationSchedule, calculateTrueCost } from '../math/engine'
import { formatINR, formatDate } from '../utils/format'
import Navbar from '../components/Navbar'

function getDaysUntil(isoDate) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(isoDate)
  d.setHours(0, 0, 0, 0)
  return Math.round((d - today) / (1000 * 60 * 60 * 24))
}

export default function Alerts({ session }) {
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    async function load() {
      const loans = await getLoans(session)
      const all = []

      loans.forEach(loan => {
        const state = getCurrentLoanState(loan)
        if (state.isCompleted) return
        const schedule = generateAmortizationSchedule(loan)

        if (state.nextEmiDate) {
          const days = getDaysUntil(state.nextEmiDate)
          if (days >= 0 && days <= 7) {
            all.push({
              id: `emi-${loan.id}`, type: 'emi',
              severity: days <= 2 ? 'high' : 'medium',
              loan: loan.nickname, lender: loan.lender,
              title: `EMI due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`,
              detail: `₹${Math.round(loan.emiAmount).toLocaleString('en-IN')} due on ${formatDate(state.nextEmiDate)}`,
              action: null,
            })
          }
        }

        const pct = state.progressPct
        const prevPct = ((state.emisPaid - 1) / loan.tenureMonths) * 100
        ;[25, 50, 75].forEach(milestone => {
          if (prevPct < milestone && pct >= milestone) {
            all.push({
              id: `milestone-${loan.id}-${milestone}`, type: 'milestone', severity: 'info',
              loan: loan.nickname, lender: loan.lender,
              title: `${milestone}% principal paid off!`,
              detail: `You've paid off ${formatINR(state.principalPaid)} of ${formatINR(loan.principal)} principal on this loan.`,
              action: () => navigate(`/loan/${loan.id}`),
              actionLabel: 'View schedule →',
            })
          }
        })

        const currentRow = schedule[state.emisPaid]
        if (currentRow) {
          const ratio = currentRow.interestComponent / currentRow.principalComponent
          if (ratio > 1.5) {
            all.push({
              id: `interest-heavy-${loan.id}`, type: 'warning', severity: 'high',
              loan: loan.nickname, lender: loan.lender,
              title: 'Paying more interest than principal',
              detail: `This month: ${formatINR(currentRow.interestComponent)} interest vs ${formatINR(currentRow.principalComponent)} principal. Early tenure — a prepayment now saves the most.`,
              action: () => navigate(`/simulator?loan=${loan.id}`),
              actionLabel: 'Simulate prepayment →',
            })
          }
        }

        const tc = calculateTrueCost(loan)
        if (tc.rateDiff && tc.rateDiff > 1) {
          all.push({
            id: `apr-${loan.id}`, type: 'warning', severity: 'medium',
            loan: loan.nickname, lender: loan.lender,
            title: `Effective APR is ${tc.rateDiff.toFixed(1)}% higher than stated`,
            detail: `Stated: ${loan.annualInterestRate}% · Effective: ${tc.effectiveAPR}% — fees are significantly inflating your true cost.`,
            action: () => navigate(`/loan/${loan.id}`),
            actionLabel: 'View true cost →',
          })
        }
      })

      const order = { high: 0, medium: 1, info: 2 }
      all.sort((a, b) => order[a.severity] - order[b.severity])
      setAlerts(all)
    }
    load()
  }, [])

  const severityConfig = {
    high: { bar: 'bg-red-500', badge: 'bg-red-100 text-red-700', icon: '!', iconBg: 'bg-red-100 text-red-600' },
    medium: { bar: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700', icon: '⚠', iconBg: 'bg-amber-100 text-amber-600' },
    info: { bar: 'bg-green-500', badge: 'bg-green-100 text-green-700', icon: '★', iconBg: 'bg-green-100 text-green-600' },
  }

  const typeLabels = { emi: 'EMI Due', lock: 'Lock-in', milestone: 'Milestone', warning: 'Warning' }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Alerts" />

      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Alerts</h1>
            <p className="text-sm text-gray-400 mt-1">
              {alerts.length === 0 ? 'No alerts right now.' : `${alerts.length} alert${alerts.length > 1 ? 's' : ''} across your portfolio`}
            </p>
          </div>
          {alerts.length > 0 && (
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 bg-red-100 text-red-600 rounded-full font-medium">{alerts.filter(a => a.severity === 'high').length} high</span>
              <span className="px-2 py-1 bg-amber-100 text-amber-600 rounded-full font-medium">{alerts.filter(a => a.severity === 'medium').length} medium</span>
              <span className="px-2 py-1 bg-green-100 text-green-600 rounded-full font-medium">{alerts.filter(a => a.severity === 'info').length} info</span>
            </div>
          )}
        </div>

        {alerts.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
            <p className="text-4xl mb-4">✓</p>
            <p className="text-gray-700 font-medium mb-1">All clear</p>
            <p className="text-sm text-gray-400">No EMIs due, no issues detected.</p>
          </div>
        )}

        <div className="space-y-3">
          {alerts.map(alert => {
            const cfg = severityConfig[alert.severity]
            return (
              <div key={alert.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex">
                <div className={`w-1 flex-shrink-0 ${cfg.bar}`} />
                <div className="flex-1 px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${cfg.iconBg}`}>{cfg.icon}</span>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.badge}`}>{typeLabels[alert.type]}</span>
                          <span className="text-xs text-gray-400">{alert.loan} · {alert.lender}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-800">{alert.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{alert.detail}</p>
                      </div>
                    </div>
                    {alert.action && (
                      <button onClick={alert.action}
                        className="flex-shrink-0 text-xs text-green-600 hover:text-green-700 font-medium border border-green-200 px-3 py-1.5 rounded-lg hover:bg-green-50 transition whitespace-nowrap">
                        {alert.actionLabel}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}