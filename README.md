# Brick Tree

**Cut down complex ideas and build up new ones.**

Brick Tree is a stateless learning map with two separate directions:

- **Tree** cuts a concept into branches, traces prerequisites, or examines a broad question.
- **Brick** starts from known foundations and constructs reachable knowledge upward, either by exploring or building toward a destination.

## Interaction model

Tree and Brick maps are independent workspaces. You can create several of each and switch between them from the map drawer without changing another map.

### Tree

```text
              node
        /      |      \
      node    node    node
       |
    deeper branch
```

- The starting concept is **Depth 0**.
- Every generated layer moves one reasonable conceptual step downward: `-1`, `-2`, `-3`, and so on.
- The focused node stays above its direct children.
- Sibling branches remain visible side by side.
- Click a child to focus it, then branch only that node.
- Tree uses cutting, branching, tracing, and examining language.

### Brick — Explore

```text
       next layer
       |   |   |
   foundation bricks
```

- Supplied knowledge is **Height 0**.
- Brick may suggest genuinely missing foundation bricks alongside the learner's supplied foundations.
- Every new layer moves only one realistically learnable step upward: `+1`, `+2`, `+3`, and so on.
- Explore has no fixed destination and surfaces useful reachable directions.

### Brick — Destination

```text
       destination
           ||
     future gap/layers
         |   |
      next layer
       |   |   |
   foundation bricks
```

- The destination is estimated at an absolute height measured from Height 0.
- Brick does not fabricate all intermediate layers at once.
- Each click constructs only the next reasonable layer toward the destination.

## Node behavior

Nodes stay compact until focused. Compact nodes show the concept name and brief description. A focused node expands to include explanation, prerequisites, why it matters, resources, and the control to branch or construct the next layer.

There is no draggable graph canvas and no scroll-based graph navigation. Navigation is click-to-focus. The left Depth/Height rail is clickable and explains what each signed level means.

The map drawer renders the current workspace as a connected mini hierarchy and can teleport directly to a node.

## Rate-limit protection

Brick Tree is designed for free/free-tier model APIs, so provider limits are treated as normal runtime conditions rather than fatal errors.

- `LLM_PROVIDER=auto` uses only providers with complete credentials.
- Providers are spaced independently to reduce bursts.
- A provider that returns `429`, times out, or returns a temporary `5xx` is cooled down and skipped while another configured provider is tried.
- `Retry-After` is respected when supplied.
- Gemini uses JSON Object mode first to avoid spending an extra compatibility call on JSON Schema negotiation.
- Normal pedagogy checks are deterministic by default, avoiding an extra validator LLM call on every graph generation.
- Output is capped to reduce token-per-minute pressure.
- Groq, Gemini, Cloudflare Workers AI, OpenRouter, and one generic OpenAI-compatible endpoint can share the workload.

In-memory cooldown state is intentionally stateless and applies per warm server instance. Provider account quotas are still external limits and cannot be made unlimited by application code.

## LLM setup

At least one provider is required for AI actions. Two or three independent providers are recommended for public deployments.

```env
LLM_PROVIDER=auto

GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

# Optional additional free quota pool
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_MODEL=@cf/openai/gpt-oss-20b

# Optional last fallback
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free
```

Optional generic OpenAI-compatible provider:

```env
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Optional role overrides:

```env
CONCEPT_ARCHITECT_PROVIDER=
LEARNING_PATH_PROVIDER=
PEDAGOGY_VALIDATOR_PROVIDER=
RESOURCE_AGENT_PROVIDER=
EXPLANATION_PROVIDER=
```

Valid values are:

```text
groq
gemini
cloudflare
openrouter
openai-compatible
```

## Free-tier protection defaults

```env
AGENT_MAX_STEPS=5
AGENT_MAX_REVISIONS=1
LLM_MAX_OUTPUT_TOKENS=1600
LLM_PROVIDER_COOLDOWN_SECONDS=75
LLM_MIN_PROVIDER_INTERVAL_MS=2500
GROQ_MIN_PROVIDER_INTERVAL_MS=7000
GEMINI_MIN_PROVIDER_INTERVAL_MS=2500
CLOUDFLARE_MIN_PROVIDER_INTERVAL_MS=2000
OPENROUTER_MIN_PROVIDER_INTERVAL_MS=5000
PEDAGOGY_VALIDATION_MODE=deterministic
```

Set `PEDAGOGY_VALIDATION_MODE=llm` only when you explicitly want every candidate layer to use the LLM validator. It consumes additional quota.

## Resource APIs

Optional resource integrations:

```env
TAVILY_API_KEY=
BRAVE_SEARCH_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
OPENALEX_API_KEY=
APP_CONTACT_EMAIL=
```

Keyless sources remain available where supported.

## Sessions

Brick Tree does not persist server-side user state. A `.bricktree.json` session can contain several independent Tree and Brick workspaces together with the learner profile, uploaded source text, explanations, and trace metadata.

## Documents

`POST /api/documents` accepts PDF, DOCX, TXT, Markdown, CSV, TSV, and JSON. Uploaded content is parsed for the live browser session and is not persisted by the server.

## Local setup

Use Node.js 22.x.

```bash
npm install
cp .env.example .env.local
npm run check
npm run dev
```

Open `http://localhost:3000`.

## Vercel

Brick Tree uses the standard Next.js Node runtime and requires no database, persistent filesystem, Blob store, background worker, Docker service, or local model in production.

Add real secrets under **Vercel → Project → Settings → Environment Variables**. Keep `.env.example` secret-free.

After deployment verify:

```text
/
/api/health
Tree Cut Down
Tree Trace Roots
Tree Analyze a Question
Brick Explore
Brick Destination
one deeper Tree branch
one higher Brick layer
one explanation
one resource lookup
one document upload
session export/import
```
