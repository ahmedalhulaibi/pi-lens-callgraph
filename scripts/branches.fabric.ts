import type { BranchResult, Edge } from "./transitive-calls.fabric";

export type BranchGraph = BranchResult;
export type BothBranchGraph = {
	incoming: BranchGraph;
	outgoing: BranchGraph;
};
export type DistinctBranch = Omit<BranchResult, "root">;
export type JoinedBranch = Omit<
	DistinctBranch,
	"direction" | "directionBit"
> & {
	direction: "both";
	directionBit: 3;
};

const directionalBranches = (graph: BranchGraph): DistinctBranch[] => {
	const nodesByKey = new Map(graph.nodes.map((node) => [node.key, node]));
	const branches: DistinctBranch[] = [];
	const outgoing = graph.direction === "outgoing";

	const visit = (
		rootToCurrent: string[],
		rootToCurrentEdges: Edge[],
		current: string,
	): void => {
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
			const keys = outgoing ? rootToNext : [...rootToNext].reverse();
			const keySet = new Set(keys);
			const nodes = keys.flatMap((key) => {
				const node = nodesByKey.get(key);
				return node === undefined ? [] : [node];
			});
			visit(rootToNext, rootToNextEdges, next);
			branches.push({
				direction: graph.direction,
				directionBit: graph.directionBit,
				nodes,
				edges: outgoing ? rootToNextEdges : [...rootToNextEdges].reverse(),
				boundaries: graph.boundaries.filter(
					(boundary) => keySet.has(boundary.from) || keySet.has(boundary.to),
				),
				truncated: graph.truncated,
			});
		}
	};

	visit([graph.root.key], [], graph.root.key);
	return branches;
};

const terminalBranches = (graph: BranchGraph): DistinctBranch[] => {
	const outgoing = graph.direction === "outgoing";
	const expandable = new Set(
		graph.edges
			.filter((edge) => edge.direction === graph.directionBit)
			.map((edge) => (outgoing ? edge.from : edge.to)),
	);
	return directionalBranches(graph).filter((branch) => {
		const terminal = outgoing ? branch.nodes.at(-1) : branch.nodes[0];
		return terminal !== undefined && !expandable.has(terminal.key);
	});
};

export const distinctBranches = (
	graph: BranchGraph | BothBranchGraph,
): Array<DistinctBranch | JoinedBranch> => {
	if ("nodes" in graph) return directionalBranches(graph);

	const incoming = terminalBranches(graph.incoming);
	const outgoing = terminalBranches(graph.outgoing);
	return incoming.flatMap((incomingBranch) =>
		outgoing.map((outgoingBranch) => ({
			direction: "both" as const,
			directionBit: 3 as const,
			nodes: [...incomingBranch.nodes, ...outgoingBranch.nodes.slice(1)],
			edges: [...incomingBranch.edges, ...outgoingBranch.edges],
			boundaries: [...incomingBranch.boundaries, ...outgoingBranch.boundaries],
			truncated: incomingBranch.truncated || outgoingBranch.truncated,
		})),
	);
};
