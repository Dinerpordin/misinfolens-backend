import { NextResponse } from 'next/server';

export async function POST(req) {
  const { type, content, tier } = await req.json();
  const licenseKey = req.headers.get('x-license-key');

  const isPro = tier === 'pro' && licenseKey?.startsWith('pro-');
  
  let apiKey, model, baseUrl;
  if (isPro) {
    apiKey = process.env.XAI_API_KEY;
    model = "grok-4.20-beta-0309-reasoning";
    baseUrl = "https://api.x.ai/v1";
  } else {
    apiKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY_2 || process.env.OPENROUTER_API_KEY;
    model = "llama-3.3-70b-versatile";
    baseUrl = process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "https://api.groq.com/openai/v1";
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://misinfolens.vercel.app',
        'X-Title': 'MisinfoLens'
      },
      body: JSON.stringify({
        model: isPro ? model : (process.env.OPENROUTER_API_KEY ? "groq/llama-3.3-70b-versatile" : model),
        messages: [
          { role: "system", content: "You are a professional fact-checker. Analyze the provided content for misinformation. Output ONLY a valid JSON object with these keys: score (integer 0-100), verdict (string: REAL, MOSTLY REAL, SUSPICIOUS, or FAKE), claims (array of objects with 'text', 'status', and 'evidence'), flags (array of strings), and emoji (string)." },
          { role: "user", content: `Analyze this ${type} for truthfulness: ${content}` }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: "Analysis failed", details: error.message }, { status: 500 });
  }
}
