// api/market-intel.js
// Vercel Serverless Function - Public JSON Mode (No Reddit Keys Required)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { card } = req.query;
  if (!card) return res.status(400).json({ error: 'Card name is required' });

  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return res.status(500).json({ error: 'Groq API Key is missing in Vercel environment variables' });

  try {
    // 1. Search Reddit via public .json endpoint (No OAuth needed)
    // We target the 3 subreddits you mentioned
    const subreddits = 'CreditCardIndia+CreditCardsIndia+IndianCreditCards';
    const redditUrl = `https://www.reddit.com/r/${subreddits}/search.json?q=${encodeURIComponent(card)}&sort=new&t=week&restrict_sr=on&limit=15`;
    
    const redditResponse = await fetch(redditUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });

    if (!redditResponse.ok) throw new Error(`Reddit Public API responded with ${redditResponse.status}`);

    const redditData = await redditResponse.json();
    const children = redditData.data?.children || [];

    if (children.length === 0) {
      return res.status(200).json({ summary: "No major community discussions found for this card in the last 7 days." });
    }

    // 2. Extract and Filter (Removing noise)
    const rawIntel = children.map((child, i) => {
      const p = child.data;
      // Skip posts with no content or automod posts
      if (p.over_18 || p.author === 'AutoModerator') return null;
      return `[POST ${i+1}] ${p.title}\n${p.selftext.substring(0, 400)}`;
    }).filter(Boolean).join('\n\n---\n\n');

    // 3. Send to Groq for Broad Intelligence
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3-70b-8192',
        messages: [
          {
            role: 'system',
            content: `You are a Senior Financial Intelligence Analyst. Analyze recent Reddit posts about "${card}".
            
            GOAL: Provide a "Broad Intelligence Report" for the last 7-10 days.
            Include:
            - Any devaluations, fee hikes, or reward cap changes.
            - Active promotional offers or hidden benefits.
            - General community sentiment and advice.
            
            RULES:
            - Use professional, clean bullet points.
            - Start with a status: "STABLE", "DEVALUATION ALERT", or "ACTIVE OFFERS".
            - Be specific. Use "₹" and actual numbers from the data.
            - Keep the summary broad but concise.`
          },
          {
            role: 'user',
            content: `RAW REDDIT DATA:\n\n${rawIntel}`
          }
        ],
        temperature: 0.1,
        max_tokens: 800
      })
    });

    const groqData = await groqResponse.json();
    const summary = groqData.choices[0].message.content;

    return res.status(200).json({ summary });

  } catch (error) {
    console.error('Market Intel Error:', error);
    return res.status(500).json({ error: 'Intelligence Engine failed: ' + error.message });
  }
}
