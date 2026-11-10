import { useState, useEffect } from 'react'
import { getCards, updateCard } from '../data/financeStorage'
import Navbar from '../components/Navbar'
import { askAI } from '../lib/ai'

const INTEL_MAX_CHARS = 9000

const INTEL_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'points'],
        additionalProperties: false,
      },
    },
  },
  required: ['sections'],
  additionalProperties: false,
}

function IntelligenceDisplay({ content }) {
  if (!content) return null;
  
  let sections = [];
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) sections = JSON.parse(jsonMatch[0]).sections || [];
    else return <div className="text-sm text-slate-400 italic">Processing intelligence feed...</div>;
  } catch (e) {
    return <div className="text-sm text-slate-400 italic">Formatting bulletin...</div>;
  }

  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm animate-in fade-in duration-500">
      <div className="space-y-5 divide-y divide-gray-50">
        {sections.map((section, idx) => (
          <div key={idx} className={idx > 0 ? "pt-5" : ""}>
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <span className="w-1 h-1 bg-green-500 rounded-full" />
              {section.title}
            </h4>
            <ul className="space-y-1.5">
              {(section.points || []).map((point, pIdx) => (
                <li key={pIdx} className="text-sm text-slate-600 leading-relaxed pl-3 border-l border-slate-100">{point}</li>
              ))}
            </ul>
          </div>
        ))}
        {sections.length === 0 && <p className="text-sm text-slate-400 italic text-center py-6">No community developments found recently.</p>}
      </div>
    </div>
  );
}

export default function CardIntelligence({ session }) {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState({})
  const [globalLoading, setGlobalLoading] = useState(false)
  const [syncError, setSyncError] = useState(null)

  useEffect(() => { loadCards() }, [])
  const loadCards = async () => setCards(await getCards(session))

  const fetchIntelForCard = async (card) => {
    if (loading[card.id]) return
    setLoading(prev => ({ ...prev, [card.id]: true }))
    setSyncError(null)
    
    try {
      const cardSearch = card.card_name || card.nickname

      // Posts and news are collected on the server (browsers are blocked by Reddit).
      let sources
      try {
        const res = await fetch(`/api/card-sources?card=${encodeURIComponent(cardSearch)}`)
        sources = await res.json()
        if (!res.ok) throw new Error(sources?.error || `server answered ${res.status}`)
      } catch (err) {
        throw new Error(`couldn't collect posts and news (${err.message})`)
      }
      const items = sources.items || []

      if (items.length === 0) {
        const why = sources.errors?.length ? ` (sources unavailable: ${sources.errors.join('; ')})` : ''
        await updateCard(session, card.id, {
          market_intel: JSON.stringify({ sections: [{ title: 'Nothing new', points: [`No posts or news about "${cardSearch}" in the last 30 days${why}.`] }] }),
          market_intel_date: new Date().toISOString()
        })
        return loadCards()
      }

      // Keep the request within Groq's free per-request size.
      let rawIntel = ''
      items.forEach((it, i) => {
        const when = it.date ? new Date(it.date).toISOString().slice(0, 10) : 'unknown date'
        const entry = `[${i + 1}] ${it.source} · ${when}
TITLE: ${it.title}
${it.text ? `TEXT: ${it.text}
` : ''}
`
        if (rawIntel.length + entry.length <= INTEL_MAX_CHARS) rawIntel += entry
      })

      const report = await askAI({
        task: 'card-intel',
        schema: INTEL_SCHEMA,
        schemaName: 'card_intel',
        messages: [{
          role: 'system',
          content: `You summarise recent Reddit posts and news about the Indian credit card "${cardSearch}" for its owner, in plain, friendly English.
Use only the data given. Ignore items that are about a different card. Prefer the newest items and say roughly when (e.g. "early November").
Sections, in this order, only if there is something to say: "Changes to know" (devaluations, fee or reward changes, new caps), "Offers & benefits", "What people are saying", "Tip" (one practical suggestion).
Each point is one or two short sentences with real numbers (₹, %) from the data. No hype, no guesses.
If nothing in the data is about "${cardSearch}", return one section titled "Nothing new" with the point "No recent posts or news specifically about ${cardSearch}.". Reply in JSON.`
        }, { role: 'user', content: `DATA:
${rawIntel}` }],
      })

      await updateCard(session, card.id, { market_intel: JSON.stringify(report), market_intel_date: new Date().toISOString() })
      loadCards()
    } catch (error) {
      setSyncError(`Couldn't update ${card.nickname}: ${error.message}`)
    } finally {
      setLoading(prev => ({ ...prev, [card.id]: false }))
    }
  }

  const refreshAll = async () => {
    if (globalLoading) return
    setGlobalLoading(true)
    for (const card of cards) {
      await fetchIntelForCard(card)
      await new Promise(r => setTimeout(r, 1000))
    }
    setGlobalLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar session={session} activePage="Card Insights" />
      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 border-b border-gray-100 pb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Credit Card Insights</h1>
            <p className="text-sm text-gray-400 mt-0.5">Latest happenings and intelligence from top Reddit communities</p>
            <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mt-2">Powered by Groq · GPT-OSS</p>
          </div>
          <button onClick={refreshAll} disabled={globalLoading || cards.length === 0} className="px-5 py-2 bg-green-600 text-white text-xs font-semibold rounded-lg hover:bg-green-700 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm">
            {globalLoading ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '↺'} 
            {globalLoading ? 'Refreshing Portfolio...' : 'Refresh All Insights'}
          </button>
        </div>

        {syncError && <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3"><span className="text-red-500 text-lg">⚠️</span><p className="text-sm text-red-600 font-medium">{syncError}</p></div>}

        <div className="grid grid-cols-1 gap-6">
          {cards.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-400 italic">No credit cards found. Add them to your Dashboard to see insights.</div>
          ) : cards.map(card => (
            <div key={card.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-900">{card.nickname}</span>
                  <span className="text-[10px] font-bold text-green-600 uppercase tracking-widest mt-0.5">{card.card_name || 'Card Profile'}</span>
                </div>
                <div className="flex items-center gap-6">
                  {card.market_intel_date && <span className="text-[10px] font-medium text-gray-400">Sync: {new Date(card.market_intel_date).toLocaleDateString()}</span>}
                  <button onClick={() => fetchIntelForCard(card)} disabled={loading[card.id] || globalLoading} className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${loading[card.id] ? 'text-gray-400' : 'text-green-600 hover:text-green-700'}`}>
                    {loading[card.id] ? 'Analyzing...' : 'Sync Intel'}
                  </button>
                </div>
              </div>
              <div className="p-6 bg-slate-50/30">
                {loading[card.id] ? (
                  <div className="py-8 flex flex-col items-center justify-center space-y-3">
                    <div className="flex gap-1">
                      {[0, 150, 300].map(delay => <div key={delay} className="w-1.5 h-1.5 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}
                    </div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">Gathering Community Intelligence</p>
                  </div>
                ) : card.market_intel ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Community Intelligence Report</span>
                    </div>
                    <IntelligenceDisplay content={card.market_intel} />
                  </div>
                ) : (
                  <div className="py-10 text-center">
                    <p className="text-xs text-slate-400 italic mb-5">No active intelligence found for this card.</p>
                    <button onClick={() => fetchIntelForCard(card)} className="px-5 py-2 border border-green-100 text-green-600 text-[10px] font-bold rounded-lg hover:bg-green-50 uppercase tracking-widest transition-all">Start Analysis</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
