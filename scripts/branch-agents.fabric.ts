import { Data, Effect } from "effect";
import {
	type BothBranchGraph,
	type BranchGraph,
	distinctBranches,
} from "./branches.fabric";
import type { ReadDependency, ReadResult } from "./expand-branches.fabric";

export type BranchEvidence = Readonly<
	ReturnType<typeof distinctBranches>[number]
>;

export type BranchAgentRequest = {
	branchIndex: number;
	evidence: BranchEvidence;
	contents: ReadResult[];
};

export type BranchAgentResult = { text: string };
export type AgentDependency = (
	request: BranchAgentRequest,
) => Promise<BranchAgentResult>;

export type ConsumedBranch = {
	branchIndex: number;
	evidence: BranchEvidence;
	contents: ReadResult[];
	analysis: BranchAgentResult;
};

export type BranchConsumerErrorCategory =
	| "invalid_evidence"
	| "read_failed"
	| "agent_failed";

export class BranchConsumerError extends Data.TaggedError(
	"BranchConsumerError",
)<{
	readonly category: BranchConsumerErrorCategory;
	readonly branchIndex: number;
	readonly message: string;
	readonly cause: unknown;
}> {}

const immutable = <Value>(value: Value): Value => {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) immutable(child);
		Object.freeze(value);
	}
	return value;
};

const dependency = <Value>(
	operation: () => Promise<Value>,
	category: "read_failed" | "agent_failed",
	branchIndex: number,
): Effect.Effect<Value, BranchConsumerError> =>
	Effect.tryPromise({
		try: operation,
		catch: (cause) =>
			new BranchConsumerError({
				category,
				branchIndex,
				message: cause instanceof Error ? cause.message : String(cause),
				cause,
			}),
	});

export const consumeBranches = (
	graph: BranchGraph | BothBranchGraph,
	dependencies: { read: ReadDependency; runAgent: AgentDependency },
): Effect.Effect<ConsumedBranch[], BranchConsumerError> =>
	Effect.forEach(
		distinctBranches(graph),
		(branch, branchIndex) =>
			Effect.gen(function* () {
				const evidence = immutable(structuredClone(branch)) as BranchEvidence;
				const contents = yield* Effect.forEach(evidence.nodes, (node) => {
					if (node.path === null) {
						return Effect.fail(
							new BranchConsumerError({
								category: "invalid_evidence",
								branchIndex,
								message: "cannot read a node without a path",
								cause: node,
							}),
						);
					}
					return dependency(
						() =>
							dependencies.read({
								path: node.path,
								offset: node.ranges.declaration.start,
								limit:
									node.ranges.declaration.end -
									node.ranges.declaration.start +
									1,
							}),
						"read_failed",
						branchIndex,
					);
				});
				const request = { branchIndex, evidence, contents };
				const analysis = yield* dependency(
					() => dependencies.runAgent(request),
					"agent_failed",
					branchIndex,
				);
				return { ...request, analysis };
			}),
		{ concurrency: "unbounded" },
	);
