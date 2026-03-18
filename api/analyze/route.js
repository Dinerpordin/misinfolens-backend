import { NextResponse } from 'next/server';

// ── Web search helper (Tavily preferred, Brave fallback) ──────────────────────
async function webSearch(query, numResults = 5) {
  try {
    // Try Tavily first
    if (process.env.TAVILY_API_KEY) {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query,
          search_depth: 'basic',
          max_results: numResults,
          include_answer: true
        })
      });
      if (res.ok) {
        const data = await res.json();
        const snippets = (data.results || []).map(r =>
          `[${r.title}] ${r.url}\n${r.content?.slice(0, 300)}`
        ).join('\n\n');
        return data.answer ? `Summary: ${data.answer}\n\n${snippets}` : snippets;
      }
    }
    // Fallback: Brave Search API
    if (process.env.BRAVE_API_KEY) {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY
        }
      });
      if (res.ok) {
        const data = await res.json();
        return (data.web?.results || []).map(r =>
          `[${r.title}] ${r.url}\n${r.description}`
        ).join('\n\n');
      }
    }
  } catch (e) {
    console.error('Web search error:', e.message);
  }
  return null;
}

// ── AI API caller with full fallback chain ────────────────────────────────────
async function callAI(messages, isPro) {
  const providers = [];

  if (isPro && process.env.XAI_API_KEY) {
    providers.push({
      apiKey: process.env.XAI_API_KEY,
      model: 'grok-3',
      baseUrl: 'https://api.x.ai/v1',
      maxTokens: 4500
    });
  }

  // Groq keys (try both)
  if (process.env.GROQ_API_KEY_1) {
    providers.push({
      apiKey: process.env.GROQ_API_KEY_1,
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
      maxTokens: isPro ? 4500 : 2500
    });
  }
  if (process.env.GROQ_API_KEY_2) {
    providers.push({
      apiKey: process.env.GROQ_API_KEY_2,
      model: 'llama-3.3-70b-versatile',
      baseUrl: 'https://api.groq.com/openai/v1',
      maxTokens: isPro ? 4500 : 2500
    });
  }

  // OpenRouter – primary model
  if (process.env.OPENROUTER_API_KEY) {
    providers.push({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: 'meta-llama/llama-3.3-70b-instruct',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: isPro ? 4500 : 2500
    });
    // OpenRouter – fallback model
    providers.push({
      apiKey: process.env.OPENROUTER_API_KEY,
      model: 'mistralai/mistral-7b-instruct',
      baseUrl: 'https://openrouter.ai/api/v1',
      maxTokens: isPro ? 4500 : 2500
    });
  }

  if (providers.length === 0) {
    throw new Error('No AI API keys configured.');
  }

  let lastError;
  for (const p of providers) {
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${p.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://misinfolens-app.vercel.app',
          'X-Title': 'MisinfoLens'
        },
        body: JSON.stringify({
          model: p.model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: p.maxTokens
        })
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Provider ${p.model} failed (${res.status}):`, errText);
        lastError = `${p.model}: HTTP ${res.status}`;
        continue; // try next provider
      }
      const data = await res.json();
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) {
        lastError = `${p.model}: empty response`;
        continue;
      }
      return { raw, model: p.model };
    } catch (e) {
      console.warn(`Provider ${p.model} threw:`, e.message);
      lastError = e.message;
    }
  }
  throw new Error(`All AI providers failed. Last error: ${lastError}`);
}

// ── Prompts ───────────────────────────────────────────────────────────────────
const FREE_SYSTEM_PROMPT = `You are MisinfoLens, an expert fact-checking analyst. You will receive content to analyze AND optionally live web search results to ground your assessment in real-world evidence.

Return ONLY a valid JSON object with this exact structure:
{
  "score": <integer 0-100, truth score>,
  "verdict": <"REAL" | "MOSTLY REAL" | "MIXED" | "SUSPICIOUS" | "FAKE">,
  "summary": <3-4 sentence overall assessment incorporating any search findings>,
  "searchGrounded": <true if web search results were provided, false otherwise>,
  "claims": [
    {
      "text": <exact claim from content>,
      "status": <"True" | "False" | "Misleading" | "Unverified">,
      "evidence": <2-3 sentence explanation citing specific facts or search findings>,
      "severity": <"low" | "medium" | "high">
    }
  ],
  "flags": [<array of specific manipulation tactic strings>],
  "bias": {
    "direction": <"left" | "center-left" | "center" | "center-right" | "right" | "unknown">,
    "explanation": <1-2 sentences>
  },
  "sourceCredibility": {
    "rating": <"high" | "medium" | "low" | "unknown">,
    "notes": <1-2 sentences about the source and its track record>
  },
  "emotionalTone": <"neutral" | "alarming" | "inflammatory" | "sensational" | "measured">,
  "contextGaps": [<array of important missing context items>],
  "recommendations": [<2-3 specific action strings for the reader>],
  "emoji": <single emoji representing verdict>
}`;

const PRO_SYSTEM_PROMPT = `You are MisinfoLens Pro, a senior investigative fact-checking analyst. You will receive content to analyze AND live web search results to ground your assessment with real-world evidence. Cross-reference the content claims against the search findings explicitly.

Return ONLY a valid JSON object with this exact structure:
{
  "score": <integer 0-100, truth score>,
  "verdict": <"REAL" | "MOSTLY REAL" | "MIXED" | "SUSPICIOUS" | "FAKE">,
  "summary": <4-5 sentence detailed assessment explicitly referencing search evidence>,
  "executiveBrief": <1-2 paragraph expert briefing suitable for a journalist or researcher, noting which claims are confirmed/refuted by current web sources>,
  "searchGrounded": <true if web search results were provided, false otherwise>,
  "claims": [
    {
      "text": <exact claim from content>,
      "status": <"True" | "False" | "Misleading" | "Partially True" | "Unverified">,
      "evidence": <3-4 sentence detailed explanation cross-referencing search results>,
      "severity": <"low" | "medium" | "high" | "critical">,
      "checkSources": [<1-3 specific credible source names to verify this claim>]
    }
  ],
  "flags": [<array of specific manipulation tactic strings with brief detail>],
  "propagandaTechniques": [<named propaganda techniques found, e.g. "Fear Appeal", "False Dichotomy", "Bandwagon">],
  "bias": {
    "direction": <"left" | "center-left" | "center" | "center-right" | "right" | "unknown">,
    "strength": <"strong" | "moderate" | "slight" | "none">,
    "explanation": <2-3 sentence analysis>
  },
  "sourceCredibility": {
    "rating": <"high" | "medium" | "low" | "unknown">,
    "domainReputation": <"established" | "questionable" | "unknown" | "satire">,
    "notes": <2-3 sentences about source, ownership, bias track record>
  },
  "emotionalTone": <"neutral" | "alarming" | "inflammatory" | "sensational" | "measured" | "fear-mongering">,
  "audienceManipulation": <detailed paragraph on how content may manipulate readers psychologically>,
  "contextGaps": [<array of important missing context items>],
  "timeline": <relevant timeline or date context, or null>,
  "geopoliticalContext": <brief geopolitical framing if relevant, or null>,
  "recommendations": [<3-5 specific action strings for the reader>],
  "confidenceLevel": <"high" | "medium" | "low">,
  "analysisLimitations": <honest statement about limits of this analysis>,
  "emoji": <single emoji representing verdict>
}`;

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req) {
  const { type, content, tier } = await req.json();
  const licenseKey = req.headers.get('x-license-key');
  const isPro = tier === 'pro' && licenseKey?.startsWith('pro-');

  if (!content || content.trim().length < 10) {
    return NextResponse.json({ error: 'Content too short to analyze.' }, { status: 400 });
  }

  // ── Step 1: Web search to ground the analysis ──────────────────────────────
  let searchContext = null;
  try {
    // Extract a focused search query from the content
    const firstSentence = content.trim().split(/[.!?\n]/)[0].trim().slice(0, 200);
    const searchQuery = type === 'url'
      ? `fact check: ${firstSentence}`
      : `verify: ${firstSentence}`;
    searchContext = await webSearch(searchQuery, isPro ? 6 : 4);
    if (searchContext) {
      console.log('Web search successful, context length:', searchContext.length);
    }
  } catch (e) {
    console.warn('Web search step failed:', e.message);
  }

  // ── Step 2: Build prompt with search context ───────────────────────────────
  const systemPrompt = isPro ? PRO_SYSTEM_PROMPT : FREE_SYSTEM_PROMPT;

  let userMessage = `Analyze this ${type === 'url' ? 'news article/URL content' : 'text'} for misinformation, bias and manipulation:\n\n--- CONTENT TO ANALYZE ---\n${content}`;

  if (searchContext) {
    userMessage += `\n\n--- LIVE WEB SEARCH RESULTS (use these to ground your fact-checking) ---\n${searchContext}`;
  } else {
    userMessage += `\n\n[Note: No live search results available. Base analysis on training knowledge and reasoning.]`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage }
  ];

  // ── Step 3: Call AI with fallback chain ────────────────────────────────────
  try {
    const { raw, model } = await callAI(messages, isPro);
    const result = JSON.parse(raw);
    result.isPro = isPro;
    result.model = model;
    result.searchGrounded = !!searchContext;
    return NextResponse.json(result);
  } catch (error) {
    console.error('Analysis error:', error.message);
    return NextResponse.json(
      { error: 'Analysis failed', details: error.message },
      { status: 500 }
    );
  }
}
