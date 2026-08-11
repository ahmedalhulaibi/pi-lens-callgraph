---
name: transitive-calls
description: Run the generic Fabric wrapper for lazy, workspace-only transitive function and method call traversal using pi-lens.
---

# Transitive Calls

Use when the user provides an exact function or method signature and asks where it is used or what it calls.

Read `scripts/transitive-calls.fabric.ts` from this package and execute its `transitiveCalls` function through Fabric with explicit `path`, `line`, `symbol`, `workspaceRoot`, `direction`, `maxDepth`, and `maxNodes` values. Use direction `1` for incoming, `2` for outgoing, or `3` for both. `regexPatterns` is optional. Do not invent a target or local path. Require `extensions.lsp_navigation`; report the dependency clearly when pi-lens is unavailable.

The result is `{ incoming?, outgoing? }`; return direct and transitive results with file paths, line ranges, depths, direction, boundary crossings, filtered provenance, and truncation status.
