import { useState, useEffect } from 'react'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState, calculateTrueCost } from '../math/engine'
import { formatINR } from '../utils/format'
import Navbar from '../components/Navbar'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

async function callGroq(systemPrompt, userPrompt, maxTokens = 1500) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.choices[0].message.content
}

function buildAnalysis(loans) {
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

  const all = loans.map(loan => {
    const state = getCurrentLoanState(loan)
    const tc = calculateTrueCost(loan)

    const monthlyInterest = Math.round(state.outstanding * (loan.annualInterestRate / 100) / 12)
    const totalFees = Math.round(
      (loan.fees?.processingFee || 0) +
      (loan.fees?.processingFeeGST || 0) +
      (loan.fees?.insuranceCharges || 0)
    )
    const feeRateImpact = Number((tc.effectiveAPR - loan.annualInterestRate).toFixed(2))
    const canForeclose = loan.foreclosure?.allowed || false
    const foreclosureCharge = canForeclose
      ? Math.round(state.outstanding * (loan.foreclosure.chargePercent || 0) / 100) + (loan.foreclosure.chargeFlatAmount || 0)
      : null
    const netSavings = foreclosureCharge !== null
      ? Math.round(state.interestRemaining - foreclosureCharge)
      : null
    const penaltyRecoveryMonths = (foreclosureCharge && monthlyInterest > 0)
      ? (foreclosureCharge / monthlyInterest).toFixed(1)
      : null
    const isActive = state.emisRemaining > 0 && state.interestRemaining > 100
    const efficiencyScore =
      penaltyRecoveryMonths
        ? (netSavings / Number(penaltyRecoveryMonths)) + monthlyInterest
        : monthlyInterest

    return {
      id: loan.id,
      name: loan.nickname,
      type: loan.type,
      isActive,
      statedRate: loan.annualInterestRate,
      effectiveAPR: tc.effectiveAPR,
      feeRateImpact,
      outstanding: Math.round(state.outstanding),
      interestRemaining: Math.round(state.interestRemaining),
      monthlyInterest,
      emisRemaining: state.emisRemaining,
      totalFees,
      canForeclose,
      foreclosureCharge,
      totalPayoutToday: foreclosureCharge !== null ? Math.round(state.outstanding + foreclosureCharge) : null,
      netSavings,
      efficiencyScore,
      penaltyRecoveryMonths,
      gstOnInterest: loan.gstOnInterest || false,
      totalGSTRemaining: loan.gstOnInterest ? Math.round(state.interestRemaining * 0.18) : 0,
    }
  })

  const active = all.filter(l => l.isActive)
  const settled = all.filter(l => !l.isActive)

  const totalOutstanding = all.reduce((s, l) => s + l.outstanding, 0)
  const totalMonthlyInterest = active.reduce((s, l) => s + l.monthlyInterest, 0)
  const totalInterestRemaining = active.reduce((s, l) => s + l.interestRemaining, 0)

  const closeCandidates = active
    .filter(l => l.canForeclose && l.netSavings !== null && l.netSavings > 0)
    .sort((a, b) => b.efficiencyScore - a.efficiencyScore)

  const bestToClose = closeCandidates[0] || null
  const highestMonthlyInterest = [...active].sort((a, b) => b.monthlyInterest - a.monthlyInterest)[0] || null
  const highestFeeImpact = [...active].sort((a, b) => b.feeRateImpact - a.feeRateImpact)[0] || null

  const rankBlock = closeCandidates.length > 0
    ? closeCandidates.map((l, i) =>
        `${i + 1}. ${l.name} — net savings: ${fmt(l.netSavings)} | monthly interest: ${fmt(l.monthlyInterest)} | closure cost: ${fmt(l.foreclosureCharge)} | recovery: ${l.penaltyRecoveryMonths} months`
      ).join('\n')
    : 'No foreclosure-eligible active loans.'

  const activeBlock = active.map(l => [
    `LOAN: ${l.name}`,
    `- Rate: ${l.statedRate}% stated | ${l.effectiveAPR}% effective APR | Fee impact: +${l.feeRateImpact}% | Fees paid: ${fmt(l.totalFees)}`,
    `- Outstanding: ${fmt(l.outstanding)} | EMIs remaining: ${l.emisRemaining}`,
    `- Monthly interest charge: ${fmt(l.monthlyInterest)}`,
    `- Total interest remaining: ${fmt(l.interestRemaining)}`,
    l.gstOnInterest ? `- GST on interest remaining: ${fmt(l.totalGSTRemaining)}` : null,
    `- Foreclosure: ${l.canForeclose
      ? `Yes — closure cost ${fmt(l.foreclosureCharge)}, payout today ${fmt(l.totalPayoutToday)}, net savings ${fmt(l.netSavings)}, recovery ${l.penaltyRecoveryMonths} months`
      : 'Not allowed'}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  const settledBlock = settled.length > 0
    ? `LOANS WITH NO ACTIVE INTEREST (exclude from all recommendations):\n${settled.map(l => `- ${l.name}: ${fmt(l.outstanding)} remaining, ${l.emisRemaining} EMIs — no interest accruing`).join('\n')}`
    : ''

  return {
    all, active, settled,
    bestToClose, highestMonthlyInterest, highestFeeImpact, closeCandidates,
    totalOutstanding, totalMonthlyInterest, totalInterestRemaining,
    activeBlock, settledBlock, rankBlock, fmt,
  }
}

const SYSTEM_PROMPT = `You are a personal finance advisor for an Indian borrower.

Formatting:
- Use numbered lists or bullet points for multi-item content. No paragraphs for lists.
- One point per line. Max 2 lines per point.
- Bold loan names: **name**. Do not bold full sentences.
- Use ₹ with Indian formatting: ₹1,83,334 or ₹45,678.
- Never use "..." to skip items. Write every item in full.
- Use only the exact ## section headers requested.

Data rules:
- All numbers are pre-calculated. Do NOT recalculate or change any number.
- Never use words like "bleeding", "hurting", or "pain". Use: "interest charge", "monthly cost", "net savings", "closure cost".`

function parseSection(text, header) {
  if (!text) return ''
  const marker = `## ${header}`
  const start = text.indexOf(marker)
  if (start === -1) return ''
  const after = text.indexOf('\n## ', start + marker.length)
  return text.slice(start + marker.length, after === -1 ? text.length : after).trim()
}

function renderInline(text) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold text-gray-800">{part}</strong>
      : part
  )
}

function FormattedContent({ text }) {
  if (!text) return <p className="text-sm text-gray-400 italic">Not available</p>
  return (
    <div className="space-y-1.5">
      {text.split('\n').filter(l => l.trim()).map((line, i) => {
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)[1]
          const content = line.replace(/^\d+\.\s*/, '')
          const bold = content.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)/)
          return (
            <div key={i} className="flex gap-3 py-0.5">
              <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">{num}</span>
              <div className="text-sm text-gray-600 leading-relaxed">
                {bold ? <><span className="font-semibold text-gray-800">{bold[1]}: </span>{bold[2]}</> : renderInline(content)}
              </div>
            </div>
          )
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          const content = line.slice(2)
          const bold = content.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)/)
          return (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-400 mt-2" />
              <p className="text-sm text-gray-600 leading-relaxed">
                {bold ? <><span className="font-semibold text-gray-800">{bold[1]}: </span>{bold[2]}</> : renderInline(content)}
              </p>
            </div>
          )
        }
        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return <p key={i} className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>
        }
        return <p key={i} className="text-sm text-gray-600 leading-relaxed">{renderInline(line)}</p>
      })}
    </div>
  )
}

function InsightCard({ title, icon, iconBg, content }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${iconBg}`}>{icon}</span>
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <FormattedContent text={content || 'No data available'} />
    </div>
  )
}

export default function Insights({ session }) {
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState(null)
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')
  const [compareResult, setCompareResult] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)

  useEffect(() => {
    getLoans(session).then(data => {
      setLoans(data)
      if (data.length >= 2) { setCompareA(data[0].id); setCompareB(data[1].id) }
    })
  }, [])

  async function generateInsights() {
    setLoading(true)
    setInsights(null)
    try {
      const {
        active, settled, bestToClose, highestMonthlyInterest, highestFeeImpact,
        totalOutstanding, totalMonthlyInterest, totalInterestRemaining,
        activeBlock, settledBlock, rankBlock, fmt,
      } = buildAnalysis(loans)

      const userPrompt = `All numbers below are pre-calculated. Copy them exactly — do not recalculate anything.

PORTFOLIO TOTALS:
- Total outstanding: ${fmt(totalOutstanding)}
- Total monthly interest charge: ${fmt(totalMonthlyInterest)}
- Total interest remaining: ${fmt(totalInterestRemaining)}
- Active loans: ${active.length}${settled.length > 0 ? ` | No-interest loans: ${settled.length}` : ''}
${settledBlock ? '\n' + settledBlock + '\n' : ''}
ACTIVE LOAN DATA:
${activeBlock}

RANKED BY NET SAVINGS (closure candidates):
${rankBlock}

KEY FACTS:
- Best closure candidate: ${bestToClose ? `${bestToClose.name} — net savings ${fmt(bestToClose.netSavings)}, closure cost ${fmt(bestToClose.foreclosureCharge)}, recovery ${bestToClose.penaltyRecoveryMonths} months` : 'None eligible'}
- Highest monthly interest: ${highestMonthlyInterest ? `${highestMonthlyInterest.name} at ${fmt(highestMonthlyInterest.monthlyInterest)}/month` : 'N/A'}
- Highest fee impact: ${highestFeeImpact ? `${highestFeeImpact.name} (+${highestFeeImpact.feeRateImpact}% above stated rate)` : 'N/A'}

Write EXACTLY these 5 sections. No extra sections. No "..." shortcuts. Every list must be complete.

## Priority Closure

Copy the ranked list exactly as-is (numbered 1 to N, all entries).

**Recommendation:** State the best loan to close, its monthly interest charge, closure cost, net savings, and recovery period.

**Why this loan:** 3 bullet points:
- Which loan has the highest ongoing monthly interest charge and what that costs per year
- Why effective APR is a better measure than stated rate — use a specific contrast from the data
- Why the chosen loan gives the best net savings relative to its closure cost

## True Cost Analysis

One line per ACTIVE loan. All of them — no skipping.
Format: **[Name]**: stated [statedRate]% → effective [effectiveAPR]% (+[feeRateImpact]% from fees, paid [totalFees])
Mark ⚠️ if feeRateImpact > 0.5%

## Closure Feasibility

One entry per active loan where foreclosure is allowed. All of them — no skipping.
**[Name]**
- Today's payout: [totalPayoutToday]
- Interest saved: [interestRemaining]
- Net savings: [netSavings]
- Recovery period: [penaltyRecoveryMonths] months
- Verdict: Recommended / Consider / Not worthwhile
(Recommended if net savings > ₹50,000 | Consider if ₹10,000–₹50,000 | Not worthwhile if below ₹10,000 or negative)

## Action Plan

Exactly 4 actions. Each must name a specific loan and include a specific ₹ amount.
1. **[Primary closure]** — exact payout amount and net savings (use bestToClose data)
2. **[Reduce top interest charge]** — name the loan, current monthly charge, suggested action
3. **[Fee impact alert]** — name the loan with highest fee impact, what those fees added to cost
4. **[Next target]** — after the primary closure, which loan to address next and why

## Summary

Exactly 3 sentences:
1. Overall debt position using portfolio totals.
2. The single most costly loan right now and the specific reason.
3. The one action to take this month with the exact ₹ amount.`

      const result = await callGroq(SYSTEM_PROMPT, userPrompt, 2500)
      setInsights(result)
    } catch (err) {
      setInsights(`Error: ${err.message}`)
    }
    setLoading(false)
  }

  async function compareLoans() {
    if (!compareA || !compareB || compareA === compareB) return
    setCompareLoading(true)
    setCompareResult(null)
    try {
      const lA = loans.find(l => l.id === compareA)
      const lB = loans.find(l => l.id === compareB)
      const sA = getCurrentLoanState(lA), sB = getCurrentLoanState(lB)
      const tA = calculateTrueCost(lA), tB = calculateTrueCost(lB)
      const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

      const mA = Math.round(sA.outstanding * (lA.annualInterestRate / 100) / 12)
      const mB = Math.round(sB.outstanding * (lB.annualInterestRate / 100) / 12)
      const cA = lA.foreclosure?.allowed ? Math.round(sA.outstanding * (lA.foreclosure.chargePercent || 0) / 100) : 0
      const cB = lB.foreclosure?.allowed ? Math.round(sB.outstanding * (lB.foreclosure.chargePercent || 0) / 100) : 0
      const fA = Math.round((lA.fees?.processingFee || 0) + (lA.fees?.processingFeeGST || 0))
      const fB = Math.round((lB.fees?.processingFee || 0) + (lB.fees?.processingFeeGST || 0))

      const userPrompt = `Compare these two loans. All numbers are pre-calculated — do not change them.

**${lA.nickname}**
- Stated rate: ${lA.annualInterestRate}% | Effective APR: ${tA.effectiveAPR}% | Fee impact: +${(tA.effectiveAPR - lA.annualInterestRate).toFixed(2)}%
- Outstanding: ${fmt(sA.outstanding)} | EMIs remaining: ${sA.emisRemaining}
- Monthly interest: ${fmt(mA)} | Interest remaining: ${fmt(sA.interestRemaining)}
- Fees paid: ${fmt(fA)} | Closure charge: ${fmt(cA)}${lA.gstOnInterest ? ' | GST on interest: Yes' : ''}

**${lB.nickname}**
- Stated rate: ${lB.annualInterestRate}% | Effective APR: ${tB.effectiveAPR}% | Fee impact: +${(tB.effectiveAPR - lB.annualInterestRate).toFixed(2)}%
- Outstanding: ${fmt(sB.outstanding)} | EMIs remaining: ${sB.emisRemaining}
- Monthly interest: ${fmt(mB)} | Interest remaining: ${fmt(sB.interestRemaining)}
- Fees paid: ${fmt(fB)} | Closure charge: ${fmt(cB)}${lB.gstOnInterest ? ' | GST on interest: Yes' : ''}

## Head to Head
Side-by-side bullets: stated rate, effective APR, monthly interest charge, interest remaining, fees paid, closure charge.

## Which Costs More
Which loan has the higher total cost and why. Reference specific numbers. Note GST if applicable.

## Recommendation
One sentence: which to prioritise and the key reason.`

      const result = await callGroq(SYSTEM_PROMPT, userPrompt, 1000)
      setCompareResult(result)
    } catch (err) {
      setCompareResult(`Error: ${err.message}`)
    }
    setCompareLoading(false)
  }

  const sections = insights ? {
    priority: parseSection(insights, 'Priority Closure'),
    truecost: parseSection(insights, 'True Cost Analysis'),
    feasibility: parseSection(insights, 'Closure Feasibility'),
    actions: parseSection(insights, 'Action Plan'),
    summary: parseSection(insights, 'Summary'),
  } : null

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Insights" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">AI Insights</h1>
          <p className="text-sm text-gray-400 mt-0.5">Powered by Groq · Llama 4 Scout</p>
        </div>

        {!insights && !loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center mb-6">
            <p className="text-gray-500 text-sm mb-1">Analyse all {loans.length} loans in your portfolio.</p>
            <p className="text-xs text-gray-400 mb-5">Closure priority · True cost · Feasibility · Action plan</p>
            <button onClick={generateInsights}
              className="px-8 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition">
              Generate Insights →
            </button>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center mb-6">
            <p className="text-sm text-gray-400">Analysing your portfolio…</p>
          </div>
        )}

        {sections && !loading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <InsightCard title="Priority Closure" icon="🎯" iconBg="bg-red-50" content={sections.priority} />
              <InsightCard title="True Cost Analysis" icon="⚠️" iconBg="bg-amber-50" content={sections.truecost} />
              <InsightCard title="Closure Feasibility" icon="📊" iconBg="bg-blue-50" content={sections.feasibility} />
              <InsightCard title="Action Plan" icon="💡" iconBg="bg-green-50" content={sections.actions} />
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📋</span>
                <h3 className="text-sm font-semibold text-gray-700">Summary</h3>
              </div>
              <FormattedContent text={sections.summary} />
            </div>
            <button onClick={generateInsights} className="text-xs text-gray-400 hover:text-gray-600 mb-6 mt-1">
              ↺ Regenerate
            </button>
          </>
        )}

        {loans.length >= 2 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Compare Two Loans</h2>
            <p className="text-xs text-gray-400 mb-4">Side-by-side — which is actually costing you more.</p>
            <div className="flex gap-3 mb-4 flex-wrap">
              <select value={compareA} onChange={e => { setCompareA(e.target.value); setCompareResult(null) }}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                {loans.map(l => <option key={l.id} value={l.id}>{l.nickname}</option>)}
              </select>
              <span className="flex items-center text-gray-400 text-sm font-medium">vs</span>
              <select value={compareB} onChange={e => { setCompareB(e.target.value); setCompareResult(null) }}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                {loans.map(l => <option key={l.id} value={l.id}>{l.nickname}</option>)}
              </select>
              <button onClick={compareLoans} disabled={compareLoading || compareA === compareB}
                className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">
                {compareLoading ? 'Comparing…' : 'Compare →'}
              </button>
            </div>
            {compareA === compareB && <p className="text-xs text-red-400 mb-2">Select two different loans.</p>}
            {compareResult && (
              <div className="border border-gray-100 rounded-xl p-5 bg-gray-50 space-y-4">
                {['Head to Head', 'Which Costs More', 'Recommendation'].map(h => {
                  const content = parseSection(compareResult, h)
                  if (!content) return null
                  return (
                    <div key={h}>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{h}</p>
                      <FormattedContent text={content} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}