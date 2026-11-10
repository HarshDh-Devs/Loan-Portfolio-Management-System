// api/card-sources.js
// Collects recent public posts and news about a credit card, on the server.
// Browsers can't read Reddit directly any more (it blocks them, which showed
// up as "Failed to fetch"), so this runs here and returns plain text items.
//
//   GET /api/card-sources?card=HDFC%20Millennia
//   → { items: [{ source, title, text, date, link }], errors: [...] }

const UA = 'web:smart-finance-loans:1.0 (personal finance dashboard)'
const SUBREDDITS = 'CreditCardsIndia+CreditCardIndia+IndianCreditCards'
const TIMEOUT_MS = 8000

export const config = { maxDuration: 20 }

function decodeEntities(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

function cleanText(s) {
  // Reddit escapes the HTML twice in feeds.
  const once = decodeEntities(s)
  const twice = decodeEntities(once)
  return twice
    .replace(/<[^>]+>/g, ' ')
    .replace(/submitted by\s+\/u\/\S+.*$/i, '')
    .replace(/\[link\]|\[comments\]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? m[1] : ''
}

async function fetchText(url) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/rss+xml, text/xml;q=0.9, */*;q=0.5' }, signal: controller.signal })
    if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

async function redditPosts(card) {
  const url = `https://www.reddit.com/r/${SUBREDDITS}/search.rss?q=${encodeURIComponent(`"${card}"`)}&restrict_sr=on&sort=relevance&t=month&limit=25`
  const xml = await fetchText(url)
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    source: 'Reddit',
    title: cleanText(tag(e, 'title')),
    text: cleanText(tag(e, 'content')).slice(0, 600),
    date: tag(e, 'updated') || tag(e, 'published'),
    link: (e.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
  })).filter(p => p.title)
}

async function newsItems(card) {
  const q = `"${card}" credit card when:30d`
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-IN&gl=IN&ceid=IN:en`
  const xml = await fetchText(url)
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map(([, it]) => ({
    source: cleanText(tag(it, 'source')) || 'News',
    title: cleanText(tag(it, 'title')),
    text: cleanText(tag(it, 'description')).slice(0, 300),
    date: tag(it, 'pubDate'),
    link: cleanText(tag(it, 'link')),
  })).filter(n => n.title)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const card = String(req.query?.card || '').trim().slice(0, 80)
  if (!card) return res.status(400).json({ error: 'Card name is required' })

  const [reddit, news] = await Promise.allSettled([redditPosts(card), newsItems(card)])
  const items = [
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
    ...(news.status === 'fulfilled' ? news.value : []),
  ]
  const errors = [reddit, news].filter(r => r.status === 'rejected').map(r => r.reason?.message || 'source unavailable')

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600')
  return res.status(200).json({ items, errors })
}
