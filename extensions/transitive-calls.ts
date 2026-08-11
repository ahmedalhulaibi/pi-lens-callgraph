import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	type LspNavigation,
	type TransitiveOptions,
	transitiveCalls,
} from "../scripts/transitive-calls.fabric.ts";

const parameters = Type.Object({
	path: Type.String({ description: "Absolute path to the root source file" }),
	line: Type.Integer({
		minimum: 0,
		description: "Zero-based source line for LSP preparation",
	}),
	symbol: Type.String({
		description: "Function or method symbol at the source location",
	}),
	workspaceRoot: Type.String({ description: "Absolute workspace boundary" }),
	direction: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(3)], {
		description: "1 incoming, 2 outgoing, 3 both",
	}),
	maxDepth: Type.Integer({ minimum: 0 }),
	maxNodes: Type.Integer({ minimum: 1 }),
	regexPatterns: Type.Optional(Type.Array(Type.String())),
});

type CapturedExtensions = {
	lsp_navigation?: LspNavigation;
};

export default function registerTransitiveCalls(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "transitive_calls",
		label: "Transitive Calls",
		description:
			"Traverse incoming and/or outgoing calls for a symbol within a workspace boundary. Requires pi-lens extensions.lsp_navigation through Fabric.",
		promptSnippet:
			"Traverse bounded incoming and outgoing calls for a source symbol",
		parameters,
		async execute(_toolCallId, params) {
			const captured = (
				globalThis as typeof globalThis & {
					extensions?: CapturedExtensions;
				}
			).extensions;
			if (typeof captured?.lsp_navigation !== "function") {
				throw new Error(
					"transitive_calls requires Fabric's captured extensions.lsp_navigation capability from pi-lens",
				);
			}
			const result = await transitiveCalls(params as TransitiveOptions, {
				lspNavigation: captured.lsp_navigation,
			});
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});
}
