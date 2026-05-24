const https = require('https');

function kvRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.KV_REST_API_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function kvGet(key) {
  const res = await kvRequest('GET', `/get/${key}`);
  return res.result ? JSON.parse(res.result) : null;
}
async function kvSet(key, value) {
  await kvRequest('POST', `/set/${key}`, { value: JSON.stringify(value) });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ facts: [] });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(200).json({ facts: [] });

  const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  try {
    const { userMsg, aiReply, yourName } = req.body;
    const name = yourName || 'Talha';

    const prompt = `Conversation theke ${name} somporke notun tottho thakle JSON array dao: ["tottho 1"]. Na thakle: []. Shudhu JSON.\n\nUser: ${userMsg}\nAysha: ${aiReply}`;
    const payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
    });

    const apiRes = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const r = https.request(opts, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
      });
      r.on('error', reject); r.write(payload); r.end();
    });

    const data = JSON.parse(apiRes);
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const facts = JSON.parse(raw.replace(/```json|```/g, '').trim());
    const newFacts = Array.isArray(facts) ? facts : [];

    // Save to KV
    if (useKV && newFacts.length > 0) {
      const existing = (await kvGet('aysha_memory')) || [];
      newFacts.forEach(f => { if (f && !existing.includes(f) && existing.length < 50) existing.push(f); });
      await kvSet('aysha_memory', existing);
    }

    return res.status(200).json({ facts: newFacts });

  } catch (err) {
    return res.status(200).json({ facts: [] });
  }
};
