# Brick Tree

**Cut down complex ideas and build up new ones.**

Brick Tree is a stateless learning map with two separate directions:

- **Tree** cuts a concept into branches, traces prerequisites, or examines a broad question.
- **Brick** starts from known foundations and constructs reachable knowledge upward, either by exploring or building toward a destination.

## 0.8.3 reliability updates

- All native dropdowns use one explicit dark palette so selected values and option menus remain readable.
- Brick accepts free-form foundation prose, sends the raw statement to the Learning Path Agent, and keeps a deterministic schema-safe fallback parser. Negated knowledge is not marked as known, and starting-from-scratch statements are supported.
- Learning Path output normalizes harmless model shape variations such as an object returned where a text field was expected, preventing Groq formatting differences from aborting an otherwise usable path.
- Brick initial generation stays compact like Tree; richer prerequisites and unlocks are loaded lazily when node detail is opened.
- Node detail now requests and displays adaptive prerequisites and concrete next-step unlocks instead of static placeholder copy.
- Explanation requests can refresh when the requested learner level changes, and failed automatic resource lookups can be retried.

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

The Resource Agent does not use a preferred-domain whitelist or a curated catalog of favored websites. It creates node-specific queries, retrieves a mixed candidate pool, and then evaluates candidates using relevance, credibility evidence, learner/audience fit, node difficulty, and source diversity.

Web retrieval can use Tavily and Brave Search. Scholarly retrieval can use Crossref, OpenAlex, and Semantic Scholar when configured. Wikipedia/Wikimedia are excluded. The model-based selector is only allowed to return candidate IDs from the retrieved pool, so it cannot invent URLs. If model selection is disabled, unavailable, or rate-limited, deterministic scoring applies the same relevance/credibility/fit/diversity principles.

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
