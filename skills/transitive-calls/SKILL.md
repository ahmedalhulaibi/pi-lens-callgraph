---
name: transitive-calls
description: Run the registered Fabric provider for lazy, workspace-only transitive function and method call traversal using pi-lens.
---

# Transitive Calls

Use when the user provides an exact function or method signature and asks where it is used or what it calls.

Call the registered Fabric provider action `callgraph.transitive_calls` with explicit `path`, `line`, `symbol`, `workspaceRoot`, `direction`, `maxDepth`, and `maxNodes` values. Use direction `1` for incoming, `2` for outgoing, or `3` for both. `regexPatterns` is optional. Do not invent a target or local path. The provider requires Fabric's captured-tool bridge and pi-lens's `extensions.lsp_navigation` capability.

The result is `{ incoming?, outgoing? }`; return direct and transitive results with file paths, line ranges, depths, direction, boundary crossings, filtered provenance, and truncation status.

## Example

Call the provider through Fabric:

```ts
const result = await tools.call({
  ref: "callgraph.transitive_calls",
  args: {
    path: "/workspace/src/service.ts",
    line: 42,
    symbol: "handleRequest",
    workspaceRoot: "/workspace",
    direction: 3, // 1 = incoming, 2 = outgoing, 3 = both
    maxDepth: 4,
    maxNodes: 100,
  },
});

return result;
```

`path` is the target source file and must be inside `workspaceRoot`. `line` and `symbol` identify the root declaration for LSP call hierarchy preparation. The result contains only the requested `incoming` and/or `outgoing` branches. Each branch includes `root`, `nodes`, `edges`, `boundaries`, and `truncated`.

Do not import the `.fabric.ts` source file or call `globalThis.transitiveCalls`; use `tools.call` with `callgraph.transitive_calls`.
