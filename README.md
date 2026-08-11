9tf│# pi-lens-callgraph
AuN│
ShG│Lazy, workspace-bounded transitive function and method traversal over pi-lens LSP call hierarchy.
TiH│
2sB│## Requirements
3tC│
fJ6│- Pi with Fabric
LY7│- pi-lens with `extensions.lsp_navigation`
MZ8│
FVY│## Install
GWZ│
B3i│```sh
a4g│pi install git:github.com/ahmedalhulaibi/pi-lens-callgraph@v0.1.0
Tio│```
Ujp│
uEJ│## Wrapper
vFK│
Rlc│`scripts/transitive-calls.fabric.ts` requires an explicit target signature:
Smd│
MPC│- `path`
904│- `line`
KDO│- `symbol`
s2L│- `workspaceRoot`
uo9│- `direction`: `1` incoming, `2` outgoing, `3` both
is4│- `maxDepth`
3Ix│- `maxNodes`
AGu│- `regexPatterns` (optional)
BHv│
4GA│It returns `{ incoming?, outgoing? }`, omitting unrequested branches. Each branch returns workspace nodes and edges plus excluded boundary crossings. Matching nodes remain as `status: "filtered"` provenance records and are not expanded. Each node includes one-based declaration and selection line ranges. It does not assume a local path or symbol.

## Development

Install the development dependency and enable the repository hook:

```sh
npm install
git config core.hooksPath .githooks
```

The pre-commit hook runs `biome check --write` on staged JavaScript, JSON, and TypeScript files, then re-stages automatic fixes. Run `npm run check` manually for the same validation.
