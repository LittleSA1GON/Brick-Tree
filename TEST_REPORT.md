# Brick Tree — Question-Analysis Verification Report

**Build:** 0.5.0 compact stateless Vercel edition  
**Date:** August 26, 2026

## Change verified

Tree now has a third intent: **Analyze a Question**.

It accepts open-ended or strategic prompts such as:

```text
How do I stay valuable as a software engineer in an AI-heavy future?
```

The Concept Architect produces 4–6 specific reasoning lenses inspired by **Who / What / Why / Where / How** (and When only when useful). The first layer uses `examines` edges; deeper expansion makes the selected lens more concrete instead of repeating generic 5W/H labels. Break Down, Trace to Roots, Brick Explore, and Brick Destination remain unchanged and share the same graph/runtime.

## Verification

### 1. TS/TSX syntax scan — PASS

```text
TS_FILES=69
SYNTAX_ERRORS=0
```

### 2. Project-local import resolution — PASS

```text
MISSING_LOCAL_IMPORTS=0
```

### 3. Clean-room structural TypeScript compile — PASS

A fresh copy without `node_modules` or build output was compiled with temporary external declaration stubs because the execution environment cannot install npm packages. Unused-local and unused-parameter checks were also enabled.

```text
CLEANROOM_STRUCTURAL_TYPECHECK_PASS
```

The temporary stubs are not included in the project archive. This is a structural check, not a substitute for a real dependency-aware `npm run typecheck`.

### 4. Question Tree behavioral smoke test — PASS

Production `visibleGraph`, traversal filtering, neighbor detection, and graph edge IDs were executed directly through `ts-node`.

Verified:

- `analyze-question` selects `examines` relationships;
- `contains` branches stay hidden while Question mode is active;
- `examines` branches reveal lazily from the selected root;
- generated-neighbor detection recognizes an already-built question lens.

```text
QUESTION_TREE_SMOKE_PASS
```

### 5. Question intent coverage — PASS

The codebase now includes:

- `analyze-question` in the shared traversal schema;
- portable-session validation for the new intent;
- `examines` in the relationship schema;
- Concept Architect instructions for Who/What/Why/Where/How-style analysis;
- Pedagogy Validator `question-analysis` fidelity checks;
- intent-aware graph filtering;
- UI intent selector, prompt copy, loading state, node expansion copy, and edge styling;
- API-routing and graph-isolation test coverage;
- support for longer root titles suitable for natural-language questions.

### 6. Runtime dependency audit — PASS

Runtime dependencies remain unchanged at **8**:

```text
@xyflow/react
elkjs
next
react
react-dom
zod
mammoth
pdf-parse
```

```text
UNUSED_RUNTIME=
UNDECLARED=
```

No dependency was added for the new mode.

### 7. Stateless/persistence audit — PASS

Production remains stateless on Vercel. No database, account, Blob, `localStorage`, or `sessionStorage` persistence was reintroduced.

```text
STATELESS_AUDIT_PASS
```

### 8. Placeholder/stale-code scan — PASS

```text
PLACEHOLDER_AUDIT_PASS
```

### 9. Test suite inventory

```text
TEST_FILES=11
TEST_CASES=40
```

New tests cover API routing for `analyze-question`, schema acceptance, and `examines`-edge isolation.

### 10. npm package dry run — PASS

```text
PACK_FILES=79
PACK_SIZE=78554
```

### 11. Real installed-dependency build — ENVIRONMENT BLOCKED

The npm registry remains unreachable from this execution environment; the latest `npm ping` timed out. Therefore these commands cannot truthfully be marked as executed here:

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

The repository retains:

```bash
npm install
npm run check
```

`npm run check` runs dependency-aware TypeScript, ESLint, Vitest, and a Next.js production build on Vercel/CI or any machine with npm registry access.

## Current source footprint

```text
57 production TS/TSX files
69 total TS/TSX files
6190 TS/TSX lines
8 runtime dependencies
7 development dependencies
```
