import { useState, useEffect } from 'react'
import { getCards, updateCard } from '../data/financeStorage'
import Navbar from '../components/Navbar'

const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY

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
      const subreddits = 'CreditCardIndia+CreditCardsIndia+IndianCreditCards'
      const redditUrl = `https://www.reddit.com/r/${subreddits}/search.json?q=%22${encodeURIComponent(cardSearch)}%22+credit+card&sort=relevance&t=month&restrict_sr=on&limit=40`
      
      const redditRes = await fetch(redditUrl)
      const redditData = await redditRes.json()
      const children = redditData.data?.children || []

      if (children.length === 0) {
        await updateCard(session, card.id, { 
          market_intel: JSON.stringify({ sections: [{ title: "Card Profile Not Found", points: [`No specific community discussions found for "${cardSearch}" in the last 30 days.`] }] }),
          market_intel_date: new Date().toISOString()
        })
        return loadCards()
      }

      const rawIntel = children.map((child, i) => {
        const p = child.data
        return p.over_18 || p.author === 'AutoModerator' ? null : `[SOURCE ${i+1}] TITLE: ${p.title}\nCONTENT: ${p.selftext.substring(0, 500)}`
      }).filter(Boolean).join('\n\n')

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
          messages: [{
            role: 'system',
            content: `You are an Expert Investigative Financial Journalist. Report ONLY on "${cardSearch}". If data doesn't mention "${cardSearch}", return: {"sections": [{"title": "No Card Relevance", "points": ["No specific data for ${cardSearch} found."]}]}. 10-14 day focus. Verbose points. JSON ONLY.`
          }, { role: 'user', content: `DATA:\n${rawIntel}` }],
          temperature: 0.1, max_tokens: 2000
        })
      })

      const groqData = await groqRes.json()
      if (groqData.error) throw new Error(groqData.error.message)
      
      await updateCard(session, card.id, { market_intel: groqData.choices[0].message.content, market_intel_date: new Date().toISOString() })
      loadCards()
    } catch (error) {
      setSyncError(`Sync Failed: ${error.message}`)
    } finally {
      setLoading(prev => ({ ...prev, [card.id]: false }))
    }
  }

  const refreshAll = async () => {
    if (globalLoading) return
    setGlobalLoading(true)
    for (const card of cards) {
      await fetchIntelForCard(card)
      await new Promise(r => setTimeout(r, 2000))
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
            <p className="text-[10px] font-bold text-green-600 uppercase tracking-widest mt-2">Powered by Groq · Llama 4 Scout</p>
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
