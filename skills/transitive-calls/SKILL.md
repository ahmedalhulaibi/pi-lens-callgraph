---
name: transitive-calls
description: Run the registered Fabric provider for lazy, workspace-only transitive function and method call traversal using pi-lens.
---

# Transitive Calls

Use when the user provides an exact function or method signature and asks where it is used, what it calls, or how to analyse the call paths.

## Acquire the call graph

Call the registered Fabric provider action `callgraph.transitive_calls` with explicit `path`, `line`, `symbol`, `workspaceRoot`, `direction`, `maxDepth`, and `maxNodes` values. Use direction `1` for incoming callers, `2` for outgoing callees, or `3` for both. `regexPatterns` is optional. Do not invent a target or local path. The provider requires Fabric's captured-tool bridge and pi-lens's `extensions.lsp_navigation` capability.

```ts
const graph = await tools.call({
  ref: "callgraph.transitive_calls",
  args: {
    path: "/workspace/src/service.ts",
    line: 42, // zero-based source line
    symbol: "handleRequest",
    workspaceRoot: "/workspace",
    direction: 3, // 1 = incoming, 2 = outgoing, 3 = both
    maxDepth: 4,
    maxNodes: 100,
    // regexPatterns: ["/generated/", "vendor"],
  },
});

return graph;
```

`path` must be inside `workspaceRoot`. `line` and `symbol` identify the root declaration for LSP call-hierarchy preparation. The result is `{ incoming?, outgoing? }`; it contains only the requested directions. Each branch includes `root`, `nodes`, `edges`, `boundaries`, and `truncated`. Nodes have one-based inclusive declaration and selection line ranges. A node matching `regexPatterns` remains as a `status: "filtered"` provenance record and is not expanded.

Do not import `scripts/transitive-calls.fabric.ts` or call `globalThis.transitiveCalls`; use `tools.call` with `callgraph.transitive_calls`.

## Chain the workflow scripts

The repository's script modules form this pipeline:

```text
callgraph.transitive_calls
  -> branches.fabric.ts       distinct paths
  -> expand-branches.fabric.ts lazy source reads
  -> branch-agents.fabric.ts  one agent call per path
```

Use these helper modules from a workflow or extension after acquiring the graph through Fabric.

### 1. Enumerate paths with `branches.fabric.ts`

`distinctBranches` converts one directional graph into root-to-leaf paths. For a both-direction graph, it creates the Cartesian product of terminal incoming and outgoing paths and includes the shared root once.

```ts
import { distinctBranches } from "./scripts/branches.fabric";

const branches = distinctBranches({
  incoming: graph.incoming,
  outgoing: graph.outgoing,
});

for (const [branchIndex, branch] of branches.entries()) {
  console.log({
    branchIndex,
    direction: branch.direction,
    symbols: branch.nodes.map((node) => node.name),
    boundaries: branch.boundaries,
    truncated: branch.truncated,
  });
}
```

For a one-direction request, pass that branch directly:

```ts
const outgoingBranches = distinctBranches(graph.outgoing);
```

Incoming paths are ordered from root toward caller. Outgoing paths are ordered from root toward callee. Cycles are not revisited.

### 2. Read declarations lazily with `expand-branches.fabric.ts`

`expandBranches` yields one branch at a time. It does not read source until `node.read()` is called. The `read` dependency receives a filesystem path, a one-based line `offset`, and an inclusive `limit`.

```ts
import { readFile } from "node:fs/promises";
import { expandBranches } from "./scripts/expand-branches.fabric";

const read = async ({ path, offset, limit }) => {
  const lines = (await readFile(path, "utf8")).split(/\r?\n/);
  return {
    text: lines.slice(offset - 1, offset - 1 + limit).join("\n"),
  };
};

for await (const branch of expandBranches(graph, { read })) {
  for (const node of branch.nodes) {
    const source = await node.read();
    console.log({ branch: branch.direction, symbol: node.name, source });
  }
}
```

A node with `path: null` cannot be read. Boundaries are metadata, not nodes in a yielded branch.

### 3. Analyse paths with `branch-agents.fabric.ts`

`consumeBranches` enumerates distinct branches, reads every node in each branch, freezes the evidence, and calls `runAgent` once per branch. It returns an Effect.

```ts
import { Effect } from "effect";
import { consumeBranches } from "./scripts/branch-agents.fabric";

const analyses = await Effect.runPromise(
  consumeBranches(graph, {
    read,
    runAgent: async ({ branchIndex, evidence, contents }) => ({
      text: await analyseBranch({ branchIndex, evidence, contents }),
    }),
  }),
);

for (const result of analyses) {
  console.log(result.branchIndex, result.analysis.text);
}
```

`runAgent` receives immutable graph evidence plus source contents in node order. Replace `analyseBranch` with the workflow's model or agent gateway. The consumer uses unbounded Effect concurrency; add an application-level queue or limit when the gateway has a concurrency limit.

## Complete chained example

This example acquires both directions, turns them into joined paths, and sends each path to an agent. The imports are for a workflow extension; the initial traversal still uses the public Fabric action.

```ts
import { Effect } from "effect";
import { consumeBranches } from "./scripts/branch-agents.fabric";
import { read } from "./workspace-reader";

const graph = await tools.call({
  ref: "callgraph.transitive_calls",
  args: {
    path: "/workspace/src/service.ts",
    line: 42,
    symbol: "handleRequest",
    workspaceRoot: "/workspace",
    direction: 3,
    maxDepth: 4,
    maxNodes: 100,
  },
});

if (!graph.incoming || !graph.outgoing) {
  throw new Error("expected both call directions");
}

const analyses = await Effect.runPromise(
  consumeBranches(
    { incoming: graph.incoming, outgoing: graph.outgoing },
    {
      read,
      runAgent: ({ branchIndex, evidence, contents }) =>
        analyseBranch({ branchIndex, evidence, contents }),
    },
  ),
);

return analyses;
```

Use `expandBranches` instead of `consumeBranches` when the workflow must choose which declarations to read or perform a non-agent analysis:

```ts
for await (const branch of expandBranches(graph, { read })) {
  const declarations = await Promise.all(
    branch.nodes.map((node) => node.read()),
  );
  await inspectBranch(branch, declarations);
}
```

## Chain another traversal

A returned node can seed a second public traversal. Convert its one-based selection line to the provider's zero-based `line` argument and keep the same workspace boundary:

```ts
const terminal = graph.outgoing?.nodes.at(-1);
if (terminal?.path) {
  const nextGraph = await tools.call({
    ref: "callgraph.transitive_calls",
    args: {
      path: terminal.path,
      line: terminal.ranges.selection.start - 1,
      symbol: terminal.name,
      workspaceRoot: "/workspace",
      direction: 2,
      maxDepth: 2,
      maxNodes: 25,
    },
  });

  return { first: graph, next: nextGraph };
}
```

Deduplicate node keys and retain depth/node caps across the overall workflow.

## Errors

Typed failures use `TransitiveCallError` with a branchable category:

- `invalid_input`
- `dependency_unavailable`
- `provider_response`
- `workspace_boundary`
- `traversal_failed`

The branch consumer uses `BranchConsumerError` with `invalid_evidence`, `read_failed`, or `agent_failed` categories.
