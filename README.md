# Brick Tree

**Cut down complex ideas and build up new ones.**

Brick Tree is a stateless learning map for two directions of learning:

- **Tree** — break a concept down, trace its prerequisites, or unpack a broad question.
- **Brick** — start from what you already know and find realistic next concepts, with or without a destination.

## How the interface works

The starting node is always **0**.

- Tree measures **Depth** from the starting concept.
- Brick measures **Height** from the starting knowledge.
- Scrolling moves between nodes; the workspace is intentionally fixed and cannot be dragged or panned.
- The focused node grows into view while later nodes stay smaller below it.
- Each node contains its short description, level explanation, deeper explanation, resources, and continue controls.
- The map drawer lists current nodes and connections and can jump directly to any node.

The landing page is split between Tree green and Brick orange. The split **Begin** control becomes the Tree/Brick switch at the top of the workspace.

## Learning modes

### Tree

- **Break down** — conceptual parts using `contains` edges.
- **Trace roots** — prerequisites using `prerequisite` / `builds-on` edges.
- **Analyze a question** — specific reasoning lenses using `examines` edges.

### Brick

- **Explore** — useful next concepts from existing knowledge.
- **Destination** — ranked next concepts toward a goal.

## Agents

Brick Tree uses four bounded agents:

1. **Concept Architect** — Tree structure and question analysis.
2. **Learning Path Agent** — Brick directions and recommendations.
3. **Pedagogy Validator** — checks intent, learner fit, difficulty, and source fidelity.
4. **Resource Agent** — plans resource searches.

The runtime validates structured model output, limits retries and revisions, and falls back between configured providers. It does not expose chain-of-thought.

## LLM setup

At least one hosted provider is required for AI actions.

```env
LLM_PROVIDER=auto

GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free

AGENT_MAX_STEPS=5
AGENT_MAX_REVISIONS=2
```

`auto` only includes providers that actually have credentials. Default role preferences are:

| Role | Order |
| --- | --- |
| Concept Architect | Gemini → Groq → OpenRouter → compatible endpoint |
| Learning Path | Groq → Gemini → OpenRouter → compatible endpoint |
| Pedagogy Validator | OpenRouter → Gemini → Groq → compatible endpoint |
| Resource Agent | Groq → OpenRouter → Gemini → compatible endpoint |
| Explanations | Gemini → Groq → OpenRouter → compatible endpoint |

A generic OpenAI-compatible provider can be added with:

```env
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Those three variables are not required unless that provider is configured.

## Optional resources

Keyless sources remain available. Optional environment variables add coverage:

```env
TAVILY_API_KEY=
BRAVE_SEARCH_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
OPENALEX_API_KEY=
APP_CONTACT_EMAIL=
LOCAL_RAG_BASE_URL=
```

Do not point a Vercel deployment at localhost or a private-LAN RAG service.

## Documents

`POST /api/documents` accepts:

- PDF
- DOCX
- TXT
- Markdown
- CSV / TSV
- JSON

Files are parsed for the live browser session and are not persisted by Brick Tree. Individual files are capped at 4 MiB and the route also guards the complete multipart request against Vercel's function payload limit.

## Sessions

Brick Tree has no database or account system. Live state stays in React memory.

**Download session** exports a `.bricktree.json` file containing the semantic graph, traversal state, learner settings, recommendations, cached explanations, trace events, and extracted source text. **Upload session** validates and restores it later.

Treat exported session files as private when they contain private source material.

## Runtime dependencies

Brick Tree 0.7.0 has six runtime packages:

| Package | Purpose |
| --- | --- |
| `next` | App Router and Vercel runtime |
| `react` / `react-dom` | UI runtime |
| `zod` | API, LLM, and session validation |
| `pdf-parse` | PDF extraction |
| `mammoth` | DOCX extraction |

The fixed scroll workspace uses native React, CSS Scroll Snap, CSS transitions, and browser APIs. There is no graph-dragging library, animation library, CSS framework, HTTP wrapper, LLM SDK, database, ORM, auth package, object-storage SDK, or vector-database SDK.

## Run locally

Use Node.js 22.x.

```bash
npm install
cp .env.example .env.local
npm run check
npm run dev
```

Open `http://localhost:3000`.

`npm run check` runs TypeScript, ESLint, Vitest, and the production Next.js build.

## Vercel

1. Push the repository to GitHub.
2. Import it into Vercel using the Next.js preset.
3. Use Node.js 22.x.
4. Add the required environment variables in **Settings → Environment Variables**.
5. Apply provider variables to Production and Preview when both should run AI workflows.
6. Deploy and verify `/`, `/api/health`, one Tree flow, one Brick flow, an explanation, and a small document upload.

The app requires no database, persistent filesystem, Blob store, background worker, Docker container, or local service in production.

## API

- `POST /api/agent` — Tree, Brick, explanation, and resource actions.
- `POST /api/documents` — document extraction.
- `GET /api/health` — safe provider/model routing and capability status without secrets.

## Privacy

Brick Tree itself is stateless. Requests sent to configured LLM/search providers are handled under those providers' own policies. Keep provider keys server-side and never expose them through `NEXT_PUBLIC_*` variables.
