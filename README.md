# pi-lens-callgraph

Workspace-bounded transitive function and method traversal over pi-lens LSP call hierarchy.

## Requirements

- Pi with Fabric
- pi-lens with `extensions.lsp_navigation`

## Install

```sh
pi install git:github.com/ahmedalhulaibi/pi-lens-callgraph@v0.1.0
```

## Transitive calls

`scripts/transitive-calls.fabric.ts` requires:

- `path`
- `line`
- `symbol`
- `workspaceRoot`
- `direction`: `1` incoming, `2` outgoing, `3` both
- `maxDepth`
- `maxNodes`
- `regexPatterns` (optional)

`transitiveCallsEffect(options, dependencies?)` is the typed Effect API. It returns `{ incoming?, outgoing? }` and omits unrequested directions. `incomingCallsEffect` and `outgoingCallsEffect` expose one direction for an existing call-hierarchy root.

The async `transitiveCalls`, `incomingCalls`, and `outgoingCalls` adapters preserve awaitable Fabric use. Tests can inject `LspNavigation` through `TransitiveDependencies`; production uses `extensions.lsp_navigation`.

Each branch contains deterministic workspace nodes and coherent edges, excluded boundary crossings, and a `truncated` annotation. Nodes contain one-based inclusive declaration and selection line ranges. Regex-matched nodes remain as `status: "filtered"` provenance records with every matching pattern and are not expanded.

Typed failures use `TransitiveCallError` with a branchable category:

- `invalid_input`
- `dependency_unavailable`
- `provider_response`
- `workspace_boundary`
- `traversal_failed`

## Development

```sh
npm install
git config core.hooksPath .githooks
npm test
npm run check
```

The pre-commit hook applies Biome fixes to staged JavaScript, JSON, and TypeScript files, runs the snapshot suite, and re-stages the fixes.
