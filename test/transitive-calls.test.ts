import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type FixtureItem,
	fixture,
	fixtureFiles,
} from "../testdata/fixtures/transitive-call-graph";

type NavigationArgs = Record<string, unknown>;
type ToolResult = { text: string };
type TransitiveCalls = (options: Record<string, unknown>) => Promise<unknown>;
type Harness = {
	read: ReturnType<typeof vi.fn>;
	lspNavigation: ReturnType<typeof vi.fn>;
	trace: Array<Record<string, unknown>>;
	transitiveCalls: TransitiveCalls;
};
const item = (value: FixtureItem): FixtureItem => structuredClone(value);
const loadImplementation = async (harness: Harness): Promise<void> => {
	(
		globalThis as typeof globalThis & { extensions: Record<string, unknown> }
	).extensions = { lsp_navigation: harness.lspNavigation, read: harness.read };
	await import("../scripts/transitive-calls.fabric.ts");
	harness.transitiveCalls = (
		globalThis as typeof globalThis & { transitiveCalls: TransitiveCalls }
	).transitiveCalls;
};
const makeHarness = (): Harness => {
	const trace: Array<Record<string, unknown>> = [];
	const read = vi.fn(async (path: string) => {
		trace.push({ phase: "read", path });
		return fixtureFiles[path as keyof typeof fixtureFiles] ?? "";
	});
	const lspNavigation = vi.fn(
		async (args: NavigationArgs): Promise<ToolResult> => {
			const operation = String(args.operation);
			if (operation === "prepareCallHierarchy") {
				trace.push({
					phase: "prepare",
					operation,
					path: args.path,
					line: args.line,
					symbol: args.symbol,
				});
				return { text: JSON.stringify({ result: [item(fixture.root)] }) };
			}
			const current = args.callHierarchyItem as FixtureItem;
			trace.push({ phase: "walk", operation, symbol: current.name });
			if (operation === "incomingCalls" && current.name === fixture.root.name)
				return {
					text: JSON.stringify({
						result: [{ from: item(fixture.incoming), to: item(fixture.root) }],
					}),
				};
			if (operation === "outgoingCalls" && current.name === fixture.root.name)
				return {
					text: JSON.stringify({
						result: [{ from: item(fixture.root), to: item(fixture.outgoing) }],
					}),
				};
			return { text: JSON.stringify({ result: [] }) };
		},
	);
	return { read, lspNavigation, trace, transitiveCalls: undefined as never };
};
const options = {
	path: "/fixtures/workspace/root.ts",
	line: 5,
	symbol: "root",
	workspaceRoot: fixture.workspaceRoot,
	direction: 3,
	maxDepth: 2,
	maxNodes: 10,
};
describe("transitive call snapshot foundation", () => {
	let harness: Harness;
	beforeEach(async () => {
		harness = makeHarness();
		await loadImplementation(harness);
	});
	it("snapshots fixture, prepare, walk, result, and dependency trace phases", async () => {
		const result = await harness.transitiveCalls(options);
		expect({
			fixture: {
				workspaceRoot: fixture.workspaceRoot,
				files: fixtureFiles,
				root: fixture.root.name,
			},
			phases: ["fixture", "prepare", "walk", "result"],
			result,
			dependencyTrace: {
				lspNavigation: harness.trace,
				read: harness.read.mock.calls,
			},
		}).toMatchSnapshot();
	});
});
