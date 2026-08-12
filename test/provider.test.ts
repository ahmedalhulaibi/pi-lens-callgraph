import type {
	FabricInvocationContext,
	FabricProvider,
} from "pi-fabric/protocol";
import { describe, expect, it } from "vitest";
import registerCallgraphProvider from "../extensions/transitive-calls.ts";
import type { TransitiveResult } from "../scripts/transitive-calls.fabric.ts";

describe("callgraph Fabric provider", () => {
	it("delegates LSP navigation through the captured-tool bridge", async () => {
		let provider: FabricProvider | undefined;
		registerCallgraphProvider({
			events: {
				emit: (_event: string, payload: { provider: FabricProvider }) => {
					provider = payload.provider;
				},
			},
		} as never);
		if (!provider) throw new Error("provider was not registered");

		const item = {
			name: "root",
			uri: "file:///workspace/root.ts",
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 1 },
			},
			selectionRange: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 1 },
			},
		};
		const calls: string[] = [];
		const context = {
			invokeCapturedTool: async (
				name: string,
				args: Record<string, unknown>,
			) => {
				calls.push(name);
				return {
					text: JSON.stringify({
						result: args.operation === "prepareCallHierarchy" ? [item] : [],
					}),
				};
			},
		} as unknown as FabricInvocationContext;

		const result = (await provider.invoke(
			"transitive_calls",
			{
				path: "/workspace/root.ts",
				line: 0,
				symbol: "root",
				workspaceRoot: "/workspace",
				direction: 3,
				maxDepth: 1,
				maxNodes: 10,
			},
			context,
		)) as TransitiveResult;

		if (!result.incoming || !result.outgoing)
			throw new Error("both branches were not returned");
		expect(result.incoming.root.name).toBe("root");
		expect(result.outgoing.root.name).toBe("root");
		expect(calls).toEqual([
			"lsp_navigation",
			"lsp_navigation",
			"lsp_navigation",
		]);
	});
});
