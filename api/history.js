const https = require('https');

function kvRequest(method, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.KV_REST_API_URL + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({}); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function kvGet(key) {
  const res = await kvRequest('GET', `/get/${key}`);
  return res.result ? JSON.parse(res.result) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({});

  const useKV = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!useKV) return res.status(200).json({ history: [], memory: [] });

  try {
    const [history, memory] = await Promise.all([
      kvGet('aysha_history'),
      kvGet('aysha_memory')
    ]);
    return res.status(200).json({ history: history || [], memory: memory || [] });
  } catch (err) {
    return res.status(200).json({ history: [], memory: [] });
  }
};
