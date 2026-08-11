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
