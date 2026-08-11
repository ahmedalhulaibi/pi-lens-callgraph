import type {
	BothBranchGraph,
	BranchGraph,
	DistinctBranch,
	JoinedBranch,
} from "./branches.fabric";
import type { Edge, NodeRecord } from "./transitive-calls.fabric";

export type ReadRange = {
	path: string;
	offset: number;
	limit: number;
};

export type ReadResult = { text?: string; content?: unknown[] };
export type ReadDependency = (range: ReadRange) => Promise<ReadResult>;

export type ExpandedNode = Pick<
	NodeRecord,
	"key" | "name" | "path" | "ranges"
> & {
	read: () => Promise<ReadResult>;
};

export type ExpandedBranch = {
	direction: DistinctBranch["direction"] | JoinedBranch["direction"];
	nodes: ExpandedNode[];
};

const directionalBranches = function* (
	graph: BranchGraph,
): Generator<DistinctBranch> {
	const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
	const outgoing = graph.direction === "outgoing";

	function* visit(
		rootToCurrent: string[],
		rootToCurrentEdges: Edge[],
		current: string,
	): Generator<DistinctBranch> {
		for (const edge of graph.edges) {
			if (edge.direction !== graph.directionBit) continue;
			const next = outgoing
				? edge.from === current
					? edge.to
					: undefined
				: edge.to === current
					? edge.from
					: undefined;
			if (next === undefined || rootToCurrent.includes(next)) continue;

			const rootToNext = [...rootToCurrent, next];
			const rootToNextEdges = [...rootToCurrentEdges, edge];
			yield* visit(rootToNext, rootToNextEdges, next);
			const keys = outgoing ? rootToNext : [...rootToNext].reverse();
			const keySet = new Set(keys);
			yield {
				direction: graph.direction,
				directionBit: graph.directionBit,
				nodes: keys.flatMap((key) => {
					const node = nodesByKey.get(key);
					return node === undefined ? [] : [node];
				}),
				edges: outgoing ? rootToNextEdges : [...rootToNextEdges].reverse(),
				boundaries: graph.boundaries.filter(
					(boundary) => keySet.has(boundary.from) || keySet.has(boundary.to),
				),
				truncated: graph.truncated,
			};
		}
	}

	yield* visit([graph.root.key], [], graph.root.key);
};

const terminalBranches = function* (
	graph: BranchGraph,
): Generator<DistinctBranch> {
	const outgoing = graph.direction === "outgoing";
	const expandable = new Set(
		graph.edges
			.filter((edge) => edge.direction === graph.directionBit)
			.map((edge) => (outgoing ? edge.from : edge.to)),
	);
	for (const branch of directionalBranches(graph)) {
		const terminal = outgoing ? branch.nodes.at(-1) : branch.nodes[0];
		if (terminal !== undefined && !expandable.has(terminal.key)) yield branch;
	}
};

const lazyBranches = function* (
	graph: BranchGraph | BothBranchGraph,
): Generator<DistinctBranch | JoinedBranch> {
	if ("nodes" in graph) {
		yield* directionalBranches(graph);
		return;
	}

	for (const incoming of terminalBranches(graph.incoming)) {
		for (const outgoing of terminalBranches(graph.outgoing)) {
			yield {
				direction: "both",
				directionBit: 3,
				nodes: [...incoming.nodes, ...outgoing.nodes.slice(1)],
				edges: [...incoming.edges, ...outgoing.edges],
				boundaries: [...incoming.boundaries, ...outgoing.boundaries],
				truncated: incoming.truncated || outgoing.truncated,
			};
		}
	}
};

const expandNode = (node: NodeRecord, read: ReadDependency): ExpandedNode => ({
	key: node.key,
	name: node.name,
	path: node.path,
	ranges: node.ranges,
	read: async () => {
		if (node.path === null)
			throw new Error("cannot read a node without a path");
		return read({
			path: node.path,
			offset: node.ranges.declaration.start,
			limit: node.ranges.declaration.end - node.ranges.declaration.start + 1,
		});
	},
});

export async function* expandBranches(
	graph: BranchGraph | BothBranchGraph,
	dependencies: { read: ReadDependency },
): AsyncGenerator<ExpandedBranch> {
	for (const branch of lazyBranches(graph)) {
		yield {
			direction: branch.direction,
			nodes: branch.nodes.map((node) => expandNode(node, dependencies.read)),
		};
	}
}
