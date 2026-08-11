import type { BranchResult, Edge } from "./transitive-calls.fabric";

export type BranchGraph = BranchResult;
export type DistinctBranch = Omit<BranchResult, "root">;

export const distinctBranches = (graph: BranchGraph): DistinctBranch[] => {
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
