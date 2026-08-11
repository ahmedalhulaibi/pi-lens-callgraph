---
name: transitive-calls
description: Run the generic Fabric wrapper for lazy, workspace-only transitive function and method call traversal using pi-lens.
---

# Transitive Calls

Use when the user provides an exact function or method signature and asks where it is used or what it calls.

Read `scripts/transitive-calls.fabric.ts` from this package and execute its `transitiveCalls` function through Fabric with explicit `path`, `line`, `symbol`, `workspaceRoot`, `direction`, `maxDepth`, and `maxNodes` values. Use direction `1` for incoming, `2` for outgoing, or `3` for both. `regexPatterns` is optional. Do not invent a target or local path. Require `extensions.lsp_navigation`; report the dependency clearly when pi-lens is unavailable.

The result is `{ incoming?, outgoing? }`; return direct and transitive results with file paths, line ranges, depths, direction, boundary crossings, filtered provenance, and truncation status.

## Example

Call the registered tool through Fabric:

```ts
const result = await extensions.transitive_calls({
  path: "/workspace/src/service.ts",
  line: 42,
  symbol: "handleRequest",
  workspaceRoot: "/workspace",
  direction: 3, // 1 = incoming, 2 = outgoing, 3 = both
  maxDepth: 4,
  maxNodes: 100,
});

return result;
```

`path` is the target source file and must be inside `workspaceRoot`. `line` and `symbol` identify the root declaration for LSP call hierarchy preparation. The result contains only the requested `incoming` and/or `outgoing` branches. Each branch includes `root`, `nodes`, `edges`, `boundaries`, and `truncated`.

Do not import the `.fabric.ts` source file or call `globalThis.transitiveCalls`; use the registered `extensions.transitive_calls` tool. The tool requires pi-lens to provide the captured `extensions.lsp_navigation` capability.
