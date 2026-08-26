# Brick Tree

**Break down what you don't understand. Build up what you do.**

Brick Tree is a stateless, Vercel-ready learning graph. **Tree** breaks down concepts, traces prerequisites, or unpacks open-ended questions; **Brick** moves from known concepts toward reachable next knowledge or a destination. Both traverse the same typed graph.

## Runtime and continuation

Brick Tree stores no user data. Live state exists only in React memory. Vercel handles request-time computation and retains no graph, user, or document state.

```text
Browser state ──► Vercel API ──► LLM / search APIs
      │
      └──► Download .bricktree.json ──► user-owned continuation file
```

**Download session** exports graph semantics, difficulty layers, learner configuration, navigation state, recommendations, cached explanations, agent trace, and extracted document text/provenance. **Upload session** validates and restores that file. Visual coordinates and temporary animation state are recalculated.

PDF/DOCX/TXT/MD/CSV/TSV/JSON uploads are parsed by `POST /api/documents`; the extracted result is returned to the browser and is not persisted by the server.

## Learning model

Tree intents:

- **Break Down** — conceptual components (`contains`).
- **Trace to Roots** — supporting knowledge (`prerequisite` / `builds-on`), stopping at concepts the learner already knows.
- **Analyze a Question** — open-ended or strategic questions split into specific reasoning lenses inspired by **Who / What / Why / Where / How** (and When when useful), connected by `examines` edges. Deeper expansion makes one lens more concrete rather than repeating generic 5W/H labels.

Brick intents:

- **Explore** — reachable next concepts without requiring a destination.
- **Destination** — ranked next concepts toward an optional goal without generating a rigid curriculum.

Every node includes a short description plus a 1–5 understanding-difficulty score, explanation, and factors. Peer nodes at one visual level should normally differ by no more than one difficulty point; the validator and deterministic checks enforce the rule.

## Agents

Four agents share one bounded runtime:

1. **Concept Architect** — decomposition, prerequisite structure, and open-question reasoning lenses.
2. **Learning Path Agent** — reachable concepts and Recommended Next Brick.
3. **Pedagogy Validator** — intent, difficulty, learner, and source-fidelity checks; can reject and request revision.
4. **Resource Agent** — plans restricted learning-resource searches.

The runtime enforces registered agents/tools, allowed handoffs, step/revision limits, schema validation, timeouts, and high-level trace events. It does not expose chain-of-thought.

## Graph implementation

- `@xyflow/react` — interactive nodes/edges, pan/zoom, selection, viewport control.
- `elkjs` — layered automatic layout for variable-size nodes and cross-links.
- CSS/browser animation — entrance, subtle floating, edge emphasis, and reduced-motion behavior.

Nodes are generated lazily. ELK recalculates positions after semantic changes; React Flow performs branch-aware camera fitting. Semantic graph data, not viewport coordinates, is the source of truth.

## Sources and retrieval

Source modes are **General**, **Prefer Uploaded**, and **Uploaded Only**. Uploaded-only claims must be supported by retrieved document sections, preserving document/section/page provenance when available.

Resource tools use native `fetch`, avoiding API SDK dependencies:

- Wikipedia/Wikimedia — no key.
- Crossref — no key; `APP_CONTACT_EMAIL` enables responsible identification.
- Tavily — optional web search when `TAVILY_API_KEY` is configured.
- Optional local/remote RAG — enabled only when `LOCAL_RAG_BASE_URL` is configured.

## LLM configuration

Only one protocol implementation is maintained: OpenAI-compatible chat completions. Groq is a convenience configuration; Gemini, OpenRouter, and compatible local servers use the generic endpoint configuration.

```env
# Default hosted path
LLM_PROVIDER=groq
GROQ_API_KEY=
LLM_MODEL=openai/gpt-oss-20b

# Or a compatible hosted/local endpoint
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Examples of compatible base URLs include Gemini's OpenAI-compatible endpoint, OpenRouter, Ollama/LM Studio/llama.cpp-compatible servers, and similar services. Provider-specific SDKs are intentionally not used.

Optional capabilities:

```env
TAVILY_API_KEY=
APP_CONTACT_EMAIL=
LOCAL_RAG_BASE_URL=
```

A missing optional key disables only that optional capability. LLM credentials are needed only when an AI action is invoked.

## Runtime dependencies

Brick Tree has **8 runtime packages**:

| Package | Reason retained |
| --- | --- |
| `next` | App Router, server routes, Vercel runtime |
| `react` / `react-dom` | Next.js UI runtime |
| `@xyflow/react` | Interactive graph rendering and viewport behavior |
| `elkjs` | Automatic hierarchical layout; React Flow intentionally does not supply a layout engine |
| `zod` | Runtime validation of untrusted AI/API/session-file data and shared schema typing |
| `pdf-parse` | PDF text/page/metadata extraction compatible with Next.js/Vercel |
| `mammoth` | DOCX raw-text extraction |

There is no animation library, CSS framework, state library, HTTP wrapper, LLM SDK, agent framework, database/ORM, auth package, object-storage SDK, vector-database SDK, or icon package. Existing code uses React state, CSS, Web APIs, and native `fetch` instead.

Development-only dependencies are TypeScript, ESLint + Next config, Vitest, and React/Node type definitions.

## API

- `POST /api/agent` — stateless navigation, resource, and explanation actions.
- `POST /api/documents` — parse one file, max 4 MB.
- `GET /api/health` — runtime/provider status and `persistentStorage: false`.

Mutating routes enforce same-origin requests and request-size limits. Provider secrets remain server-side.

## Run

The current PDF parser requires Node.js **20.16+** (or a supported Node 22+ release).

```bash
npm install
npm run dev
```

Full verification:

```bash
npm run check
```

`check` runs TypeScript, ESLint, Vitest, and a production Next.js build.

## Vercel

Import the repository into Vercel, add the selected provider environment variables, and deploy. Production requires no database, Blob store, account system, persistent filesystem, Docker container, background worker, local model, or local RAG service.

## Privacy

Brick Tree itself is stateless, but configured LLM/search providers process requests under their own policies. Exported `.bricktree.json` files can contain uploaded-source text and should be treated as private files.
