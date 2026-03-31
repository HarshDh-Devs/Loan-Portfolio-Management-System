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
- Never write math formulas inline like "₹177,994 + ₹5,339 = ₹183,334". Instead say "Total payout: ₹1,83,334 (outstanding + 3% charge)".
- Keep each point to 1-2 lines maximum.
- Use ₹ with Indian number formatting (lakhs: ₹1.77L, crores: ₹1.2Cr).
- Be specific — always reference actual loan names and numbers.
- Be direct. Short sentences. No walls of text.
- Format sections clearly with the exact headers provided.

Loan decision rules — follow strictly:
- NEVER rely on interest rate alone.
- Always compare loans using pain vs benefit framework.
- Calculate monthly interest running right now for each loan.
- Calculate foreclosure penalty and compare it to interest saved.
- Calculate net benefit = interest remaining saved − foreclosure charge.
- Calculate penalty recovery time = foreclosure / monthly interest.
- A loan with lower interest rate can still be worse if principal is larger.
- A brand new loan (0–3 EMIs) is inefficient to close because penalty applies on full principal.
- Prefer closing the loan where:
  - monthly interest bleeding is higher
  - penalty is recovered faster
  - net benefit is higher

Always include a **Plain English Reason** section explaining:
- which loan is costing more per month
- why higher rate may not mean worse loan
- which penalty hurts more
- why the chosen loan gives better overall benefit.
`

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
        // Numbered list: 1. something
        if (/^\d+\.\s/.test(line)) {
          const num = line.match(/^(\d+)\./)[1]
          const content = line.replace(/^\d+\.\s*/, '')
          // Check if it has a bold title like **Title**: rest
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

        // Bullet: - or •
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

        // Standalone bold line = section heading
        if (line.startsWith('**') && line.endsWith('**')) {
          return <p key={i} className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>
        }

        // Regular paragraph
        return <p key={i} className="text-sm text-gray-600 leading-relaxed">{renderInline(line)}</p>
      })}
    </div>
  )
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
      const context = buildLoanContext(loans)
      const ranked = rankLoansByPriority(loans)
      const userPrompt = `Here is my loan portfolio data:
${JSON.stringify(context, null, 2)}

Priority ranking by effective APR:
${ranked.map(r => {
  const state = getCurrentLoanState(r.loan)
  const monthlyInterest = Math.round(state.outstanding * (r.loan.annualInterestRate / 100) / 12)
  return `${r.rank}. ${r.loan.nickname} — Effective APR: ${r.effectiveAPR}% | Outstanding: ₹${Math.round(state.outstanding).toLocaleString('en-IN')} | Monthly interest NOW: ₹${monthlyInterest.toLocaleString('en-IN')} | Interest remaining: ₹${Math.round(state.interestRemaining).toLocaleString('en-IN')} | EMIs remaining: ${state.emisRemaining} | Foreclosure charge: ${r.loan.foreclosure?.chargePercent || 0}%`
}).join('\n')}

CRITICAL RULE — Monthly interest must ALWAYS be calculated as:
  monthly_interest = outstanding × (annual_rate / 100) / 12
  NEVER divide interest_remaining by months_remaining. That gives wrong numbers.

CRITICAL RULE — Skip any loan where:
  - emisRemaining <= 0 (loan is fully repaid or in final settlement)
  - interestRemaining <= 0 (no interest left to save)
  - outstanding is being settled as a lump sum with no further EMIs
  These loans have NO interest bleeding. Do not recommend closing them. Mention briefly that they are already being settled.

Please provide analysis with EXACTLY these section headers:

## Which Loan to Close First

**Step 1 — Active loans only**
List only loans that still have active EMIs and interest running. Skip any loan already in settlement or with 0 EMIs left.

**Step 2 — For each active loan, calculate:**
- Monthly interest bleeding: outstanding × rate / 12
- Foreclosure penalty: outstanding × chargePercent / 100
- Interest remaining (total future interest if you do nothing)
- Net benefit of closing now: interestRemaining − foreclosurePenalty
- Penalty recovery time: foreclosurePenalty / monthlyInterest (months)

**Step 3 — Rank by net benefit (highest first)**
Show a clean numbered list.

**Step 4 — Final recommendation**
Name the single best loan to close first. State:
- How much monthly interest it is bleeding RIGHT NOW
- What it costs to close (foreclosure penalty)
- What you save (net benefit)
- How many months to recover the penalty

**Step 5 — Plain English Reason**
2–4 bullet points. Explain:
- Which loan bleeds the most cash per month
- Why a higher rate doesn't always mean worse (if principal is small)
- Which penalty hurts more relative to savings
- Why the chosen loan gives the best overall payoff

## Hidden Costs Alert

For each loan, one line:
- Loan name: stated rate X% → effective APR Y% (fees added Z% to cost). Flag if fees pushed rate more than 0.5% higher.

## Foreclosure Analysis

For each loan where foreclosure is allowed:
- Total payout today = outstanding + foreclosure charge
- Interest saved by closing now
- Net savings = interest saved − foreclosure charge
- Verdict: Worth it / Not worth it (one line)

## Smart Moves

Give exactly 4 actionable moves. Each move:
- Title in bold
- 1–2 lines of specific advice with actual ₹ numbers
- Must be about THIS person's loans, not generic advice

## Portfolio Summary

3 sentences max. Cover:
- Total outstanding debt across all loans
- Which loan is the most expensive problem right now
- One key thing they should do this month`

      const result = await callGroq(SYSTEM_PROMPT, userPrompt, 2000)
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
      const ctxA = buildLoanContext([loanA])[0]
      const ctxB = buildLoanContext([loanB])[0]
      const userPrompt = `Compare these two loans side by side:

LOAN A — ${ctxA.name}:
${JSON.stringify(ctxA, null, 2)}

LOAN B — ${ctxB.name}:
${JSON.stringify(ctxB, null, 2)}

Give a clear comparison covering:
## Head to Head
A quick table-style comparison of: stated rate, effective APR, outstanding, interest remaining, total fees paid, foreclosure charge.

## Which is Costing You More
Which loan is actually more expensive and why. Factor in all costs — rate, fees, GST if applicable.

## What to Do
One clear recommendation — which one to focus on paying off first and why.`

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
      const context = buildLoanContext(loans)
      const mathAlloc = allocateSurplus(loans, Number(surplusAmount))
      const userPrompt = `I have ₹${Number(surplusAmount).toLocaleString('en-IN')} extra money to put towards my loans.

My loans:
${JSON.stringify(context, null, 2)}

Optimal allocation by effective APR:
${mathAlloc.map(a => `- ${a.loan.nickname}: put ₹${Math.round(a.allocatedAmount).toLocaleString('en-IN')} here → saves ₹${Math.round(a.netSavings).toLocaleString('en-IN')} net (after ₹${Math.round(a.prepaymentCharge || 0).toLocaleString('en-IN')} charge)`).join('\n')}

Explain in simple language: where should I put this money, why that order, what I actually save, and any important caveats. Keep it short and practical.`

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
      const context = buildLoanContext(loans)
      const history = chatMessages.slice(-6)
      const contextPrompt = `User's loan portfolio:
${JSON.stringify(context, null, 2)}
Answer concisely using only this data. Use plain language and ₹ amounts.`

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + '\n\nAdditional rules for chat responses:\n- Always use bullet points or numbered lists, never one big paragraph.\n- Each point on its own line.\n- No inline math formulas. Say "Total payout: ₹1.83L" not "₹1,77,994 + ₹5,339 = ₹1,83,334".\n- Max 4-5 lines per response. Be concise.\n- Never show ## headers in chat responses.\n\n' + contextPrompt },
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
              {['Which loan should I close first?', 'How much will I save if I pay ₹50,000 extra?', 'Which loan is costing me the most?', 'Should I foreclose any loan right now?', 'How much total interest will I pay?'].map(q => (
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
      <FormattedContent text={content || "No data returned"} />
    </div>
  )
}