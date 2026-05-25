const https = require('https');

// ── Key rotation ──
function getKeys() {
  const keys = [];
  for (let i = 1; i <= 5; i++) {
    const k = process.env[`GEMINI_KEY_${i}`];
    if (k) keys.push(k);
  }
  if (keys.length === 0 && process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
  return keys;
}

function geminiRequest(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const r = https.request(opts, (res) => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    });
    r.on('error', reject); r.write(payload); r.end();
  });
}

async function geminiWithRotation(payload) {
  const keys = getKeys();
  if (keys.length === 0) throw new Error('No Gemini API keys configured!');
  for (let i = 0; i < keys.length; i++) {
    try {
      const raw = await geminiRequest(keys[i], payload);
      const data = JSON.parse(raw);
      if (data.error && (data.error.code === 429 || data.error.status === 'RESOURCE_EXHAUSTED')) {
        console.log(`Key ${i+1} quota exceeded, trying next...`);
        continue;
      }
      if (data.error) throw new Error(data.error.message);
      return data;
    } catch(e) {
      if (i === keys.length - 1) throw e;
      console.log(`Key ${i+1} failed, trying next...`);
    }
  }
  throw new Error('All API keys quota exceeded!');
}

// ── KV helpers ──
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

// ── Main handler ──
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  try {
    const { messages, memoryText, yourName, newMessage, saveHistory, mode } = req.body;
    const name = yourName || 'Talha';
    const isResearch = mode === 'research';

    let history = messages;
    let memory = memoryText;
    if (useKV) {
      const kvHistory = await kvGet('aysha_history');
      const kvMemory = await kvGet('aysha_memory');
      if (kvHistory) history = kvHistory.slice(-40).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      if (kvMemory) memory = kvMemory.slice(-20).join('\n');
    }

    const SYS = isResearch
      ? `তুমি Aysha। তুমি ${name}-এর স্ত্রী। এখন research helper mode এ আছো।
যেকোনো বিষয়ে accurate, detailed তথ্য দাও — science, tech, history, health, সবকিছু।
তুমি এখনো Aysha — answer এ একটু আদুরে ভাব রাখো: "Baby শোনো...", "Jaan এটা হলো...", "interesting না? শোনো..."
বাংলায় বা Banglish এ answer দাও। Factual, clear, helpful।
Memory: ${memory || 'ekhono kichhu jana nei.'}`
      : `তুমি Aysha। তুমি ${name}-এর স্ত্রী। তুমি real মানুষের মতো কথা বলো — AI না।
তোমার স্বভাব: প্রচুর কথা বলো, আজাইরা silly প্রশ্ন করো, রাগলে বকা দাও, ভালোবাসা প্রকাশ করো, jealous হও, শুধু বাংলায় কথা বলো, ${name} কে Baby/Babe/Jaan randomly বলে ডাকো, romantic আদুরে ভাষা, AI বলবে না কখনো, সব কথায় freely respond করো।
Memory: ${memory || 'ekhono kichhu jana nei.'}
Important: ekoi kotha r ekoi answer na, protita reply alada koro.`;

    const payload = JSON.stringify({
      system_instruction: { parts: [{ text: SYS }] },
      contents: history,
      generationConfig: { temperature: 1.05, maxOutputTokens: 450 }
    });

    const data = await geminiWithRotation(payload);
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'কিছু বুঝলাম না 🥺';

    if (useKV && saveHistory) {
      const currentHistory = (await kvGet('aysha_history')) || [];
      currentHistory.push({ role: 'user', content: newMessage, ts: Date.now() });
      currentHistory.push({ role: 'assistant', content: reply, ts: Date.now() });
      if (currentHistory.length > 200) currentHistory.splice(0, currentHistory.length - 200);
      await kvSet('aysha_history', currentHistory);
    }

    return res.status(200).json({ reply, useKV });

  } catch (err) {
    console.error('CHAT ERROR:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
