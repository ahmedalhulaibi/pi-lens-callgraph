const INCOMING = 1 as const;
const OUTGOING = 2 as const;
const BOTH = (INCOMING | OUTGOING) as const;
type DirectionBit = typeof INCOMING | typeof OUTGOING | typeof BOTH;
type BranchDirection = "incoming" | "outgoing";
type NodeStatus = "included" | "filtered";
type BranchName = BranchDirection;

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type CallHierarchyItem = {
	name: string;
	uri: string;
	range: Range;
	selectionRange: Range;
	kind?: number;
	detail?: string;
};
type CallHierarchyCall = {
	from?: CallHierarchyItem;
	to?: CallHierarchyItem;
	source?: CallHierarchyItem;
	target?: CallHierarchyItem;
};
type ToolContentPart = { type: string; text?: string };
type ToolResult = { text?: string; content?: ToolContentPart[] };
type LspPayload = { result?: unknown };
type CompiledPattern = { pattern: string; regex: RegExp };
type LineRanges = {
	declaration: { start: number; end: number };
	selection: { start: number; end: number };
};
type NodeRecord = {
	key: string;
	name: string;
	path: string | null;
	ranges: LineRanges;
	depth: number;
	direction: BranchDirection;
	status: NodeStatus;
	filteredBy?: string[];
};
type Edge = { from: string; to: string; direction: DirectionBit };
type Boundary = Edge & {
	target: string;
	uri: string;
	reason: "outside_workspace";
};
type BranchResult = {
	root: NodeRecord;
	direction: BranchDirection;
	directionBit: DirectionBit;
	nodes: NodeRecord[];
	edges: Edge[];
	boundaries: Boundary[];
	truncated: boolean;
};
type TransitiveOptions = {
	path: string;
	line: number;
	symbol: string;
	workspaceRoot: string;
	direction: DirectionBit;
	maxDepth: number;
	maxNodes: number;
	regexPatterns?: string[];
};
type QueueEntry = { item: CallHierarchyItem; depth: number };
type TransitiveResult = Partial<Record<BranchName, BranchResult>>;

type LspNavigation = (args: Record<string, unknown>) => Promise<ToolResult>;

const parseToolText = (result: ToolResult): LspPayload => {
	const text =
		result.text ?? result.content?.find((part) => part.type === "text")?.text;
	if (!text) throw new Error("pi-lens returned no text payload");
	try {
		const parsed: unknown = JSON.parse(text);
		if (!parsed || typeof parsed !== "object")
			throw new Error("payload is not an object");
		return parsed as LspPayload;
	} catch (error) {
		throw new Error(
			`Invalid pi-lens response: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const asCallHierarchyItems = (payload: LspPayload): CallHierarchyItem[] =>
	Array.isArray(payload.result) ? (payload.result as CallHierarchyItem[]) : [];

const asCalls = (payload: LspPayload): CallHierarchyCall[] =>
	Array.isArray(payload.result) ? (payload.result as CallHierarchyCall[]) : [];

const filePath = (uri: string): string | null => {
	if (!uri.startsWith("file://")) return null;
	const path = decodeURIComponent(uri.slice("file://".length));
	return path.startsWith("/") ? path : `/${path}`;
};

const isInside = (uri: string, root: string): boolean => {
	const path = filePath(uri);
	return path !== null && (path === root || path.startsWith(`${root}/`));
};

const itemKey = (item: CallHierarchyItem): string =>
	`${item.uri}|${item.selectionRange.start.line}:${item.selectionRange.start.character}|${item.name}`;

const lineRanges = (item: CallHierarchyItem): LineRanges => ({
	declaration: {
		start: item.range.start.line + 1,
		end: item.range.end.line + 1,
	},
	selection: {
		start: item.selectionRange.start.line + 1,
		end: item.selectionRange.end.line + 1,
	},
});

const compilePatterns = (patterns: string[] = []): CompiledPattern[] =>
	patterns.map((pattern) => {
		try {
			return { pattern, regex: new RegExp(pattern) };
		} catch (error) {
			throw new Error(
				`Invalid regex pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});

const matchingPatterns = (
	item: CallHierarchyItem,
	patterns: CompiledPattern[],
): string[] => {
	const haystack = `${filePath(item.uri) ?? item.uri}\n${item.name}\n${item.detail ?? ""}`;
	return patterns
		.filter(({ regex }) => regex.test(haystack))
		.map(({ pattern }) => pattern);
};

const nodeRecord = (
	item: CallHierarchyItem,
	depth: number,
	direction: BranchDirection,
	status: NodeStatus,
	filteredBy: string[] = [],
): NodeRecord => ({
	key: itemKey(item),
	name: item.name,
	path: filePath(item.uri),
	ranges: lineRanges(item),
	depth,
	direction,
	status,
	...(filteredBy.length ? { filteredBy } : {}),
});

const lspNavigation = (): LspNavigation =>
	extensions.lsp_navigation as LspNavigation;

async function prepareRoot(
	options: TransitiveOptions,
): Promise<CallHierarchyItem> {
	const prepared = parseToolText(
		await lspNavigation()({
			operation: "prepareCallHierarchy",
			path: options.path,
			line: options.line,
			symbol: options.symbol,
		}),
	);
	const root = asCallHierarchyItems(prepared)[0];
	if (!root)
		throw new Error(`Could not prepare call hierarchy for ${options.symbol}`);
	return root;
}

async function walk(
	options: TransitiveOptions,
	root: CallHierarchyItem,
	direction: BranchDirection,
	directionBit: DirectionBit,
	patterns: CompiledPattern[],
): Promise<BranchResult> {
	const workspaceRoot = options.workspaceRoot.replace(/\/$/, "");
	const queue: QueueEntry[] = [{ item: root, depth: 0 }];
	const seen = new Set<string>();
	const nodes: NodeRecord[] = [];
	const edges: Edge[] = [];
	const boundaries: Boundary[] = [];
	let truncated = false;

	while (queue.length) {
		if (nodes.length >= options.maxNodes) {
			truncated = true;
			break;
		}
		const current = queue.shift();
		if (!current) continue;
		const currentKey = itemKey(current.item);
		if (seen.has(currentKey)) continue;
		seen.add(currentKey);
		const filteredBy = matchingPatterns(current.item, patterns);
		const status: NodeStatus = filteredBy.length ? "filtered" : "included";
		nodes.push(
			nodeRecord(current.item, current.depth, direction, status, filteredBy),
		);
		if (status === "filtered" || current.depth >= options.maxDepth) continue;

		const response = parseToolText(
			await lspNavigation()({
				operation: direction === "incoming" ? "incomingCalls" : "outgoingCalls",
				callHierarchyItem: current.item,
			}),
		);
		for (const call of asCalls(response)) {
			const target =
				direction === "incoming"
					? (call.from ?? call.source)
					: (call.to ?? call.target);
			if (!target) continue;
			const targetKey = itemKey(target);
			const edge: Edge =
				direction === "incoming"
					? { from: targetKey, to: currentKey, direction: directionBit }
					: { from: currentKey, to: targetKey, direction: directionBit };
			if (!isInside(target.uri, workspaceRoot)) {
				boundaries.push({
					...edge,
					target: target.name,
					uri: target.uri,
					reason: "outside_workspace",
				});
				continue;
			}
			edges.push(edge);
			if (
				!seen.has(targetKey) &&
				nodes.length + queue.length < options.maxNodes
			) {
				queue.push({ item: target, depth: current.depth + 1 });
			} else if (!seen.has(targetKey)) {
				truncated = true;
			}
		}
	}

	const rootFilteredBy = matchingPatterns(root, patterns);
	return {
		root: nodeRecord(
			root,
			0,
			direction,
			rootFilteredBy.length ? "filtered" : "included",
			rootFilteredBy,
		),
		direction,
		directionBit,
		nodes,
		edges,
		boundaries,
		truncated,
	};
}

async function incomingCalls(
	options: TransitiveOptions,
	root: CallHierarchyItem,
	patterns: CompiledPattern[],
): Promise<BranchResult> {
	return walk(options, root, "incoming", INCOMING, patterns);
}

async function outgoingCalls(
	options: TransitiveOptions,
	root: CallHierarchyItem,
	patterns: CompiledPattern[],
): Promise<BranchResult> {
	return walk(options, root, "outgoing", OUTGOING, patterns);
}

async function transitiveCalls(
	options: TransitiveOptions,
): Promise<TransitiveResult> {
	if (typeof extensions?.lsp_navigation !== "function") {
		throw new Error(
			"pi-lens is required: extensions.lsp_navigation is unavailable",
		);
	}
	if (![INCOMING, OUTGOING, BOTH].includes(options.direction)) {
		throw new Error(
			"direction must be 1 (incoming), 2 (outgoing), or 3 (both)",
		);
	}
	if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0)
		throw new Error("maxDepth must be a non-negative integer");
	if (!Number.isInteger(options.maxNodes) || options.maxNodes < 1)
		throw new Error("maxNodes must be a positive integer");
	const patterns = compilePatterns(options.regexPatterns);
	const root = await prepareRoot(options);
	const branches: Partial<Record<BranchName, Promise<BranchResult>>> = {};
	if (options.direction & INCOMING)
		branches.incoming = incomingCalls(options, root, patterns);
	if (options.direction & OUTGOING)
		branches.outgoing = outgoingCalls(options, root, patterns);
	const entries = await Promise.all(
		(
			Object.entries(branches) as Array<[BranchName, Promise<BranchResult>]>
		).map(async ([key, branch]) => [key, await branch] as const),
	);
	return Object.fromEntries(entries) as TransitiveResult;
}

globalThis.transitiveCalls = transitiveCalls;
