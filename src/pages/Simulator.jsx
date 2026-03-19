import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getLoans } from '../data/hybridStorage'
import { calculatePrepaymentSavings, calculateForeclosureSavings, getCurrentLoanState } from '../math/engine'
import { formatINR, formatDate } from '../utils/format'
import Navbar from '../components/Navbar'

export default function Simulator({ session }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loans, setLoans] = useState([])
  const [selectedLoanId, setSelectedLoanId] = useState('')
  const [mode, setMode] = useState('prepayment')
  const [prepayAmount, setPrepayAmount] = useState('')
  const [prepayMonth, setPrepayMonth] = useState('')
  const [prepayResult, setPrepayResult] = useState(null)
  const [fcMonth, setFcMonth] = useState('')
  const [fcResult, setFcResult] = useState(null)

  useEffect(() => {
    async function load() {
      const data = await getLoans(session)
      setLoans(data)
      const paramId = searchParams.get('loan')
      if (paramId && data.find(l => l.id === paramId)) {
        setSelectedLoanId(paramId)
      } else if (data.length > 0) {
        setSelectedLoanId(data[0].id)
      }
    }
    load()
  }, [])

  const loan = loans.find(l => l.id === selectedLoanId)
  const state = loan ? getCurrentLoanState(loan) : null

  function runPrepayment() {
    if (!loan || !prepayAmount || !prepayMonth) return
    setPrepayResult(calculatePrepaymentSavings(loan, Number(prepayAmount), Number(prepayMonth)))
  }

  function runForeclosure() {
    if (!loan || !fcMonth) return
    setFcResult(calculateForeclosureSavings(loan, Number(fcMonth)))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Simulator" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">Loan Simulator</h1>
          <p className="text-sm text-gray-400 mt-1">Model prepayment or foreclosure scenarios and see exact savings.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 block">Select Loan</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {loans.map(l => (
              <button key={l.id} onClick={() => { setSelectedLoanId(l.id); setPrepayResult(null); setFcResult(null) }}
                className={`text-left px-4 py-3 rounded-xl border text-sm transition ${selectedLoanId === l.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'}`}>
                <p className="font-medium">{l.nickname}</p>
                <p className="text-xs mt-0.5 opacity-70">{l.lender} · {l.annualInterestRate}%</p>
              </button>
            ))}
          </div>
          {loan && state && (
            <div className="grid grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
              <MiniStat label="Outstanding" value={formatINR(state.outstanding)} />
              <MiniStat label="EMIs Remaining" value={`${state.emisRemaining} months`} />
              <MiniStat label="Interest Remaining" value={formatINR(state.interestRemaining)} />
              <MiniStat label="Next EMI" value={formatDate(state.nextEmiDate)} />
            </div>
          )}
        </div>

        <div className="flex gap-3 mb-6">
          <button onClick={() => setMode('prepayment')}
            className={`px-5 py-2 rounded-lg text-sm font-medium border transition ${mode === 'prepayment' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Prepayment Simulator
          </button>
          <button onClick={() => setMode('foreclosure')}
            className={`px-5 py-2 rounded-lg text-sm font-medium border transition ${mode === 'foreclosure' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            Foreclosure Simulator
          </button>
        </div>

        {mode === 'prepayment' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Prepayment Simulator</h2>
            <p className="text-xs text-gray-400 mb-5">Make a lump sum payment and see how much interest and time you save.</p>
            <div className="grid grid-cols-3 gap-5 mb-5">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">Extra Amount (₹)</label>
                <input type="number" value={prepayAmount} onChange={e => { setPrepayAmount(e.target.value); setPrepayResult(null) }}
                  placeholder="e.g. 100000" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">
                  Pay in Month # {state && <span className="text-gray-300 ml-1 normal-case font-normal">(current: {state.emisPaid + 1})</span>}
                </label>
                <input type="number" value={prepayMonth} onChange={e => { setPrepayMonth(e.target.value); setPrepayResult(null) }}
                  placeholder={state ? `${state.emisPaid + 1}` : '1'} min="1" max={loan?.tenureMonths}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="flex items-end gap-2">
                <button onClick={runPrepayment} disabled={!prepayAmount || !prepayMonth || !loan}
                  className="flex-1 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">
                  Calculate
                </button>
                <button onClick={() => { setPrepayAmount(''); setPrepayMonth(''); setPrepayResult(null) }}
                  className="py-2.5 px-3 border border-gray-200 text-gray-400 text-sm rounded-lg hover:bg-gray-50">Reset</button>
              </div>
            </div>
            {prepayResult && (
              <div className={`rounded-xl border p-5 mt-2 ${prepayResult.feasible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
                {!prepayResult.feasible ? (
                  <div className="flex items-start gap-3">
                    <span className="text-red-500 text-lg">✕</span>
                    <div><p className="text-sm font-medium text-red-700">Not feasible</p><p className="text-sm text-red-600 mt-0.5">{prepayResult.reason}</p></div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="text-green-600 text-lg">✓</span>
                      <p className="text-sm font-semibold text-green-700">{prepayResult.fullPayoff ? 'Full loan payoff!' : `Save ${prepayResult.monthsSaved} months`}</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <ResultStat label="Interest Saved" value={formatINR(prepayResult.interestSaved)} valueClass="text-green-700 font-semibold" />
                      <ResultStat label="Prepayment Charge" value={formatINR(prepayResult.prepaymentCharge)} valueClass="text-red-500" />
                      <ResultStat label="Net Savings" value={formatINR(prepayResult.netSavings)} valueClass="text-green-700 font-bold text-lg" />
                      <ResultStat label="Months Saved" value={`${prepayResult.monthsSaved} months`} valueClass="text-green-700 font-semibold" />
                    </div>
                    {prepayResult.newTenureMonths && (
                      <p className="text-xs text-gray-500 mt-4 pt-4 border-t border-green-200">
                        New tenure: <span className="font-medium text-gray-700">{prepayResult.newTenureMonths} months</span> (was {loan.tenureMonths} months)
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {mode === 'foreclosure' && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Foreclosure Simulator</h2>
            <p className="text-xs text-gray-400 mb-5">Calculate the total payout needed to close the loan early.</p>
            <div className="grid grid-cols-3 gap-5 mb-5">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1.5 block">
                  Foreclose in Month # {state && <span className="text-gray-300 ml-1 normal-case font-normal">(current: {state.emisPaid + 1})</span>}
                </label>
                <input type="number" value={fcMonth} onChange={e => { setFcMonth(e.target.value); setFcResult(null) }}
                  placeholder={state ? `${state.emisPaid + 1}` : '1'} min="1" max={loan?.tenureMonths}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              </div>
              <div className="flex items-end gap-2">
                <button onClick={runForeclosure} disabled={!fcMonth || !loan}
                  className="flex-1 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">
                  Calculate
                </button>
                <button onClick={() => { setFcMonth(''); setFcResult(null) }}
                  className="py-2.5 px-3 border border-gray-200 text-gray-400 text-sm rounded-lg hover:bg-gray-50">Reset</button>
              </div>
            </div>
            {fcResult && (
              <div className={`rounded-xl border p-5 mt-2 ${fcResult.feasible ? (fcResult.isWorthIt ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50') : 'border-red-200 bg-red-50'}`}>
                {!fcResult.feasible ? (
                  <div className="flex items-start gap-3">
                    <span className="text-red-500 text-lg">✕</span>
                    <div><p className="text-sm font-medium text-red-700">Not feasible</p><p className="text-sm text-red-600 mt-0.5">{fcResult.reason}</p></div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-4">
                      <span className={`text-lg ${fcResult.isWorthIt ? 'text-green-600' : 'text-amber-500'}`}>{fcResult.isWorthIt ? '✓' : '⚠'}</span>
                      <p className={`text-sm font-semibold ${fcResult.isWorthIt ? 'text-green-700' : 'text-amber-700'}`}>
                        {fcResult.isWorthIt ? 'Worth it — you save money by foreclosing' : 'Not worth it — foreclosure charge exceeds interest saved'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <ResultStat label="Outstanding" value={formatINR(fcResult.outstandingAtMonth)} />
                      <ResultStat label="Foreclosure Charge" value={formatINR(fcResult.foreclosureCharge)} valueClass="text-red-500" />
                      <ResultStat label="Total Payout" value={formatINR(fcResult.totalPayout)} valueClass="font-semibold text-gray-800" />
                      <ResultStat label="Net Savings" value={formatINR(fcResult.netSavings)} valueClass={`font-bold text-lg ${fcResult.isWorthIt ? 'text-green-700' : 'text-amber-600'}`} />
                    </div>
                    {fcResult.breakEvenMonth && (
                      <p className="text-xs text-gray-500 mt-4 pt-4 border-t border-green-200">
                        Break-even month: <span className="font-medium text-gray-700">Month {fcResult.breakEvenMonth}</span> — foreclosing on or after this month saves you money.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MiniStat({ label, value }) {
  return <div><p className="text-xs text-gray-400 mb-0.5">{label}</p><p className="text-sm font-medium text-gray-800">{value}</p></div>
}

function ResultStat({ label, value, valueClass = 'text-gray-700' }) {
  return <div><p className="text-xs text-gray-400 mb-1">{label}</p><p className={`text-sm ${valueClass}`}>{value}</p></div>
}