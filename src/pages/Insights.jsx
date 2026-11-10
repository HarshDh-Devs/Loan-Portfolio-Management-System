import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { getActiveLoans } from '../data/hybridStorage'
import Navbar from '../components/Navbar'
import { askAI } from '../lib/ai'
import { analysePortfolio, planExtraMoney, SAFE_RETURN } from '../utils/portfolioInsights'

// ── Formatting ─────────────────────────────────────────────────

const inr = (n) => (n == null || isNaN(n) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'))
const pct = (n) => (n == null || isNaN(n) ? '—' : `${Math.round(n * 100) / 100}%`)
const monthYear = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—')

function duration(months) {
  const m = Math.max(0, Math.round(months))
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`
  const y = Math.floor(m / 12)
  const r = m % 12
  return `${y} year${y === 1 ? '' : 's'}${r ? ` ${r} month${r === 1 ? '' : 's'}` : ''}`
}

const TONES = {
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  gray: 'bg-gray-50 text-gray-600 border-gray-200',
}

// ── Pieces ─────────────────────────────────────────────────────

function Stat({ label, value, hint }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function verdictSentence(a) {
  const { close, state, verdict } = a
  const cost = `It costs you ${pct(a.realRate)} a year`
  switch (verdict.key) {
    case 'locked':
      return `${cost}, but it can't be closed until ${monthYear(close.unlockDate)} (lock-in).`
    case 'blocked':
      return `${cost}. The lender doesn't allow closing it early — just keep paying the EMIs.`
    case 'nearly':
      return `Only ${state.emisRemaining} EMI${state.emisRemaining === 1 ? '' : 's'} left, saving just ${inr(close.net)} by closing — simplest to let it finish.`
    case 'skip':
      return `${cost}. Closing now would cost ${inr(close.charge.total)} in charges but save only ${inr(close.interestSaved)} of interest — you'd lose ${inr(-close.net)}. Keep paying the EMIs.`
    default: {
      const chargePart = close.charge.total > 0
        ? ` (incl. ${inr(close.charge.total)} closure charge${close.charge.gst > 0 ? ' with GST' : ''})`
        : ''
      const recovery = close.charge.total > 0
        ? ` The charge pays for itself in ${close.recoveryMonths < 1 ? 'under a month' : duration(Math.ceil(close.recoveryMonths))} of saved interest.`
        : ''
      return `${cost}. Closing it today takes ${inr(close.payout)}${chargePart} and saves ${inr(close.interestSaved)} of interest — ${inr(close.net)} better off.${recovery}`
    }
  }
}

function LoanCard({ a, rank, onEdit }) {
  const { loan, state, close, verdict } = a
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-7 h-7 shrink-0 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold flex items-center justify-center">{rank}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{loan.nickname}</p>
            <p className="text-xs text-gray-400">{loan.lender ? `${loan.lender} · ` : ''}{loan.type} loan</p>
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${TONES[verdict.tone]}`}>{verdict.label}</span>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed mt-3">{verdictSentence(a)}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-4 text-xs">
        <div><p className="text-gray-400">You owe</p><p className="text-gray-800 font-medium tabular-nums">{inr(state.outstanding)}</p></div>
        <div><p className="text-gray-400">Interest left</p><p className="text-gray-800 font-medium tabular-nums">{inr(a.interestLeft)}</p></div>
        <div><p className="text-gray-400">Ends</p><p className="text-gray-800 font-medium">{monthYear(a.endDate)} · {state.emisRemaining} EMIs</p></div>
        <div>
          <p className="text-gray-400" title={`Closing early is like earning this much a year, guaranteed. A bank FD pays about ${SAFE_RETURN}%.`}>Return if closed ⓘ</p>
          <p className={`font-medium tabular-nums ${close.returnPct >= SAFE_RETURN ? 'text-green-700' : 'text-gray-800'}`}>
            {close.status === 'possible' && close.returnPct != null ? `${pct(close.returnPct)} a year` : '—'}
          </p>
        </div>
      </div>

      {(a.warnings.length > 0 || a.notes.length > 0) && (
        <ul className="mt-3 space-y-1">
          {a.warnings.map((w, i) => (
            <li key={`w${i}`} className="text-xs text-amber-700">
              ⚠ {w} <button onClick={() => onEdit(loan.id)} className="underline hover:text-amber-800">Edit loan</button>
            </li>
          ))}
          {a.notes.map((n, i) => <li key={`n${i}`} className="text-xs text-gray-500">• {n}</li>)}
        </ul>
      )}
    </div>
  )
}

function ExtraMoney({ items }) {
  const [amount, setAmount] = useState('')
  const plan = useMemo(() => (Number(amount) >= 1000 ? planExtraMoney(items, Number(amount)) : null), [items, amount])

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-800">Got some extra money?</h2>
      <p className="text-xs text-gray-500 mt-1">Enter an amount (bonus, savings…) and see the best place to put it.</p>
      <div className="mt-4 flex items-center gap-2 max-w-xs">
        <span className="text-sm text-gray-500">₹</span>
        <input type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 100000"
          aria-label="Extra money amount"
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      {plan && (
        <div className="mt-5 space-y-3">
          {plan.steps.length === 0 && (
            <p className="text-sm text-gray-600">
              None of your loans is worth prepaying with this amount — their remaining cost after charges is below what a bank FD earns (~{SAFE_RETURN}% a year). Keeping the money is fine.
            </p>
          )}
          {plan.steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <span className="w-6 h-6 shrink-0 rounded-full bg-green-50 text-green-700 text-xs font-semibold flex items-center justify-center">{i + 1}</span>
              <p className="text-sm text-gray-700 leading-relaxed">
                {s.action === 'close'
                  ? <>Close <b className="font-semibold">{s.a.loan.nickname}</b> with {inr(s.pay)}. You save {inr(s.interestSaved)} of interest{s.charge > 0 ? ` (after a ${inr(s.charge)} charge, ${inr(s.net)} net)` : ''} and your monthly payments drop by {inr(s.emiFreed)}.</>
                  : <>Put {inr(s.toLoan)} into <b className="font-semibold">{s.a.loan.nickname}</b>{s.charge > 0 ? ` (+ ${inr(s.charge)} charge)` : ''}. It ends {duration(s.monthsSaved)} sooner and saves {inr(s.net)} of interest.</>}
                {s.a.warnings.length > 0 && <span className="text-amber-700"> (Check this loan's details first — its EMI doesn't match.)</span>}
              </p>
            </div>
          ))}
          {plan.steps.length > 0 && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
              In total you save <b>{inr(plan.totalNet)}</b> of interest{plan.emiFreed > 0 ? <> and pay <b>{inr(plan.emiFreed)}</b> less every month</> : ''}.
              {plan.leftOver >= 1000 && <> {inr(plan.leftOver)} is left over — better kept in savings or an FD.</>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FeesTable({ items }) {
  const rows = items.filter(a => a.trueCost.totalFees > 0 && a.trueCost.effectiveAPR != null)
  if (!rows.length) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-800">What the fees really added</h2>
      <p className="text-xs text-gray-500 mt-1">Processing fees, insurance and other charges make a loan cost more than its stated rate. They're already paid, so they don't change what to close next — but they're worth comparing before your next loan.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 text-left">
              <th className="font-medium py-2 pr-4">Loan</th>
              <th className="font-medium py-2 pr-4 text-right">Stated rate</th>
              <th className="font-medium py-2 pr-4 text-right">Real cost with fees</th>
              <th className="font-medium py-2 text-right">Fees paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const diff = a.trueCost.effectiveAPR - a.rate
              return (
                <tr key={a.loan.id} className="border-t border-gray-100">
                  <td className="py-2 pr-4 text-gray-800">{a.loan.nickname}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{pct(a.rate)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-gray-800">
                    {pct(a.trueCost.effectiveAPR)}
                    {diff >= 0.05 && <span className={`ml-1 text-xs ${diff >= 1 ? 'text-amber-600' : 'text-gray-400'}`}>(+{pct(diff)})</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-gray-600">{inr(a.trueCost.totalFees)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Compare({ items }) {
  const [aId, setA] = useState(items[0]?.loan.id || '')
  const [bId, setB] = useState(items[1]?.loan.id || '')
  const A = items.find(x => x.loan.id === aId)
  const B = items.find(x => x.loan.id === bId)
  if (items.length < 2) return null

  const rows = A && B && A !== B ? [
    ['Yearly cost (rate)', pct(A.realRate), pct(B.realRate), A.realRate > B.realRate ? 0 : A.realRate < B.realRate ? 1 : null],
    ['Interest this month', inr(A.monthlyInterest), inr(B.monthlyInterest), A.monthlyInterest > B.monthlyInterest ? 0 : 1],
    ['You owe', inr(A.state.outstanding), inr(B.state.outstanding), null],
    ['Interest left', inr(A.interestLeft), inr(B.interestLeft), A.interestLeft > B.interestLeft ? 0 : 1],
    ['Charge to close today', A.close.status === 'possible' ? inr(A.close.charge.total) : '—', B.close.status === 'possible' ? inr(B.close.charge.total) : '—', null],
    ['Return if closed', A.close.returnPct != null ? pct(A.close.returnPct) : '—', B.close.returnPct != null ? pct(B.close.returnPct) : '—', null],
    ['Ends', monthYear(A.endDate), monthYear(B.endDate), null],
  ] : []

  const pricier = A && B && A !== B ? (A.realRate === B.realRate ? null : A.realRate > B.realRate ? A : B) : null
  const select = (value, onChange) => (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="flex-1 min-w-0 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
      {items.map(x => <option key={x.loan.id} value={x.loan.id}>{x.loan.nickname}</option>)}
    </select>
  )

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-800">Compare two loans</h2>
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 mt-4">
        {select(aId, setA)}
        <span className="text-gray-400 text-sm">vs</span>
        {select(bId, setB)}
      </div>
      {aId === bId && <p className="text-xs text-red-500 mt-2">Pick two different loans.</p>}
      {rows.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {rows.map(([label, va, vb, worse]) => (
                  <tr key={label} className="border-t border-gray-100 first:border-t-0">
                    <td className="py-2 pr-4 text-xs text-gray-500">{label}</td>
                    <td className={`py-2 pr-4 text-right tabular-nums ${worse === 0 ? 'text-red-600 font-medium' : 'text-gray-800'}`}>{va}</td>
                    <td className={`py-2 text-right tabular-nums ${worse === 1 ? 'text-red-600 font-medium' : 'text-gray-800'}`}>{vb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-gray-700 mt-3">
            {pricier
              ? <>Every rupee in <b className="font-semibold">{pricier.loan.nickname}</b> costs more ({pct(pricier.realRate)} a year), so extra money should go there first{pricier.close.status === 'possible' && pricier.close.net <= 0 ? ' — though closing it fully right now isn’t worth the charge' : ''}.</>
              : 'Both cost the same per rupee — prefer the one with the lower closure charge.'}
          </p>
        </>
      )}
    </div>
  )
}

function AiExplain({ portfolio }) {
  const [state, setState] = useState({ status: 'idle', text: '', error: '' })

  async function explain() {
    setState({ status: 'loading', text: '', error: '' })
    const t = portfolio.totals
    const facts = [
      `Total owed: ${inr(t.outstanding)}. Monthly payments: ${inr(t.monthlyPayment)}. Interest still to pay: ${inr(t.interestLeft)}. Debt-free by: ${monthYear(t.debtFreeDate)}.`,
      ...portfolio.ranked.map((a, i) => `${i + 1}. ${a.loan.nickname} — verdict: ${a.verdict.label}. ${verdictSentence(a)} Owes ${inr(a.state.outstanding)}, ${a.state.emisRemaining} EMIs left.${a.warnings.length ? " Warning: this loan's saved EMI doesn't match its rate, so its numbers may be off — the user should check its details." : ''}`),
      `Benchmark: a bank FD earns about ${SAFE_RETURN}% a year.`,
    ].join('\n')
    try {
      const text = await askAI({
        task: 'insights',
        maxTokens: 1200,
        messages: [
          { role: 'system', content: 'You are a kind, plain-spoken money coach for an Indian borrower. Write 4 to 6 short bullet points (each starting with "- ") that explain the situation and what to do next, in simple everyday English. Use ONLY the facts and numbers given — never calculate new numbers or invent anything. Use ₹ with Indian digit grouping. No headings, no tables.' },
          { role: 'user', content: facts },
        ],
      })
      setState({ status: 'done', text, error: '' })
    } catch (err) {
      setState({ status: 'error', text: '', error: err.message })
    }
  }

  const bullets = state.text
    .split('\n')
    .map(l => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Explain it simply</h2>
          <p className="text-xs text-gray-500 mt-1">AI turns the numbers above into a short plain-English summary. It doesn't change any number.</p>
        </div>
        <button onClick={explain} disabled={state.status === 'loading'}
          className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60">
          {state.status === 'loading' ? 'Writing…' : state.status === 'done' ? 'Write again' : 'Explain my loans'}
        </button>
      </div>
      {state.status === 'error' && <p className="text-sm text-red-600 mt-3">{state.error}</p>}
      {bullets.length > 0 && (
        <ul className="mt-4 space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="text-sm text-gray-700 leading-relaxed flex gap-2">
              <span className="text-green-500 mt-0.5">•</span>
              <span>{b.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <b key={j} className="font-semibold">{part}</b> : part))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────

export default function Insights({ session }) {
  const navigate = useNavigate()
  const [loans, setLoans] = useState(null)

  useEffect(() => {
    let alive = true
    getActiveLoans(session).then(data => { if (alive) setLoans(data) }).catch(() => { if (alive) setLoans([]) })
    return () => { alive = false }
  }, [session])

  const portfolio = useMemo(() => (loans ? analysePortfolio(loans) : null), [loans])
  const t = portfolio?.totals

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Loan Insights" />

      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Loan Insights</h1>
          <p className="text-sm text-gray-400 mt-0.5">Where your money goes, and where extra money helps most — calculated exactly from your loan details.</p>
        </div>

        {!portfolio && <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-sm text-gray-400">Loading your loans…</div>}

        {portfolio && portfolio.items.length === 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p className="text-sm text-gray-500">No active loans yet.</p>
            <button onClick={() => navigate('/add')} className="mt-4 px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">Add a loan</button>
          </div>
        )}

        {portfolio && portfolio.items.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="You owe in total" value={inr(t.outstanding)} hint={`${portfolio.items.length} active loan${portfolio.items.length === 1 ? '' : 's'}`} />
              <Stat label="Paid every month" value={inr(t.monthlyPayment)} hint={`${inr(t.monthlyInterest)} of it is interest`} />
              <Stat label="Interest still to pay" value={inr(t.interestLeft)} hint="if you just keep paying EMIs" />
              <Stat label="Debt-free by" value={monthYear(t.debtFreeDate)} hint={t.debtFreeDate ? `in ${duration(Math.max(0, (new Date(t.debtFreeDate).getFullYear() - new Date().getFullYear()) * 12 + new Date(t.debtFreeDate).getMonth() - new Date().getMonth()))}` : null} />
            </div>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-sm font-semibold text-gray-800">Where extra money helps most</h2>
                <p className="text-xs text-gray-400">Best first · after closure charges · compared with a ~{SAFE_RETURN}% bank FD</p>
              </div>
              <div className="space-y-3">
                {portfolio.ranked.map((a, i) => <LoanCard key={a.loan.id} a={a} rank={i + 1} onEdit={(id) => navigate(`/edit/${id}`)} />)}
              </div>
            </div>

            <ExtraMoney items={portfolio.items} />
            <FeesTable items={portfolio.items} />
            <Compare items={portfolio.items} />
            <AiExplain portfolio={portfolio} />
          </>
        )}
      </div>
    </div>
  )
}
