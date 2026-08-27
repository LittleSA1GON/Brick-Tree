# Brick Tree

**Cut down complex ideas and build up new ones.**

Brick Tree is a stateless learning map with two separate directions:

- **Tree** cuts a concept into branches, traces prerequisites, or examines a broad question.
- **Brick** starts from known foundations and constructs reachable knowledge upward, either by exploring or building toward a destination.

## 0.8.5 node resources + API efficiency

- **Prerequisite/unlock filler is removed from Tree and Brick detail.** Node detail now stays focused on the explanation, why the node matters, adaptive resources, and actions that actually change the graph.
- **Every visible generated node is automatically given one adaptive resource-discovery attempt.** Initial Tree/Brick rows and newly generated layers hydrate resources in a single compact client request; imported/older workspaces are backfilled the same way.
- **Resource format remains adaptive from 0.8.4.** Difficulty changes depth, not source type: conceptual nodes favor explanations/courses/videos, procedural class or exam nodes favor worked examples, implementation/project nodes favor documentation and references, and papers are reserved for genuine research/evidence intent.
- **Resource API calls are compact and bounded.** One high-signal web query is the normal path for a node, academic lookup is added only when warranted, and each search normally calls one provider/index with a fallback only when results are insufficient or the primary fails.
- **Provider use remains source-neutral.** Tavily/Brave and Crossref/OpenAlex/Semantic Scholar primaries rotate by query; no preferred-domain whitelist or institution boost was added.
- **Warm-instance resource caching avoids repeat retrieval.** Relevant resource sets are cached for 20 minutes using node context, learner fit, adaptive strategy, and selection mode.
- **Generation payloads do not resend cached resources or detailed explanations.** Explanation and resource endpoints receive only the node/profile fields that can change their result; resource calls never resend uploaded documents.
- **LLM-heavy resource ranking remains opt-in.** Deterministic adaptive selection is the default, so attaching resources to every node does not create an additional model call per node.
- **0.8.3 Brick hardening remains intact.** Brick accepts free-form foundation prose, normalizes harmless Groq output-shape variations, handles negated knowledge and starting-from-scratch statements, and keeps its initial generation compact.
- All native dropdowns retain the explicit dark palette and consistent format from the functional-hardening build.

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

Nodes stay compact until focused. Compact nodes show the concept name and brief description. A focused node expands to include a concise adaptive explanation, why the node matters, its node-specific resources, and the controls that change the graph.

The main learning graph is not a free-drag canvas: navigation is click-to-focus plus two-dimensional scroll/swipe. The left Depth/Height rail is clickable and explains what each signed level means.

The small persistent Tree/Brick map can be repositioned with its dedicated drag handle without interfering with node clicks. The map drawer renders the current workspace as a connected mini hierarchy and can teleport directly to a node.

## Multi-agent collaboration

Brick Tree uses four explicit collaborating roles:

```text
Concept Architect ──→ Pedagogy Validator
       │                    │
       └────────────→ Resource Agent

Learning Path Agent ─→ Pedagogy Validator
       │                    │
       └────────────→ Resource Agent

Pedagogy Validator ──→ originating generation agent when revision is required
```

Every handoff is a structured runtime message with an ID, source agent, destination agent, summary, timestamp, and context. The runtime rejects handoffs to unknown agents or destinations that are not on the source agent's allowlist. Validation handoffs include candidate titles, expected level, learner context, and revision issues. Resource handoffs include the exact node, difficulty, level, and learner profile.

## Source-neutral resource agent

The Resource Agent does not use a preferred-domain whitelist or a curated catalog of favored websites. It derives the useful resource format from the node, learner, task, and difficulty, retrieves a small node-specific candidate pool, and then evaluates candidates using relevance, credibility evidence, learner/audience fit, type/depth fit, and source diversity.

Web retrieval can use Tavily and Brave Search. Scholarly retrieval can use Crossref, OpenAlex, and Semantic Scholar when configured. Wikipedia/Wikimedia are excluded. The model-based selector is only allowed to return candidate IDs from the retrieved pool, so it cannot invent URLs. If model selection is disabled, unavailable, or rate-limited, deterministic scoring applies the same relevance/credibility/fit/diversity principles.

## Rate-limit protection

Brick Tree is designed for free/free-tier model APIs, so provider limits are treated as normal runtime conditions rather than fatal errors.

- `LLM_PROVIDER=auto` uses only providers with complete credentials.
- Providers are spaced independently to reduce bursts.
- A provider that returns `429`, times out, or returns a temporary `5xx` is cooled down and skipped while another configured provider is tried.
- `Retry-After` is respected when supplied.
- Gemini uses JSON Object mode first to avoid spending an extra compatibility call on JSON Schema negotiation.
- Normal pedagogy checks are deterministic by default, avoiding an extra validator LLM call on every graph generation.
- Resource discovery for a generated layer is sent as one compact HTTP batch instead of one browser request per node.
- Each node normally uses one high-signal web query and one primary search provider; a second provider is only a fallback. Academic search is skipped entirely unless the adaptive strategy warrants it.
- Nonempty adaptive resource results are cached for 20 minutes per warm server instance, and batch search concurrency is deliberately bounded.
- Deterministic resource selection is the default, avoiding one Resource Agent LLM call per node.
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
LLM_MAX_OUTPUT_TOKENS=1000
LLM_PROVIDER_COOLDOWN_SECONDS=90
LLM_MIN_PROVIDER_INTERVAL_MS=5000
GROQ_MIN_PROVIDER_INTERVAL_MS=10000
GEMINI_MIN_PROVIDER_INTERVAL_MS=4000
CLOUDFLARE_MIN_PROVIDER_INTERVAL_MS=3000
OPENROUTER_MIN_PROVIDER_INTERVAL_MS=6000
PEDAGOGY_VALIDATION_MODE=deterministic
RESOURCE_PLANNING_MODE=deterministic
```

Set `PEDAGOGY_VALIDATION_MODE=llm` only when you explicitly want every candidate layer to use the LLM validator. Set `RESOURCE_PLANNING_MODE=llm` to let the Resource Agent model choose among retrieved candidate IDs; deterministic source-neutral scoring remains the fallback. Both options consume additional model quota.

## Resource APIs

For automatic external resources on ordinary learning nodes, configure at least one general web provider (`TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY`). Crossref/OpenAlex can be queried without a search key for nodes whose adaptive strategy genuinely calls for scholarly evidence, but academic indexes are intentionally not used as a generic replacement for web learning resources.

Resource integrations:

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
automatic resources on each visible generated node
one document upload
session export/import
```


## Adaptive resource selection

Resource discovery uses a difficulty- and task-adaptive resource strategy. Difficulty controls depth, while the node content and learner goal control format: introductory/conceptual nodes favor explanations, courses, and videos; procedural/class/exam nodes favor worked examples and practice; implementation/project nodes favor documentation and references; established advanced concepts favor deep references; and research papers are retrieved only when research/evidence intent, explicit paper preference, or a deliberate academic deep-dive warrants them. Scholarly indexing is treated as a credibility signal, not as an automatic ranking advantage.
