# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

MisinfoLens is an AI-powered fact-checking web app. It has a static HTML frontend (`index.html`) and a single Next.js App Router API endpoint (`api/analyze/route.js`).

### Architecture notes

- The original `api/analyze/route.js` at the repo root uses Next.js App Router conventions (`export async function POST`, `NextResponse`).
- `app/route.js` serves `index.html` as the root page (GET /).
- `app/api/analyze/route.js` re-exports the `POST` handler from the original `api/analyze/route.js`.
- The frontend is a single static HTML file using CDN-loaded Tailwind CSS, Chart.js, and Font Awesome — no React rendering involved.

### Running the dev server

```bash
npm run dev        # starts Next.js on port 3000
```

### Lint / Build / Test

```bash
npm run lint       # ESLint via next lint (eslint-config-next)
npm run build      # Next.js production build
```

There is no automated test suite at this time.

### API keys

The `/api/analyze` endpoint requires at least one LLM API key in `.env.local`:

| Variable | Purpose | Required |
|---|---|---|
| `GROQ_API_KEY_1` | Groq free-tier (primary) | One of GROQ or OPENROUTER needed for free tier |
| `GROQ_API_KEY_2` | Groq free-tier (fallback) | Optional |
| `OPENROUTER_API_KEY` | OpenRouter free-tier fallback | Optional (used if no GROQ key) |
| `XAI_API_KEY` | xAI Grok-3 for Pro tier | Only needed for Pro analysis |

Without any key, the API endpoint will return a 401/502 from the upstream LLM provider.

### Gotchas

- The frontend fetches `/api/analyze` (relative path), so it must be served from the same origin as the API — use `npm run dev` which handles both.
- Pro tier activation uses a client-side license key prefix check (`pro-`). Enter any key starting with `pro-` in the upgrade modal to test Pro mode locally.
