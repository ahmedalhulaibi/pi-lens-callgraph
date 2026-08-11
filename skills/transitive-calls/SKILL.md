---
name: transitive-calls
description: Run the generic Fabric wrapper for lazy, workspace-only transitive function and method call traversal using pi-lens.
---

# Transitive Calls

Use when the user provides an exact function or method signature and asks where it is used or what it calls.

Read `scripts/transitive-calls.fabric.ts` from this package and execute its `transitiveCalls` function through Fabric with explicit `path`, `line`, `symbol`, `workspaceRoot`, `direction`, `maxDepth`, and `maxNodes` values. Do not invent a target or local path. Require `extensions.lsp_navigation`; report the dependency clearly when pi-lens is unavailable.

Return direct and transitive results with file paths, depths, boundary crossings, and truncation status.
