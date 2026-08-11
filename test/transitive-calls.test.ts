import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	type DirectionBit,
	incomingCalls,
	incomingCallsEffect,
	type LspNavigation,
	outgoingCalls,
	outgoingCallsEffect,
	type TransitiveOptions,
	transitiveCalls,
	transitiveCallsEffect,
} from "../scripts/transitive-calls.fabric";
import {
	type FixtureItem,
	fixture,
} from "../testdata/fixtures/transitive-call-graph";

type HarnessOptions = {
	reverse?: boolean;
	root?: FixtureItem;
	malformedPrepare?: unknown;
	malformedOperation?: "incomingCalls" | "outgoingCalls";
};

type TraceEvent = {
	operation: string;
	symbol?: string;
	path?: unknown;
	line?: unknown;
};

const clone = (value: FixtureItem): FixtureItem => structuredClone(value);
const payload = (result: unknown): { text: string } => ({
	text: JSON.stringify({ result }),
});

const makeHarness = (settings: HarnessOptions = {}) => {
	const trace: TraceEvent[] = [];
	const lspNavigation = vi.fn<LspNavigation>(async (args) => {
		const operation = String(args.operation);
		if (operation === "prepareCallHierarchy") {
			trace.push({
				operation,
				path: args.path,
				line: args.line,
			});
			if (settings.malformedPrepare !== undefined)
				return { text: JSON.stringify(settings.malformedPrepare) };
			return payload([clone(settings.root ?? fixture.root)]);
		}

		const current = args.callHierarchyItem as FixtureItem;
		trace.push({ operation, symbol: current.name });
		if (settings.malformedOperation === operation) return payload([{}]);
		const graph =
			operation === "incomingCalls"
				? fixture.incomingCalls
				: fixture.outgoingCalls;
		const values = [...graph[current.name as keyof typeof graph]];
		if (settings.reverse) values.reverse();
		return payload(
			values.map((target) =>
				operation === "incomingCalls"
					? { from: clone(target), to: clone(current) }
					: { from: clone(current), to: clone(target) },
			),
		);
	});
	return { dependencies: { lspNavigation }, trace };
};

const options: TransitiveOptions = {
	path: "/fixtures/workspace/root.ts",
	line: 5,
	symbol: "root",
	workspaceRoot: fixture.workspaceRoot,
	direction: 3,
	maxDepth: 4,
	maxNodes: 20,
};

const errorMessage = async (run: () => Promise<unknown>): Promise<string> => {
	try {
		await run();
		return "NO_ERROR";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

describe.each([
	["incoming", 1],
	["outgoing", 2],
	["both", 3],
] as const)("direction %s", (label, direction) => {
	it("snapshots the complete directional contract and dependency trace", async () => {
		const harness = makeHarness();
		const result = await transitiveCalls(
			{ ...options, direction: direction as DirectionBit },
			harness.dependencies,
		);
		expect({ label, result, trace: harness.trace }).toMatchSnapshot();
	});
});

describe.each([
	["filtered provenance", { regexPatterns: ["generated", "calleeB"] }],
	["depth truncation", { maxDepth: 1 }],
	["node truncation", { maxNodes: 2 }],
	["filesystem root workspace", { workspaceRoot: "/" }],
] as const)("scenario %s", (label, override) => {
	it("snapshots annotations and graph coherence", async () => {
		const harness = makeHarness();
		const result = await transitiveCalls(
			{ ...options, ...override },
			harness.dependencies,
		);
		expect({ label, result, trace: harness.trace }).toMatchSnapshot();
	});
});

it("is deterministic when the LSP returns calls in a different order", async () => {
	const forward = makeHarness();
	const reversed = makeHarness({ reverse: true });
	expect({
		forward: await transitiveCalls(options, forward.dependencies),
		reversed: await transitiveCalls(options, reversed.dependencies),
	}).toMatchSnapshot();
});

it.each([
	["missing options", null],
	["empty path", { path: "" }],
	["negative line", { line: -1 }],
	["empty symbol", { symbol: "" }],
	["empty workspace", { workspaceRoot: "" }],
	["non-string workspace", { workspaceRoot: 42 }],
	["invalid direction", { direction: 4 }],
	["negative depth", { maxDepth: -1 }],
	["zero nodes", { maxNodes: 0 }],
	["non-array patterns", { regexPatterns: "generated" }],
	["malformed pattern", { regexPatterns: ["["] }],
] as const)("snapshots input error: %s", async (label, override) => {
	const harness = makeHarness();
	const value =
		override === null
			? null
			: ({ ...options, ...override } as unknown as TransitiveOptions);
	expect({
		label,
		error: await errorMessage(() =>
			transitiveCalls(value as TransitiveOptions, harness.dependencies),
		),
		trace: harness.trace,
	}).toMatchSnapshot();
});

it.each([
	["null envelope", { malformedPrepare: null }],
	["missing result", { malformedPrepare: {} }],
	["invalid prepared item", { malformedPrepare: { result: [{}] } }],
	["invalid outgoing call", { malformedOperation: "outgoingCalls" }],
	["root outside workspace", { root: fixture.nodes.outside }],
	[
		"dot-segment root outside workspace",
		{
			root: {
				...fixture.root,
				uri: "file:///fixtures/workspace/../external/root.ts",
			},
		},
	],
] as const)("snapshots provider error: %s", async (label, settings) => {
	const harness = makeHarness(settings as HarnessOptions);
	expect({
		label,
		error: await errorMessage(() =>
			transitiveCalls(options, harness.dependencies),
		),
		trace: harness.trace,
	}).toMatchSnapshot();
});

it.each([
	["incoming", incomingCalls, 1],
	["outgoing", outgoingCalls, 2],
] as const)(
	"snapshots the public %s API",
	async (label, operation, direction) => {
		const harness = makeHarness();
		const result = await operation(
			{ ...options, direction: direction as DirectionBit },
			fixture.root,
			harness.dependencies,
		);
		expect({ label, result, trace: harness.trace }).toMatchSnapshot();
	},
);

it.each([
	[
		"invalid input",
		() =>
			transitiveCallsEffect(
				{ ...options, path: "" },
				makeHarness().dependencies,
			),
	],
	[
		"dependency unavailable",
		() =>
			incomingCallsEffect(options, fixture.root, {
				lspNavigation: null as unknown as LspNavigation,
			}),
	],
	[
		"provider response",
		() =>
			outgoingCallsEffect(options, fixture.root, {
				lspNavigation: async () => ({ content: [null] }) as never,
			}),
	],
	[
		"workspace boundary",
		() =>
			incomingCallsEffect(
				options,
				fixture.nodes.outside,
				makeHarness().dependencies,
			),
	],
	[
		"traversal failed",
		() =>
			outgoingCallsEffect(options, fixture.root, {
				lspNavigation: async () => {
					throw new Error("transport must be reset");
				},
			}),
	],
] as const)("snapshots typed error category: %s", async (label, operation) => {
	const outcome = await Effect.runPromise(
		Effect.match(operation(), {
			onFailure: (error) => ({
				_tag: error._tag,
				category: error.category,
				message: error.message,
			}),
			onSuccess: () => ({ _tag: "Success" }),
		}),
	);
	expect({ label, outcome }).toMatchSnapshot();
});

describe("distinct directional branches", () => {
	const node = (
		key: string,
		depth: number,
		direction: "incoming" | "outgoing",
		status: "included" | "filtered" = "included",
	) => ({
		key,
		name: key,
		path: `/fixtures/workspace/${key}.ts`,
		ranges: {
			declaration: { start: depth * 10 + 1, end: depth * 10 + 3 },
			selection: { start: depth * 10 + 1, end: depth * 10 + 1 },
		},
		depth,
		direction,
		status,
		...(status === "filtered" ? { filteredBy: ["generated", "vendor"] } : {}),
	});

	it.each([
		{
			label:
				"incoming leaf-to-root; catches induced edges, reversed paths, and dropped annotations",
			direction: "incoming" as const,
			directionBit: 1 as const,
			nodes: [
				node("root", 0, "incoming"),
				node("parent", 1, "incoming"),
				node("leaf", 2, "incoming"),
				node("filtered", 1, "incoming", "filtered"),
			],
			edges: [
				{ from: "parent", to: "root", direction: 1 as const },
				{ from: "leaf", to: "parent", direction: 1 as const },
				{ from: "leaf", to: "root", direction: 1 as const },
				{ from: "filtered", to: "root", direction: 1 as const },
			],
			boundary: {
				from: "outside",
				to: "parent",
				direction: 1 as const,
				target: "outside",
				uri: "file:///fixtures/external/outside.ts",
				reason: "outside_workspace" as const,
			},
		},
		{
			label:
				"outgoing root-to-leaf; catches induced edges, reversed paths, and dropped annotations",
			direction: "outgoing" as const,
			directionBit: 2 as const,
			nodes: [
				node("root", 0, "outgoing"),
				node("child", 1, "outgoing"),
				node("leaf", 2, "outgoing"),
				node("filtered", 1, "outgoing", "filtered"),
			],
			edges: [
				{ from: "root", to: "child", direction: 2 as const },
				{ from: "child", to: "leaf", direction: 2 as const },
				{ from: "root", to: "leaf", direction: 2 as const },
				{ from: "root", to: "filtered", direction: 2 as const },
			],
			boundary: {
				from: "child",
				to: "outside",
				direction: 2 as const,
				target: "outside",
				uri: "file:///fixtures/external/outside.ts",
				reason: "outside_workspace" as const,
			},
		},
	] as const)("$label", async (scenario) => {
		const { distinctBranches } = await import("../scripts/branches.fabric");
		const input = {
			root: scenario.nodes[0],
			direction: scenario.direction,
			directionBit: scenario.directionBit,
			nodes: [...scenario.nodes],
			edges: [...scenario.edges],
			boundaries: [scenario.boundary],
			truncated: true,
		};
		expect({
			label: scenario.label,
			branches: distinctBranches(input),
		}).toMatchSnapshot();
	});

	it.each([
		{
			label:
				"deep 2x2 leaf Cartesian product; catches intermediate-prefix joins, zipped branches, duplicate roots, and lost directional provenance",
			incoming: {
				root: node("root", 0, "incoming"),
				direction: "incoming" as const,
				directionBit: 1 as const,
				nodes: [
					node("root", 0, "incoming"),
					node("parent-a", 1, "incoming"),
					node("parent-b", 1, "incoming"),
					node("caller-a", 2, "incoming"),
					node("caller-b", 2, "incoming", "filtered"),
				],
				edges: [
					{ from: "caller-a", to: "parent-a", direction: 1 as const },
					{ from: "parent-a", to: "root", direction: 1 as const },
					{ from: "caller-b", to: "parent-b", direction: 1 as const },
					{ from: "parent-b", to: "root", direction: 1 as const },
				],
				boundaries: [],
				truncated: false,
			},
			outgoing: {
				root: node("root", 0, "outgoing"),
				direction: "outgoing" as const,
				directionBit: 2 as const,
				nodes: [
					node("root", 0, "outgoing"),
					node("child-a", 1, "outgoing"),
					node("child-b", 1, "outgoing"),
					node("callee-a", 2, "outgoing"),
					node("callee-b", 2, "outgoing", "filtered"),
				],
				edges: [
					{ from: "root", to: "child-a", direction: 2 as const },
					{ from: "child-a", to: "callee-a", direction: 2 as const },
					{ from: "root", to: "child-b", direction: 2 as const },
					{ from: "child-b", to: "callee-b", direction: 2 as const },
				],
				boundaries: [],
				truncated: true,
			},
		},
	] as const)("$label", async ({ label, incoming, outgoing }) => {
		const { distinctBranches } = await import("../scripts/branches.fabric");
		expect({
			label,
			branches: distinctBranches({ incoming, outgoing }),
		}).toMatchSnapshot();
	});
	it.each([
		{
			label:
				"incoming branches; catches eager branch enumeration, eager file reads, zero-based offsets, and inclusive-range off-by-one errors",
			input: {
				root: node("root", 0, "incoming"),
				direction: "incoming" as const,
				directionBit: 1 as const,
				nodes: [
					node("root", 0, "incoming"),
					node("caller-a", 1, "incoming"),
					node("caller-b", 2, "incoming"),
				],
				edges: [
					{ from: "caller-a", to: "root", direction: 1 as const },
					{ from: "caller-b", to: "root", direction: 1 as const },
				],
				boundaries: [],
				truncated: false,
			},
		},
		{
			label:
				"outgoing branches; catches eager branch enumeration, reversed node order, and reads issued before a node is consumed",
			input: {
				root: node("root", 0, "outgoing"),
				direction: "outgoing" as const,
				directionBit: 2 as const,
				nodes: [
					node("root", 0, "outgoing"),
					node("callee-a", 1, "outgoing"),
					node("callee-b", 2, "outgoing"),
				],
				edges: [
					{ from: "root", to: "callee-a", direction: 2 as const },
					{ from: "root", to: "callee-b", direction: 2 as const },
				],
				boundaries: [],
				truncated: false,
			},
		},
	] as const)("$label", async ({ label, input }) => {
		const { expandBranches } = await import(
			"../scripts/expand-branches.fabric"
		);
		const reads: Array<{ path: string; offset: number; limit: number }> = [];
		const branchEnumerations: number[] = [];
		const boundaries = new Proxy(input.boundaries, {
			get(target, property, receiver) {
				if (property !== "filter")
					return Reflect.get(target, property, receiver);
				return (callback: Parameters<typeof target.filter>[0]) => {
					branchEnumerations.push(branchEnumerations.length + 1);
					return target.filter(callback);
				};
			},
		});
		const read = vi.fn(
			async (range: { path: string; offset: number; limit: number }) => {
				reads.push(range);
				return {
					text: `${range.path}:${range.offset}-${range.offset + range.limit - 1}`,
				};
			},
		);

		const iterator = expandBranches({ ...input, boundaries }, { read })[
			Symbol.asyncIterator
		]();
		const beforeBranch = {
			reads: [...reads],
			branchEnumerations: [...branchEnumerations],
		};
		const first = await iterator.next();
		const afterBranch = {
			reads: [...reads],
			branchEnumerations: [...branchEnumerations],
		};
		if (first.done) throw new Error("expected a first expanded branch");

		const expandedNodes = [];
		const readsAfterEachNode = [];
		for (const expandedNode of first.value.nodes) {
			expandedNodes.push({
				key: expandedNode.key,
				name: expandedNode.name,
				path: expandedNode.path,
				ranges: expandedNode.ranges,
				content: await expandedNode.read(),
			});
			readsAfterEachNode.push({
				node: expandedNode.key,
				reads: [...reads],
				branchEnumerations: [...branchEnumerations],
			});
		}
		const afterReads = {
			reads: [...reads],
			branchEnumerations: [...branchEnumerations],
		};
		const second = await iterator.next();
		if (second.done) throw new Error("expected a second expanded branch");

		expect({
			label,
			beforeBranch,
			afterBranch,
			branch: {
				direction: first.value.direction,
				nodes: expandedNodes,
			},
			readsAfterEachNode,
			afterReads,
			afterSecondBranch: {
				reads: [...reads],
				branchEnumerations: [...branchEnumerations],
				branch: {
					direction: second.value.direction,
					nodes: second.value.nodes.map(({ key, name, path, ranges }) => ({
						key,
						name,
						path,
						ranges,
					})),
				},
			},
		}).toMatchSnapshot();
	});
	it("expands the Cartesian both graph with one root and no eager reads", async () => {
		const { expandBranches } = await import(
			"../scripts/expand-branches.fabric"
		);
		const incoming = {
			root: node("root", 0, "incoming"),
			direction: "incoming" as const,
			directionBit: 1 as const,
			nodes: [
				node("root", 0, "incoming"),
				node("caller-a", 1, "incoming"),
				node("caller-b", 1, "incoming"),
			],
			edges: [
				{ from: "caller-a", to: "root", direction: 1 as const },
				{ from: "caller-b", to: "root", direction: 1 as const },
			],
			boundaries: [],
			truncated: false,
		};
		const outgoing = {
			root: node("root", 0, "outgoing"),
			direction: "outgoing" as const,
			directionBit: 2 as const,
			nodes: [
				node("root", 0, "outgoing"),
				node("callee-a", 1, "outgoing"),
				node("callee-b", 1, "outgoing"),
			],
			edges: [
				{ from: "root", to: "callee-a", direction: 2 as const },
				{ from: "root", to: "callee-b", direction: 2 as const },
			],
			boundaries: [],
			truncated: false,
		};
		const read = vi.fn(async () => ({ text: "unused" }));
		const branches = [];
		for await (const branch of expandBranches(
			{ incoming, outgoing },
			{ read },
		)) {
			branches.push({
				direction: branch.direction,
				nodes: branch.nodes.map((expandedNode) => expandedNode.key),
			});
		}
		expect({ branches, reads: read.mock.calls }).toMatchSnapshot();
	});
});
