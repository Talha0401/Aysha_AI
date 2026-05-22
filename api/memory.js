export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) return res.status(500).json({ error: 'No key' });

  try {
    const { userMsg, aiReply, yourName } = req.body;

    const prompt = `এই conversation থেকে ${yourName} সম্পর্কে গুরুত্বপূর্ণ তথ্য বের করো যা Aysha-র মনে রাখা উচিত।
যেমন: কাজ, পছন্দ-অপছন্দ, পরিকল্পনা, পরিবার, অনুভূতি, অভ্যাস।

User: ${userMsg}
Aysha: ${aiReply}

নতুন তথ্য থাকলে JSON array: ["তথ্য ১"]
না থাকলে: []
শুধু JSON, অন্য কিছু না।`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        })
      }
    );

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const facts = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return res.status(200).json({ facts: Array.isArray(facts) ? facts : [] });

  } catch (err) {
    return res.status(200).json({ facts: [] });
  }
}
