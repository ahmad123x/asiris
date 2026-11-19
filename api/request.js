// Vercel Serverless Function  ->  POST /api/request
// Sends the "Start a project" form straight to Telegram.
// Secrets live ONLY in Vercel Environment Variables:
//   TELEGRAM_BOT_TOKEN  (from @BotFather)
//   TELEGRAM_CHAT_ID    (your chat or group id)

const MAX = { name: 100, service: 80, budget: 80, timeline: 80, description: 1500 };
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PER_WINDOW = 3;         // requests per visitor per window (per server instance)
const MIN_FILL_MS = 3000;         // forms sent faster than this are bots

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  a.push(now);
  hits.set(ip, a);
  if (hits.size > 5000) hits.clear();
  return a.length > MAX_PER_WINDOW;
}
function clean(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(500).json({ error: 'config' });

  // same-site requests only
  const origin = req.headers.origin;
  try {
    if (!origin || new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'origin' });
  } catch (e) {
    return res.status(403).json({ error: 'origin' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'body' });

  // anti-spam: hidden field filled in = bot (pretend success, send nothing)
  if (clean(body.hp, 50)) return res.status(200).json({ ok: true });
  if (!(Number(body.elapsed) >= MIN_FILL_MS)) return res.status(400).json({ error: 'fast' });

  const f = {
    name: clean(body.name, MAX.name),
    service: clean(body.service, MAX.service),
    budget: clean(body.budget, MAX.budget),
    timeline: clean(body.timeline, MAX.timeline),
    description: clean(body.description, MAX.description),
  };
  if (!f.name || !f.description) return res.status(400).json({ error: 'fields' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'rate' });

  const when = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Baghdad', hour12: false });
  const text = [
    '📩 طلب مشروع جديد — ASIRIS',
    '',
    '👤 الاسم: ' + f.name,
    '🛠 الخدمة: ' + (f.service || '-'),
    '💰 الميزانية: ' + (f.budget || '-'),
    '⏱ الموعد: ' + (f.timeline || '-'),
    '',
    '📝 الوصف:',
    f.description,
    '',
    '🌐 لغة الموقع: ' + (body.lang === 'en' ? 'English' : 'العربية'),
    '🕒 ' + when + ' (بغداد)',
  ].join('\n');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      console.error('telegram error', r.status, j && j.error_code);
      return res.status(502).json({ error: 'upstream' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('request error', e && e.name);
    return res.status(502).json({ error: 'upstream' });
  } finally {
    clearTimeout(timer);
  }
};
