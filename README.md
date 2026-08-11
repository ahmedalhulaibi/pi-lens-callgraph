# pi-lens-callgraph

Lazy, workspace-bounded transitive function and method traversal over pi-lens LSP call hierarchy.

## Requirements

- Pi with Fabric
- pi-lens with `extensions.lsp_navigation`

## Install

```sh
pi install git:github.com/ahmedalhulaibi/pi-lens-callgraph@v0.1.0
```

## Wrapper

`scripts/transitive-calls.fabric.ts` requires an explicit target signature:

- `path`
- `line`
- `symbol`
- `workspaceRoot`
- `direction`
- `maxDepth`
- `maxNodes`

It returns workspace nodes and edges plus excluded boundary crossings. Each node includes one-based declaration and selection line ranges. It does not assume a local path or symbol.
