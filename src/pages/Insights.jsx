import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getLoans } from '../data/hybridStorage'
import { getCurrentLoanState, calculateTrueCost, rankLoansByPriority, allocateSurplus } from '../math/engine'
import { formatINR, formatPct } from '../utils/format'
import Navbar from '../components/Navbar'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY
const GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct'

async function callGroq(systemPrompt, userPrompt, maxTokens = 1500) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      temperature: 0.3, max_tokens: maxTokens,
    }),
  })
  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.choices[0].message.content
}

function buildLoanContext(loans) {
  return loans.map(loan => {
    const state = getCurrentLoanState(loan)
    const tc = calculateTrueCost(loan)
    const totalFees = (loan.fees?.processingFee || 0) + (loan.fees?.processingFeeGST || 0) + (loan.fees?.insuranceCharges || 0)
    return {
      name: loan.nickname, type: loan.type, lender: loan.lender,
      principal: loan.principal, statedRate: loan.annualInterestRate,
      effectiveAPR: tc.effectiveAPR, emiAmount: loan.emiAmount,
      tenureMonths: loan.tenureMonths, emisPaid: state.emisPaid,
      emisRemaining: state.emisRemaining, outstanding: state.outstanding,
      interestPaid: state.interestPaid, interestRemaining: state.interestRemaining,
      totalFees, totalFeeImpact: tc.rateDiff, totalOutflow: tc.totalAmountPaid,
      foreclosureAllowed: loan.foreclosure?.allowed,
      foreclosureChargePercent: loan.foreclosure?.chargePercent || 0,
      foreclosureChargeFlatAmount: loan.foreclosure?.chargeFlatAmount || 0,
      gstOnInterest: loan.gstOnInterest || false,
      totalGSTOverTenure: loan.gstOnInterest ? state.interestRemaining * 0.18 : 0,
    }
  })
}

const SYSTEM_PROMPT = `You are a personal finance advisor helping an Indian borrower manage and optimize their loans.

Formatting rules — follow strictly:
- Use numbered lists (1. 2. 3.) or bullet points (- ) for multiple items. Never dump everything in one paragraph.
- Each point must be on its own line.
- Bold only the key term or loan name using **bold**, not entire sentences.
- Never write math formulas inline. Instead say "Total payout: ₹1,83,334 (outstanding + 3% charge)".
- Keep each point to 1-2 lines maximum.
- Use ₹ with Indian number formatting (e.g. ₹1,83,334 or ₹45,678).
- Be specific — always reference actual loan names and numbers from the data given.
- Be direct. Short sentences. No walls of text.
- NEVER use "..." to skip or abbreviate any list. Always write every item in full.
- Format sections with the exact ## headers provided. Do not add extra headers.

Loan decision rules:
- NEVER do any math yourself. All numbers are pre-calculated and provided. Use them exactly as given.
- NEVER change or re-derive any number from the input data.
- Your only job is to explain the pre-calculated numbers in clear language.`

function parseSection(text, header) {
  if (!text) return ''
  const marker = `## ${header}`
  const start = text.indexOf(marker)
  if (start === -1) return ''
  const after = text.indexOf('\n## ', start + marker.length)
  return text
    .slice(start + marker.length, after === -1 ? text.length : after)
    .trim()
}

function renderInline(text) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1
      ? <strong key={i} className="font-semibold text-gray-800">{part}</strong>
      : part
  )
}

function FormattedContent({ text }) {
  if (!text) return <p className="text-sm text-gray-400 italic">Not available</p>

  const lines = text.split('\n').filter(l => l.trim())

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)[1]
          const content = line.replace(/^\d+\.\s*/, '')
          const boldMatch = content.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)/)
          return (
            <div key={i} className="flex gap-3 py-1">
              <span className="flex-shrink-0 w-5 h-5 bg-green-100 text-green-700 rounded-full text-xs font-semibold flex items-center justify-center mt-0.5">{num}</span>
              <div className="text-sm text-gray-600 leading-relaxed">
                {boldMatch ? (
                  <>
                    <span className="font-semibold text-gray-800">{boldMatch[1]}: </span>
                    {boldMatch[2]}
                  </>
                ) : renderInline(content)}
              </div>
            </div>
          )
        }

        if (line.startsWith('- ') || line.startsWith('• ')) {
          const content = line.slice(2)
          const boldMatch = content.match(/^\*\*(.+?)\*\*[:：]?\s*(.*)/)
          return (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-green-500 mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" />
              <p className="text-sm text-gray-600 leading-relaxed">
                {boldMatch ? (
                  <>
                    <span className="font-semibold text-gray-800">{boldMatch[1]}: </span>
                    {boldMatch[2]}
                  </>
                ) : renderInline(content)}
              </p>
            </div>
          )
        }

        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>
        }

        return <p key={i} className="text-sm text-gray-600 leading-relaxed">{renderInline(line)}</p>
      })}
    </div>
  )
}

// Pre-compute all numbers in JS so the AI never has to do math
function buildAnalysis(loans) {
  const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

  const loanAnalysis = loans.map(loan => {
    const state = getCurrentLoanState(loan)
    const tc = calculateTrueCost(loan)
    const monthlyInterest = Math.round(state.outstanding * (loan.annualInterestRate / 100) / 12)
    const foreclosureCharge = loan.foreclosure?.allowed
      ? Math.round(state.outstanding * (loan.foreclosure.chargePercent || 0) / 100) + (loan.foreclosure.chargeFlatAmount || 0)
      : null
    const netSavings = foreclosureCharge !== null
      ? Math.round(state.interestRemaining - foreclosureCharge)
      : null
    const penaltyRecoveryMonths = (foreclosureCharge && monthlyInterest > 0)
      ? (foreclosureCharge / monthlyInterest).toFixed(1)
      : null
    const totalFees = Math.round(
      (loan.fees?.processingFee || 0) +
      (loan.fees?.processingFeeGST || 0) +
      (loan.fees?.insuranceCharges || 0)
    )
    const feeRateImpact = Number((tc.effectiveAPR - loan.annualInterestRate).toFixed(2))
    const isActive = state.emisRemaining > 0 && state.interestRemaining > 100

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
      foreclosureAllowed: loan.foreclosure?.allowed || false,
      foreclosureCharge,
      totalPayoutToday: foreclosureCharge !== null
        ? Math.round(state.outstanding + foreclosureCharge)
        : null,
      netSavings,
      penaltyRecoveryMonths,
      gstOnInterest: loan.gstOnInterest || false,
      totalGSTRemaining: loan.gstOnInterest ? Math.round(state.interestRemaining * 0.18) : 0,
    }
  })

  const activeLoans = loanAnalysis.filter(l => l.isActive)
  const settledLoans = loanAnalysis.filter(l => !l.isActive)

  const totalOutstanding = loanAnalysis.reduce((s, l) => s + l.outstanding, 0)
  const totalMonthlyBleeding = activeLoans.reduce((s, l) => s + l.monthlyInterest, 0)
  const totalInterestRemaining = activeLoans.reduce((s, l) => s + l.interestRemaining, 0)

  // Best loan to close = highest net savings among foreclosure-eligible active loans
  const bestToClose = [...activeLoans]
    .filter(l => l.foreclosureAllowed && l.netSavings !== null && l.netSavings > 0)
    .sort((a, b) => b.netSavings - a.netSavings)[0] || null

  // Highest monthly bleeder
  const highestBleeder = [...activeLoans].sort((a, b) => b.monthlyInterest - a.monthlyInterest)[0] || null

  // Highest fee impact
  const highestFeeImpact = [...activeLoans].sort((a, b) => b.feeRateImpact - a.feeRateImpact)[0] || null

  // Ranked by net savings for "close first" section
  const rankedByNetSavings = [...activeLoans]
    .filter(l => l.foreclosureAllowed && l.netSavings !== null)
    .sort((a, b) => b.netSavings - a.netSavings)

  // Build the analysis block string
  const activeBlock = activeLoans.map(l => `
LOAN: ${l.name}
- Stated rate: ${l.statedRate}% | Effective APR: ${l.effectiveAPR}%
- Fee rate impact: +${l.feeRateImpact}% | Fees paid: ${fmt(l.totalFees)}
- Outstanding: ${fmt(l.outstanding)} | EMIs remaining: ${l.emisRemaining}
- Monthly interest bleeding RIGHT NOW: ${fmt(l.monthlyInterest)}
- Total interest remaining (if nothing done): ${fmt(l.interestRemaining)}${l.gstOnInterest ? `\n- GST on interest remaining: ${fmt(l.totalGSTRemaining)}` : ''}
- Foreclosure allowed: ${l.foreclosureAllowed ? 'Yes' : 'No'}${l.foreclosureAllowed ? `
- Foreclosure charge: ${fmt(l.foreclosureCharge)}
- Total payout to close today: ${fmt(l.totalPayoutToday)}
- Net savings if closed now: ${fmt(l.netSavings)}
- Penalty recovery: ${l.penaltyRecoveryMonths} months` : ''}`.trim()
  ).join('\n\n')

  const settledBlock = settledLoans.length > 0
    ? `\nLOANS IN FINAL SETTLEMENT / NO ACTIVE INTEREST (exclude from all analysis):\n${settledLoans.map(l => `- ${l.name}: ${fmt(l.outstanding)} outstanding, ${l.emisRemaining} EMIs left — no interest bleeding, do not recommend closing`).join('\n')}`
    : ''

  const rankBlock = rankedByNetSavings.length > 0
    ? rankedByNetSavings.map((l, i) =>
        `${i + 1}. **${l.name}** — net savings: ${fmt(l.netSavings)} | monthly bleeding: ${fmt(l.monthlyInterest)} | penalty: ${fmt(l.foreclosureCharge)} | recovery: ${l.penaltyRecoveryMonths} months`
      ).join('\n')
    : 'No foreclosure-eligible active loans found.'

  return {
    activeLoans,
    settledLoans,
    bestToClose,
    highestBleeder,
    highestFeeImpact,
    totalOutstanding,
    totalMonthlyBleeding,
    totalInterestRemaining,
    activeBlock,
    settledBlock,
    rankBlock,
    fmt,
  }
}

export default function Insights({ session }) {
  const navigate = useNavigate()
  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(false)
  const [insights, setInsights] = useState(null)
  const [surplusAmount, setSurplusAmount] = useState('')
  const [surplusResult, setSurplusResult] = useState(null)
  const [surplusLoading, setSurplusLoading] = useState(false)
  const [compareA, setCompareA] = useState('')
  const [compareB, setCompareB] = useState('')
  const [compareResult, setCompareResult] = useState(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef(null)

  useEffect(() => {
    async function load() {
      const data = await getLoans(session)
      setLoans(data)
      if (data.length >= 2) {
        setCompareA(data[0].id)
        setCompareB(data[1].id)
      }
    }
    load()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  async function generateInsights() {
    setLoading(true)
    setInsights(null)
    try {
      const {
        activeLoans,
        settledLoans,
        bestToClose,
        highestBleeder,
        highestFeeImpact,
        totalOutstanding,
        totalMonthlyBleeding,
        totalInterestRemaining,
        activeBlock,
        settledBlock,
        rankBlock,
        fmt,
      } = buildAnalysis(loans)

      const userPrompt = `All numbers below are PRE-CALCULATED. DO NOT recalculate, re-derive, or change any number. Copy them exactly. Your only job is to write clear explanations using these numbers.

═══ PORTFOLIO TOTALS ═══
- Total outstanding across all loans: ${fmt(totalOutstanding)}
- Total monthly interest bleeding: ${fmt(totalMonthlyBleeding)}
- Total interest remaining (active loans): ${fmt(totalInterestRemaining)}
- Active loans: ${activeLoans.length} | Settled/no-interest loans: ${settledLoans.length}
${settledBlock}

═══ ACTIVE LOAN DATA (pre-calculated) ═══
${activeBlock}

═══ RANKED BY NET SAVINGS (for close-first section) ═══
${rankBlock}

═══ KEY HIGHLIGHTS ═══
- Best loan to close first: ${bestToClose ? `${bestToClose.name} (net savings: ${fmt(bestToClose.netSavings)}, monthly bleeding: ${fmt(bestToClose.monthlyInterest)}, penalty: ${fmt(bestToClose.foreclosureCharge)}, recovery: ${bestToClose.penaltyRecoveryMonths} months)` : 'None eligible'}
- Highest monthly bleeder: ${highestBleeder ? `${highestBleeder.name} at ${fmt(highestBleeder.monthlyInterest)}/month` : 'N/A'}
- Highest hidden fee impact: ${highestFeeImpact ? `${highestFeeImpact.name} (+${highestFeeImpact.feeRateImpact}% above stated rate)` : 'N/A'}

═══ YOUR OUTPUT ═══
Write EXACTLY these 5 sections. No extra sections. No "..." shortcuts. Complete every list in full.

## Which Loan to Close First

Start with the ranked list (already given above — copy it as-is, numbered 1 to N).
Then write:
**Recommendation:** Name the best loan. State its monthly bleeding, penalty, net savings, and recovery months using the numbers above.
**Plain English Reason:** 3–4 bullet points explaining:
- which loan bleeds the most per month and why that matters
- why interest rate alone is misleading (mention a specific example from the data)
- why the chosen loan gives the best payoff overall

## Hidden Costs Alert

Write one line per ACTIVE loan. Every single one — no skipping, no "...".
Format: **[Loan name]**: stated [statedRate]% → effective [effectiveAPR]% (fees added [feeRateImpact]% | paid ${fmt(0).replace('0','[totalFees]')})
Add ⚠️ if feeRateImpact > 0.5

## Foreclosure Analysis

Write one entry per active loan where foreclosureAllowed = Yes. Every single one — no skipping.
Format per loan:
**[Loan name]**
- Close today for: [totalPayoutToday]
- Interest you'd save: [interestRemaining]
- Net savings: [netSavings]
- Penalty recovery: [penaltyRecoveryMonths] months
- Verdict: Worth it (if netSavings > 0) / Not worth it

## Smart Moves

Exactly 4 moves. Each must use a specific loan name and a specific ₹ amount from the data above.
1. **[Best foreclosure action]** — use bestToClose data. Say exactly how much to pay and what you save.
2. **[Reduce highest bleeder]** — use highestBleeder data. Suggest extra payment and estimate months saved.
3. **[Hidden cost finding]** — use highestFeeImpact data. Explain what the fees actually cost.
4. **[Sequencing tip]** — using the ranked list, explain the order to tackle remaining loans after the first one.

## Portfolio Summary

Exactly 3 sentences:
1. Total debt picture using the portfolio totals above.
2. The single biggest problem loan right now and why.
3. The one action to take this month with exact ₹ amount.`

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
      const loanA = loans.find(l => l.id === compareA)
      const loanB = loans.find(l => l.id === compareB)

      // Pre-compute for compare too
      const stateA = getCurrentLoanState(loanA)
      const stateB = getCurrentLoanState(loanB)
      const tcA = calculateTrueCost(loanA)
      const tcB = calculateTrueCost(loanB)
      const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

      const monthlyA = Math.round(stateA.outstanding * (loanA.annualInterestRate / 100) / 12)
      const monthlyB = Math.round(stateB.outstanding * (loanB.annualInterestRate / 100) / 12)
      const chargeA = loanA.foreclosure?.allowed ? Math.round(stateA.outstanding * (loanA.foreclosure.chargePercent || 0) / 100) : 0
      const chargeB = loanB.foreclosure?.allowed ? Math.round(stateB.outstanding * (loanB.foreclosure.chargePercent || 0) / 100) : 0
      const feesA = Math.round((loanA.fees?.processingFee || 0) + (loanA.fees?.processingFeeGST || 0))
      const feesB = Math.round((loanB.fees?.processingFee || 0) + (loanB.fees?.processingFeeGST || 0))

      const userPrompt = `Compare these two loans. All numbers are pre-calculated. Do NOT change them.

LOAN A — ${loanA.nickname}:
- Stated rate: ${loanA.annualInterestRate}% | Effective APR: ${tcA.effectiveAPR}%
- Outstanding: ${fmt(stateA.outstanding)} | EMIs remaining: ${stateA.emisRemaining}
- Monthly interest NOW: ${fmt(monthlyA)}
- Interest remaining: ${fmt(stateA.interestRemaining)}
- Total fees paid: ${fmt(feesA)} | Fee impact: +${(tcA.effectiveAPR - loanA.annualInterestRate).toFixed(2)}%
- Foreclosure charge: ${fmt(chargeA)}${loanA.gstOnInterest ? ' | GST on interest: Yes' : ''}

LOAN B — ${loanB.nickname}:
- Stated rate: ${loanB.annualInterestRate}% | Effective APR: ${tcB.effectiveAPR}%
- Outstanding: ${fmt(stateB.outstanding)} | EMIs remaining: ${stateB.emisRemaining}
- Monthly interest NOW: ${fmt(monthlyB)}
- Interest remaining: ${fmt(stateB.interestRemaining)}
- Total fees paid: ${fmt(feesB)} | Fee impact: +${(tcB.effectiveAPR - loanB.annualInterestRate).toFixed(2)}%
- Foreclosure charge: ${fmt(chargeB)}${loanB.gstOnInterest ? ' | GST on interest: Yes' : ''}

Write these sections using only the numbers above:

## Head to Head
A side-by-side bullet comparison: rate, effective APR, outstanding, monthly bleeding, interest remaining, fees paid, foreclosure charge.

## Which is Costing You More
Which loan is actually more expensive right now and why. Reference specific numbers. Mention if GST applies to one.

## What to Do
One clear recommendation — which to focus on first and why. One sentence verdict.`

      const result = await callGroq(SYSTEM_PROMPT, userPrompt, 1000)
      setCompareResult(result)
    } catch (err) {
      setCompareResult(`Error: ${err.message}`)
    }
    setCompareLoading(false)
  }

  async function analyzeSurplus() {
    if (!surplusAmount) return
    setSurplusLoading(true)
    setSurplusResult(null)
    try {
      const mathAlloc = allocateSurplus(loans, Number(surplusAmount))
      const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN')

      const allocBlock = mathAlloc.map(a =>
        `- **${a.loan.nickname}**: put ${fmt(a.allocatedAmount)} here → saves ${fmt(a.netSavings)} net (after ${fmt(a.prepaymentCharge || 0)} prepayment charge)`
      ).join('\n')

      const userPrompt = `I have ${fmt(Number(surplusAmount))} extra to put towards my loans.

OPTIMAL ALLOCATION (pre-calculated by the system — do not change these numbers):
${allocBlock}

Using only the numbers above, explain in 4–6 bullet points:
- Where to put the money and in what order
- Why that order (mention effective APR or net savings from above)
- What the total savings will be
- Any important caveat (e.g. prepayment charge, brand new loan penalty)

Be specific, use the loan names and ₹ amounts from above. No generic advice.`

      const result = await callGroq(SYSTEM_PROMPT, userPrompt, 800)
      setSurplusResult({ text: result, alloc: mathAlloc })
    } catch (err) {
      setSurplusResult({ text: `Error: ${err.message}`, alloc: [] })
    }
    setSurplusLoading(false)
  }

  async function sendChat() {
    if (!chatInput.trim()) return
    const userMsg = chatInput.trim()
    setChatInput('')
    setChatMessages(m => [...m, { role: 'user', content: userMsg }])
    setChatLoading(true)
    try {
      // Build pre-computed context for chat too
      const { activeLoans, settledLoans, totalOutstanding, totalMonthlyBleeding, fmt } = buildAnalysis(loans)

      const chatContext = `PRE-CALCULATED LOAN DATA (use these numbers exactly, do not recalculate):
Total outstanding: ${fmt(totalOutstanding)} | Monthly bleeding: ${fmt(totalMonthlyBleeding)}
${settledLoans.length > 0 ? `Settled loans (no interest): ${settledLoans.map(l => l.name).join(', ')}\n` : ''}
Active loans:
${activeLoans.map(l =>
  `- ${l.name}: outstanding ${fmt(l.outstanding)}, monthly interest ${fmt(l.monthlyInterest)}, ` +
  `${l.emisRemaining} EMIs left, effective APR ${l.effectiveAPR}%` +
  (l.foreclosureAllowed ? `, foreclosure penalty ${fmt(l.foreclosureCharge)}, net savings ${fmt(l.netSavings)}` : ', no foreclosure')
).join('\n')}`

      const history = chatMessages.slice(-6)

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            {
              role: 'system',
              content: SYSTEM_PROMPT +
                '\n\nAdditional rules for chat responses:\n' +
                '- Always use bullet points or numbered lists, never one big paragraph.\n' +
                '- Each point on its own line.\n' +
                '- Do NOT do any math. Use only the pre-calculated numbers provided.\n' +
                '- Max 5 bullet points per response. Be concise.\n' +
                '- Never show ## headers in chat responses.\n\n' +
                chatContext
            },
            ...history,
            { role: 'user', content: userMsg },
          ],
          temperature: 0.3, max_tokens: 600,
        }),
      })
      const data = await response.json()
      if (data.error) throw new Error(data.error.message)
      setChatMessages(m => [...m, { role: 'assistant', content: data.choices[0].message.content }])
    } catch (err) {
      setChatMessages(m => [...m, { role: 'assistant', content: `Error: ${err.message}` }])
    }
    setChatLoading(false)
  }

  const sections = insights ? {
    close: parseSection(insights, 'Which Loan to Close First'),
    hidden: parseSection(insights, 'Hidden Costs Alert'),
    foreclosure: parseSection(insights, 'Foreclosure Analysis'),
    moves: parseSection(insights, 'Smart Moves'),
    summary: parseSection(insights, 'Portfolio Summary'),
  } : null

  const compareSection = (text, header) => parseSection(text || '', header)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar session={session} activePage="Insights" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">AI Insights</h1>
          <p className="text-sm text-gray-400 mt-1">Powered by Groq · Llama 4 Scout</p>
        </div>

        {!insights && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center mb-6">
            <p className="text-gray-500 text-sm mb-1">Analyze all {loans.length} loans.</p>
            <p className="text-xs text-gray-400 mb-5">Covers: which to close first, hidden costs, foreclosure analysis, smart moves.</p>
            <button onClick={generateInsights} disabled={loading}
              className="px-8 py-3 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition">
              {loading ? 'Analyzing your portfolio...' : 'Generate Insights →'}
            </button>
          </div>
        )}

        {sections && !loading && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <InsightCard title="Which Loan to Close First" icon="🎯" iconBg="bg-red-50" content={sections.close} />
              <InsightCard title="Hidden Costs Alert" icon="⚠️" iconBg="bg-amber-50" content={sections.hidden} />
              <InsightCard title="Foreclosure Analysis" icon="📊" iconBg="bg-blue-50" content={sections.foreclosure} />
              <InsightCard title="Smart Moves" icon="💡" iconBg="bg-green-50" content={sections.moves} />
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📋</span>
                <h3 className="text-sm font-semibold text-gray-700">Portfolio Summary</h3>
              </div>
              <FormattedContent text={sections.summary} />
            </div>
            <button onClick={generateInsights} className="text-sm text-gray-400 hover:text-gray-600 mb-6">↺ Regenerate</button>
          </>
        )}

        {loans.length >= 2 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Compare Two Loans</h2>
            <p className="text-xs text-gray-400 mb-4">Side by side analysis — which one is actually costing you more.</p>
            <div className="flex gap-3 mb-4 flex-wrap">
              <select value={compareA} onChange={e => { setCompareA(e.target.value); setCompareResult(null) }}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                {loans.map(l => <option key={l.id} value={l.id}>{l.nickname}</option>)}
              </select>
              <div className="flex items-center text-gray-400 text-sm font-medium">vs</div>
              <select value={compareB} onChange={e => { setCompareB(e.target.value); setCompareResult(null) }}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-green-500">
                {loans.map(l => <option key={l.id} value={l.id}>{l.nickname}</option>)}
              </select>
              <button onClick={compareLoans} disabled={compareLoading || compareA === compareB}
                className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">
                {compareLoading ? 'Comparing...' : 'Compare →'}
              </button>
            </div>
            {compareA === compareB && <p className="text-xs text-red-400 mb-2">Select two different loans to compare.</p>}
            {compareResult && (
              <div className="border border-gray-100 rounded-xl p-5 bg-gray-50 space-y-4">
                {['Head to Head', 'Which is Costing You More', 'What to Do'].map(h => {
                  const content = compareSection(compareResult, h)
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

        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Best Use of Surplus</h2>
          <p className="text-xs text-gray-400 mb-4">Got a bonus or extra cash? Find out where to put it.</p>
          <div className="flex gap-3 mb-4">
            <input type="number" value={surplusAmount}
              onChange={e => { setSurplusAmount(e.target.value); setSurplusResult(null) }}
              placeholder="e.g. 100000"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button onClick={analyzeSurplus} disabled={!surplusAmount || surplusLoading}
              className="px-6 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">
              {surplusLoading ? 'Analyzing...' : 'Analyze →'}
            </button>
          </div>
          {surplusResult && (
            <div className="border border-gray-100 rounded-xl p-4 bg-gray-50">
              {surplusResult.alloc.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-4">
                  {surplusResult.alloc.map(a => (
                    <div key={a.loan.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs">
                      <p className="font-medium text-gray-700">{a.loan.nickname}</p>
                      <p className="text-green-600 mt-0.5">{formatINR(a.allocatedAmount)} → saves {formatINR(a.netSavings)}</p>
                    </div>
                  ))}
                </div>
              )}
              <FormattedContent text={surplusResult.text} />
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Ask Anything</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ask about your loans — strategy, savings, comparisons.</p>
          </div>
          {chatMessages.length === 0 && (
            <div className="px-6 py-4 flex flex-wrap gap-2">
              {[
                'Which loan should I close first?',
                'How much will I save if I pay ₹50,000 extra?',
                'Which loan is costing me the most?',
                'Should I foreclose any loan right now?',
                'How much total interest will I pay?',
              ].map(q => (
                <button key={q} onClick={() => setChatInput(q)}
                  className="text-xs px-3 py-1.5 border border-gray-200 rounded-full text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition">{q}</button>
              ))}
            </div>
          )}
          <div className="px-6 py-4 max-h-96 overflow-y-auto space-y-4">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-lg px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-green-600 text-white rounded-br-sm' : 'bg-gray-100 text-gray-700 rounded-bl-sm'}`}>
                  {msg.role === 'user' ? msg.content : <FormattedContent text={msg.content} />}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-400 px-4 py-3 rounded-2xl rounded-bl-sm text-sm">Thinking...</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !chatLoading && sendChat()}
              placeholder="Ask anything about your loans..."
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <button onClick={sendChat} disabled={!chatInput.trim() || chatLoading}
              className="px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-40 transition">Send</button>
          </div>
        </div>
      </div>
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
      <FormattedContent text={content || 'No data returned'} />
    </div>
  )
}