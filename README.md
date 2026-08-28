# Brick Tree

Brick Tree is a stateless learning-map application with two complementary workflows:

- **Tree** breaks a concept down, traces prerequisites, or analyzes a broad question.
- **Brick** starts from what the learner knows and builds reachable knowledge upward, either by exploration or toward a destination.

## Architecture

The project is organized by responsibility rather than by feature history.

```text
app/
  api/                    HTTP boundaries
components/
  BrickTreeApp.tsx        application controller and workspace state
  brick-tree/
    model.ts              UI types and pure view-model helpers
    shell.tsx             landing, mode, zoom, and level controls
    setup.tsx             Tree/Brick setup form
    hierarchy.tsx         graph hierarchy rendering
    node-detail.tsx       focused-node detail and actions
    navigation.tsx        workspace drawer and movable mini-map
    MiniGraphMap.tsx      reusable compact graph map
lib/
  agents/
    orchestrator.ts       public workflow facade
    workflow-core.ts shared workflow primitives
    tree-workflow.ts      Tree generation and validation
    brick-workflow.ts     initial Brick generation
    branch-workflow.ts    next Brick layer generation
    resource-workflow.ts  adaptive resource retrieval and ranking
    explanation-workflow.ts adaptive node explanations
  graph/                  graph operations and layout
  learning/               learner-specific normalization and fit logic
  llm/                    provider routing, cooldowns, and structured output
  schemas/                runtime/API contracts
  tools/                  web, academic, and document retrieval tools
```

Application source files are intentionally kept below 1,000 lines. Workflow-specific behavior stays behind the small public orchestrator facade so API routes do not depend on implementation details.

## Multi-agent workflow

Brick Tree uses four explicit roles with authorized structured handoffs:

```text
Concept Architect ──→ Pedagogy Validator
       │                    │
       └────────────→ Resource Agent

Learning Path Agent ─→ Pedagogy Validator
       │                    │
       └────────────→ Resource Agent

Pedagogy Validator ──→ originating generation agent when revision is required
```

Handoffs include the source, destination, summary, timestamp, and task context. The runtime rejects unknown or unauthorized destinations.

## Resource behavior

Resources are attached automatically to visible generated nodes. Selection is source-neutral and adapts to the node, learner, task, and difficulty.

- General learning material can come from Tavily or Brave Search.
- OpenAlex, Crossref, and Semantic Scholar are used only when scholarly material is appropriate.
- Difficulty controls depth; it does not automatically imply research papers.
- Retrieved candidates are ranked by relevance, credibility signals, learner fit, resource-type fit, and diversity.
- Deterministic ranking is the default to avoid an extra LLM call per node.
- Successful results are cached on warm server instances for 20 minutes.

## API efficiency

Normal generation uses one model request when the first structured response is valid. Deterministic pedagogy validation and deterministic resource ranking are the defaults. Provider fallback, cooldowns, and bounded retries protect free-tier quotas.

Resource hydration is sent from the browser as one batch request for a generated layer. Each node uses one high-signal search query in the normal path, with a second provider only when the primary fails or returns too little useful material. Academic retrieval is skipped unless the resource strategy calls for it.

## Environment

At least one LLM provider is required for generation and explanations.

```env
LLM_PROVIDER=auto

GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-120b

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash

# Optional additional providers
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_MODEL=@cf/openai/gpt-oss-20b
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openrouter/free

# Optional OpenAI-compatible endpoint
LLM_BASE_URL=
LLM_API_KEY=
LLM_MODEL=
```

Resource integrations:

```env
TAVILY_API_KEY=
BRAVE_SEARCH_API_KEY=
OPENALEX_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
APP_CONTACT_EMAIL=
```

Recommended quota-conscious defaults:

```env
AGENT_MAX_STEPS=5
AGENT_MAX_REVISIONS=1
LLM_MAX_OUTPUT_TOKENS=1000
PEDAGOGY_VALIDATION_MODE=deterministic
RESOURCE_PLANNING_MODE=deterministic
```

Never expose provider keys with a `NEXT_PUBLIC_` prefix.

## Local development

Use Node.js 22.x.

```bash
npm install
cp .env.example .env.local
npm run check
npm run dev
```

`npm run check` runs type checking, linting, tests, and the production Next.js build.

## Deployment

Brick Tree runs on the standard Next.js Node runtime and requires no database or persistent filesystem. Add secrets in **Vercel → Project → Settings → Environment Variables** and redeploy after changing them.

After deployment, verify Tree generation and expansion, Brick generation and buildup, node explanations, automatic resources, mini-map movement, workspace switching, document upload, and session/workspace import-export.
