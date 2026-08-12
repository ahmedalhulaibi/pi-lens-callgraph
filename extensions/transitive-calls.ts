import {
	type ToolResult,
	type TransitiveOptions,
	transitiveCalls,
} from "../scripts/transitive-calls.fabric.ts";

const FABRIC_PROVIDER_REGISTER_EVENT = "pi-fabric:provider:register:v1";
const FABRIC_PROVIDER_DISCOVER_EVENT = "pi-fabric:provider:discover:v1";

type ExtensionAPI = {
	events: {
		emit(event: string, payload: unknown): void;
		on?(event: string, handler: (payload: unknown) => void): () => void;
	};
};

type FabricActionDescriptor = {
	name: string;
	description: string;
	risk: "read" | "write" | "execute" | "network" | "agent";
	inputSchema: Record<string, unknown>;
};

type FabricInvocationContext = {
	invokeCapturedTool?: (
		name: string,
		args: Record<string, unknown>,
	) => Promise<unknown>;
};

type FabricProvider = {
	name: string;
	description: string;
	list(): Promise<FabricActionDescriptor[]>;
	describe(actionName: string): Promise<FabricActionDescriptor | undefined>;
	invoke(
		actionName: string,
		args: Record<string, unknown>,
		context: FabricInvocationContext,
	): Promise<unknown>;
};

const action: FabricActionDescriptor = {
	name: "transitive_calls",
	description:
		"Traverse incoming and/or outgoing calls for a symbol within a workspace boundary.",
	risk: "read",
	inputSchema: {
		type: "object",
		required: [
			"path",
			"line",
			"symbol",
			"workspaceRoot",
			"direction",
			"maxDepth",
			"maxNodes",
		],
		properties: {
			path: {
				type: "string",
				description: "Absolute path to the root source file",
			},
			line: {
				type: "integer",
				minimum: 0,
				description: "Zero-based source line",
			},
			symbol: { type: "string", description: "Function or method symbol" },
			workspaceRoot: {
				type: "string",
				description: "Absolute workspace boundary",
			},
			direction: {
				type: "integer",
				enum: [1, 2, 3],
				description: "1 incoming, 2 outgoing, 3 both",
			},
			maxDepth: { type: "integer", minimum: 0 },
			maxNodes: { type: "integer", minimum: 1 },
			regexPatterns: { type: "array", items: { type: "string" } },
		},
		additionalProperties: false,
	},
};

const provider: FabricProvider = {
	name: "callgraph",
	description: "Workspace-bounded transitive call traversal through pi-lens",
	async list() {
		return [action];
	},
	async describe(actionName) {
		return actionName === action.name ? action : undefined;
	},
	async invoke(actionName, args, context) {
		if (actionName !== action.name)
			throw new Error(`Unknown callgraph action: ${actionName}`);
		const invokeCapturedTool = context.invokeCapturedTool;
		if (!invokeCapturedTool) {
			throw new Error("callgraph requires Fabric's captured-tool bridge");
		}
		const lspNavigation = (
			request: Record<string, unknown>,
		): Promise<ToolResult> => {
			const line = request.line;
			const lspRequest =
				typeof line === "number" ? { ...request, line: line + 1 } : request;
			return invokeCapturedTool(
				"lsp_navigation",
				lspRequest,
			) as Promise<ToolResult>;
		};
		return transitiveCalls(args as TransitiveOptions, { lspNavigation });
	},
};

export default function registerCallgraphProvider(pi: ExtensionAPI): void {
	pi.events.on?.(FABRIC_PROVIDER_DISCOVER_EVENT, (payload: unknown) => {
		if (!payload || typeof payload !== "object" || !("register" in payload))
			return;
		const register = (payload as { register?: unknown }).register;
		if (typeof register === "function") {
			register(provider, { overwrite: true });
		}
	});
	pi.events.emit(FABRIC_PROVIDER_REGISTER_EVENT, {
		version: 1,
		provider,
		overwrite: true,
	});
}
