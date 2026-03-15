import { NextResponse } from 'next/server';

const FREE_SYSTEM_PROMPT = `You are MisinfoLens, an expert fact-checking analyst. Analyze the provided content thoroughly and return ONLY a valid JSON object with this exact structure:
{
  "score": <integer 0-100, truth score>,
  "verdict": <"REAL" | "MOSTLY REAL" | "MIXED" | "SUSPICIOUS" | "FAKE">,
  "summary": <2-3 sentence overall assessment>,
  "claims": [
    {
      "text": <exact claim from content>,
      "status": <"True" | "False" | "Misleading" | "Unverified">,
      "evidence": <1-2 sentence explanation with reasoning>,
      "severity": <"low" | "medium" | "high">
    }
  ],
  "flags": [<array of manipulation tactic strings>],
  "bias": {
    "direction": <"left" | "center-left" | "center" | "center-right" | "right" | "unknown">,
    "explanation": <1 sentence>
  },
  "sourceCredibility": {
    "rating": <"high" | "medium" | "low" | "unknown">,
    "notes": <1 sentence about the source>
  },
  "emotionalTone": <"neutral" | "alarming" | "inflammatory" | "sensational" | "measured">,
  "recommendations": [<2-3 action strings for the reader>],
  "emoji": <single emoji representing verdict>
}`;

const PRO_SYSTEM_PROMPT = `You are MisinfoLens Pro, a senior investigative fact-checking analyst powered by advanced reasoning. Analyze the provided content with deep critical thinking and return ONLY a valid JSON object with this exact structure:
{
  "score": <integer 0-100, truth score>,
  "verdict": <"REAL" | "MOSTLY REAL" | "MIXED" | "SUSPICIOUS" | "FAKE">,
  "summary": <3-4 sentence detailed overall assessment>,
  "executiveBrief": <1 paragraph expert briefing suitable for a journalist or researcher>,
  "claims": [
    {
      "text": <exact claim from content>,
      "status": <"True" | "False" | "Misleading" | "Partially True" | "Unverified">,
      "evidence": <2-3 sentence detailed explanation with reasoning and known facts>,
      "severity": <"low" | "medium" | "high" | "critical">,
      "checkSources": [<1-3 suggested source names to verify>]
    }
  ],
  "flags": [<array of specific manipulation tactic strings with detail>],
  "propagandaTechniques": [<array of named propaganda techniques if found, e.g. "Fear Appeal", "False Dichotomy">],
  "bias": {
    "direction": <"left" | "center-left" | "center" | "center-right" | "right" | "unknown">,
    "strength": <"strong" | "moderate" | "slight" | "none">,
    "explanation": <2 sentence analysis>
  },
  "sourceCredibility": {
    "rating": <"high" | "medium" | "low" | "unknown">,
    "domainReputation": <"established" | "questionable" | "unknown" | "satire">,
    "notes": <2 sentences about the source, ownership, track record>
  },
  "emotionalTone": <"neutral" | "alarming" | "inflammatory" | "sensational" | "measured" | "fear-mongering">,
  "audienceManipulation": <detailed paragraph on how content may manipulate readers>,
  "contextGaps": [<array of important missing context items>],
  "timeline": <any relevant timeline or date context, or null>,
  "geopoliticalContext": <brief geopolitical framing if relevant, or null>,
  "recommendations": [<3-5 specific action strings for the reader>],
  "confidenceLevel": <"high" | "medium" | "low">,
  "analysisLimitations": <honest statement about limits of this analysis>,
  "emoji": <single emoji representing verdict>
}`;

export async function POST(req) {
  const { type, content, tier } = await req.json();
  const licenseKey = req.headers.get('x-license-key');
  const isPro = tier === 'pro' && licenseKey?.startsWith('pro-');

  if (!content || content.trim().length < 10) {
    return NextResponse.json({ error: 'Content too short to analyze.' }, { status: 400 });
  }

  let apiKey, model, baseUrl;
  if (isPro) {
    apiKey = process.env.XAI_API_KEY;
    model = 'grok-3';
    baseUrl = 'https://api.x.ai/v1';
  } else {
    const groqKey = process.env.GROQ_API_KEY_1 || process.env.GROQ_API_KEY_2;
    if (groqKey) {
      apiKey = groqKey;
      model = 'llama-3.3-70b-versatile';
      baseUrl = 'https://api.groq.com/openai/v1';
    } else {
      apiKey = process.env.OPENROUTER_API_KEY;
      model = 'meta-llama/llama-3.3-70b-instruct';
      baseUrl = 'https://openrouter.ai/api/v1';
    }
  }

  const systemPrompt = isPro ? PRO_SYSTEM_PROMPT : FREE_SYSTEM_PROMPT;
  const userMessage = `Analyze this ${type === 'url' ? 'news article/URL content' : 'text'} for misinformation, bias and manipulation:\n\n${content}`;

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://misinfolens-app.vercel.app',
        'X-Title': 'MisinfoLens'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: isPro ? 4000 : 2000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Upstream API error:', errText);
      return NextResponse.json({ error: 'AI API error', details: errText }, { status: 502 });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return NextResponse.json({ error: 'Empty response from AI' }, { status: 502 });

    const result = JSON.parse(raw);
    result.isPro = isPro;
    result.model = model;
    return NextResponse.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    return NextResponse.json({ error: 'Analysis failed', details: error.message }, { status: 500 });
  }
}
