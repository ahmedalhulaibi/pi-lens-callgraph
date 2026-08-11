import { resolve } from "node:path";
import { Data, Effect } from "effect";

export type TransitiveCallErrorCategory =
	| "invalid_input"
	| "dependency_unavailable"
	| "provider_response"
	| "workspace_boundary"
	| "traversal_failed";

export class TransitiveCallError extends Data.TaggedError(
	"TransitiveCallError",
)<{
	readonly category: TransitiveCallErrorCategory;
	readonly message: string;
	readonly cause: unknown;
}> {}

const failure = (
	category: TransitiveCallErrorCategory,
	message: string,
	cause: unknown = undefined,
): TransitiveCallError => new TransitiveCallError({ category, message, cause });

const toTransitiveCallError = (cause: unknown): TransitiveCallError =>
	cause instanceof TransitiveCallError
		? cause
		: failure(
				"traversal_failed",
				cause instanceof Error ? cause.message : String(cause),
				cause,
			);
const typedAsync = <Value>(
	operation: () => Promise<Value>,
): Effect.Effect<Value, TransitiveCallError> =>
	Effect.tryPromise({ try: operation, catch: toTransitiveCallError });

export const INCOMING = 1 as const;
export const OUTGOING = 2 as const;
export const BOTH = (INCOMING | OUTGOING) as const;

export type DirectionBit = typeof INCOMING | typeof OUTGOING | typeof BOTH;
export type BranchDirection = "incoming" | "outgoing";
export type NodeStatus = "included" | "filtered";
export type Position = { line: number; character: number };
export type Range = { start: Position; end: Position };
export type CallHierarchyItem = {
	name: string;
	uri: string;
	range: Range;
	selectionRange: Range;
	kind?: number;
	detail?: string;
};
export type ToolContentPart = { type: string; text?: string };
export type ToolResult = { text?: string; content?: ToolContentPart[] };
export type LineRanges = {
	declaration: { start: number; end: number };
	selection: { start: number; end: number };
};
export type NodeRecord = {
	key: string;
	name: string;
	path: string | null;
	ranges: LineRanges;
	depth: number;
	direction: BranchDirection;
	status: NodeStatus;
	filteredBy?: string[];
};
export type Edge = { from: string; to: string; direction: DirectionBit };
export type Boundary = Edge & {
	target: string;
	uri: string;
	reason: "outside_workspace";
};
export type BranchResult = {
	root: NodeRecord;
	direction: BranchDirection;
	directionBit: DirectionBit;
	nodes: NodeRecord[];
	edges: Edge[];
	boundaries: Boundary[];
	truncated: boolean;
};
export type TransitiveOptions = {
	path: string;
	line: number;
	symbol: string;
	workspaceRoot: string;
	direction: DirectionBit;
	maxDepth: number;
	maxNodes: number;
	regexPatterns?: string[];
};
export type TransitiveResult = Partial<Record<BranchDirection, BranchResult>>;
export type LspNavigation = (
	args: Record<string, unknown>,
) => Promise<ToolResult>;
export type TransitiveDependencies = { lspNavigation: LspNavigation };

type LspPayload = {
	result: unknown[];
	status?: string;
	resultCount?: number;
};
type CompiledPattern = { pattern: string; regex: RegExp };
type QueueEntry = { item: CallHierarchyItem; depth: number };
type CallHierarchyCall = {
	from?: CallHierarchyItem;
	to?: CallHierarchyItem;
	source?: CallHierarchyItem;
	target?: CallHierarchyItem;
};

const positionIsValid = (value: unknown): value is Position =>
	value !== null &&
	typeof value === "object" &&
	Number.isInteger((value as Position).line) &&
	Number.isInteger((value as Position).character) &&
	(value as Position).line >= 0 &&
	(value as Position).character >= 0;

const rangeIsValid = (value: unknown): value is Range =>
	value !== null &&
	typeof value === "object" &&
	positionIsValid((value as Range).start) &&
	positionIsValid((value as Range).end);

const itemIsValid = (value: unknown): value is CallHierarchyItem =>
	value !== null &&
	typeof value === "object" &&
	typeof (value as CallHierarchyItem).name === "string" &&
	typeof (value as CallHierarchyItem).uri === "string" &&
	rangeIsValid((value as CallHierarchyItem).range) &&
	rangeIsValid((value as CallHierarchyItem).selectionRange);

const parseToolPayload = (result: ToolResult): LspPayload => {
	if (result === null || typeof result !== "object")
		throw failure(
			"provider_response",
			"Invalid pi-lens response: tool result must be an object",
			result,
		);
	if (result.content !== undefined && !Array.isArray(result.content))
		throw failure(
			"provider_response",
			"Invalid pi-lens response: content must be an array",
			result.content,
		);
	if (
		result.content?.some(
			(part) =>
				part === null ||
				typeof part !== "object" ||
				typeof part.type !== "string" ||
				(part.text !== undefined && typeof part.text !== "string"),
		)
	)
		throw failure(
			"provider_response",
			"Invalid pi-lens response: content contains an invalid part",
			result.content,
		);
	const text =
		typeof result.text === "string"
			? result.text
			: result.content?.find((part) => part.type === "text")?.text;
	if (!text)
		throw failure("provider_response", "pi-lens returned no text payload");
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (cause) {
		throw failure(
			"provider_response",
			`Invalid pi-lens response: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		);
	}
	if (parsed === null || typeof parsed !== "object")
		throw failure(
			"provider_response",
			"Invalid pi-lens response: result must be an array",
			parsed,
		);
	const payload = parsed as {
		result?: unknown;
		status?: unknown;
		resultCount?: unknown;
	};
	if (
		payload.status === "empty" &&
		payload.resultCount === 0 &&
		payload.result === undefined
	)
		return { result: [], status: "empty", resultCount: 0 };
	if (!Array.isArray(payload.result))
		throw failure(
			"provider_response",
			"Invalid pi-lens response: result must be an array",
			parsed,
		);
	return payload as LspPayload;
};

const hierarchyItems = (payload: LspPayload): CallHierarchyItem[] =>
	payload.result.map((value, index) => {
		if (!itemIsValid(value))
			throw failure(
				"provider_response",
				`Invalid pi-lens response: result[${index}] is not a call hierarchy item`,
				value,
			);
		return value;
	});

const filePath = (uri: string): string | null => {
	if (!uri.startsWith("file://")) return null;
	try {
		const decoded = decodeURIComponent(uri.slice("file://".length));
		return resolve(decoded.startsWith("/") ? decoded : `/${decoded}`);
	} catch (cause) {
		throw failure(
			"provider_response",
			"Invalid file URI in pi-lens response",
			cause,
		);
	}
};

const normalizeWorkspaceRoot = (root: string): string => {
	if (typeof root !== "string" || !root)
		throw failure(
			"invalid_input",
			"workspaceRoot must be a non-empty string",
			root,
		);
	return resolve(root);
};

const isInside = (uri: string, root: string): boolean => {
	const path = filePath(uri);
	if (path === null) return false;
	if (root === "/") return path.startsWith("/");
	return path === root || path.startsWith(`${root}/`);
};

const itemKey = (item: CallHierarchyItem): string =>
	`${item.uri}|${item.selectionRange.start.line}:${item.selectionRange.start.character}|${item.name}`;

const inclusiveEndLine = (range: Range): number =>
	range.end.character === 0 && range.end.line > range.start.line
		? range.end.line
		: range.end.line + 1;

const lineRanges = (item: CallHierarchyItem): LineRanges => ({
	declaration: {
		start: item.range.start.line + 1,
		end: inclusiveEndLine(item.range),
	},
	selection: {
		start: item.selectionRange.start.line + 1,
		end: inclusiveEndLine(item.selectionRange),
	},
});

const compilePatterns = (patterns: string[] = []): CompiledPattern[] => {
	if (!Array.isArray(patterns))
		throw failure(
			"invalid_input",
			"regexPatterns must be an array of strings",
			patterns,
		);
	return patterns.map((pattern) => {
		if (typeof pattern !== "string")
			throw failure(
				"invalid_input",
				"regexPatterns must be an array of strings",
				pattern,
			);
		try {
			return { pattern, regex: new RegExp(pattern) };
		} catch (cause) {
			throw failure(
				"invalid_input",
				`Invalid regex pattern ${JSON.stringify(pattern)}: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause,
			);
		}
	});
};

const matchingPatterns = (
	item: CallHierarchyItem,
	patterns: CompiledPattern[],
): string[] => {
	const haystack = `${filePath(item.uri) ?? item.uri}\n${item.name}\n${item.detail ?? ""}`;
	return patterns
		.filter(({ regex }) => {
			regex.lastIndex = 0;
			return regex.test(haystack);
		})
		.map(({ pattern }) => pattern);
};

const nodeRecord = (
	item: CallHierarchyItem,
	depth: number,
	direction: BranchDirection,
	patterns: CompiledPattern[],
): NodeRecord => {
	const filteredBy = matchingPatterns(item, patterns);
	return {
		key: itemKey(item),
		name: item.name,
		path: filePath(item.uri),
		ranges: lineRanges(item),
		depth,
		direction,
		status: filteredBy.length ? "filtered" : "included",
		...(filteredBy.length ? { filteredBy } : {}),
	};
};

const compareText = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;
const compareNodes = (left: NodeRecord, right: NodeRecord): number =>
	left.depth - right.depth || compareText(left.key, right.key);
const compareEdges = (left: Edge, right: Edge): number =>
	compareText(left.from, right.from) ||
	compareText(left.to, right.to) ||
	left.direction - right.direction;
const compareBoundaries = (left: Boundary, right: Boundary): number =>
	compareEdges(left, right) ||
	compareText(left.uri, right.uri) ||
	compareText(left.target, right.target);

const runtimeDependencies = (): TransitiveDependencies => ({
	lspNavigation: extensions.lsp_navigation as LspNavigation,
});

const validateDependencies = (
	dependencies: TransitiveDependencies,
): TransitiveDependencies => {
	if (
		dependencies === null ||
		typeof dependencies !== "object" ||
		typeof dependencies.lspNavigation !== "function"
	)
		throw failure(
			"dependency_unavailable",
			"pi-lens is required: extensions.lsp_navigation is unavailable",
			dependencies,
		);
	return dependencies;
};

const invalidInput = (message: string, cause: unknown): never => {
	throw failure("invalid_input", message, cause);
};

const validateOptions = (options: TransitiveOptions): string => {
	if (!options || typeof options !== "object")
		invalidInput("options must be an object", options);
	if (typeof options.path !== "string" || !options.path)
		invalidInput("path must be a non-empty string", options.path);
	if (typeof options.symbol !== "string" || !options.symbol)
		invalidInput("symbol must be a non-empty string", options.symbol);
	if (!Number.isInteger(options.line) || options.line < 0)
		invalidInput("line must be a non-negative integer", options.line);
	if (![INCOMING, OUTGOING, BOTH].includes(options.direction))
		invalidInput(
			"direction must be 1 (incoming), 2 (outgoing), or 3 (both)",
			options.direction,
		);
	if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0)
		invalidInput("maxDepth must be a non-negative integer", options.maxDepth);
	if (!Number.isInteger(options.maxNodes) || options.maxNodes < 1)
		invalidInput("maxNodes must be a positive integer", options.maxNodes);
	return normalizeWorkspaceRoot(options.workspaceRoot);
};

const prepareRoot = async (
	options: TransitiveOptions,
	dependencies: TransitiveDependencies,
): Promise<CallHierarchyItem> => {
	const items = hierarchyItems(
		parseToolPayload(
			await dependencies.lspNavigation({
				operation: "prepareCallHierarchy",
				path: options.path,
				line: options.line,
				symbol: options.symbol,
			}),
		),
	);
	const root = items[0];
	if (!root)
		throw failure(
			"provider_response",
			`Could not prepare call hierarchy for ${options.symbol}`,
			items,
		);
	return root;
};

const targetFor = (
	value: unknown,
	direction: BranchDirection,
	index: number,
): CallHierarchyItem => {
	if (value === null || typeof value !== "object")
		throw failure(
			"provider_response",
			`Invalid pi-lens response: result[${index}] is not a call`,
			value,
		);
	const call = value as CallHierarchyCall;
	const target =
		direction === "incoming"
			? (call.from ?? call.source)
			: (call.to ?? call.target);
	if (!itemIsValid(target))
		throw failure(
			"provider_response",
			`Invalid pi-lens response: result[${index}] has no valid ${direction} target`,
			target,
		);
	return target;
};

const walk = async (
	options: TransitiveOptions,
	root: CallHierarchyItem,
	direction: BranchDirection,
	directionBit: DirectionBit,
	patterns: CompiledPattern[],
	workspaceRoot: string,
	dependencies: TransitiveDependencies,
): Promise<BranchResult> => {
	const rootKey = itemKey(root);
	const queue: QueueEntry[] = [{ item: root, depth: 0 }];
	const scheduled = new Set<string>([rootKey]);
	const visited = new Set<string>();
	const nodes = new Map<string, NodeRecord>();
	const edges = new Map<string, Edge>();
	const boundaries = new Map<string, Boundary>();
	let truncated = false;

	while (queue.length) {
		const current = queue.shift();
		if (!current) continue;
		const currentKey = itemKey(current.item);
		if (visited.has(currentKey)) continue;
		visited.add(currentKey);
		const record = nodeRecord(current.item, current.depth, direction, patterns);
		nodes.set(currentKey, record);
		if (record.status === "filtered") continue;
		if (current.depth >= options.maxDepth) {
			truncated = true;
			continue;
		}

		const payload = parseToolPayload(
			await dependencies.lspNavigation({
				operation: direction === "incoming" ? "incomingCalls" : "outgoingCalls",
				callHierarchyItem: current.item,
			}),
		);
		const targets = payload.result
			.map((value, index) => targetFor(value, direction, index))
			.sort((left, right) => compareText(itemKey(left), itemKey(right)));

		for (const target of targets) {
			const targetKey = itemKey(target);
			const edge: Edge =
				direction === "incoming"
					? { from: targetKey, to: currentKey, direction: directionBit }
					: { from: currentKey, to: targetKey, direction: directionBit };
			const edgeKey = `${edge.from}\u0000${edge.to}\u0000${edge.direction}`;
			if (!isInside(target.uri, workspaceRoot)) {
				boundaries.set(edgeKey, {
					...edge,
					target: target.name,
					uri: target.uri,
					reason: "outside_workspace",
				});
				continue;
			}
			if (!scheduled.has(targetKey)) {
				if (scheduled.size >= options.maxNodes) {
					truncated = true;
					continue;
				}
				scheduled.add(targetKey);
				queue.push({ item: target, depth: current.depth + 1 });
			}
			edges.set(edgeKey, edge);
		}
	}

	const rootRecord =
		nodes.get(rootKey) ?? nodeRecord(root, 0, direction, patterns);
	return {
		root: rootRecord,
		direction,
		directionBit,
		nodes: [...nodes.values()].sort(compareNodes),
		edges: [...edges.values()].sort(compareEdges),
		boundaries: [...boundaries.values()].sort(compareBoundaries),
		truncated,
	};
};

const validateRoot = (
	root: CallHierarchyItem,
	workspaceRoot: string,
): CallHierarchyItem => {
	if (!itemIsValid(root))
		throw failure(
			"invalid_input",
			"root must be a valid call hierarchy item",
			root,
		);
	if (!isInside(root.uri, workspaceRoot))
		throw failure(
			"workspace_boundary",
			"Prepared call hierarchy root is outside workspaceRoot",
			root,
		);
	return root;
};

const incomingCallsPromise = async (
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies: TransitiveDependencies,
): Promise<BranchResult> => {
	validateDependencies(dependencies);
	const workspaceRoot = validateOptions(options);
	validateRoot(root, workspaceRoot);
	return walk(
		options,
		root,
		"incoming",
		INCOMING,
		compilePatterns(options.regexPatterns),
		workspaceRoot,
		dependencies,
	);
};

const outgoingCallsPromise = async (
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies: TransitiveDependencies,
): Promise<BranchResult> => {
	validateDependencies(dependencies);
	const workspaceRoot = validateOptions(options);
	validateRoot(root, workspaceRoot);
	return walk(
		options,
		root,
		"outgoing",
		OUTGOING,
		compilePatterns(options.regexPatterns),
		workspaceRoot,
		dependencies,
	);
};

const transitiveCallsPromise = async (
	options: TransitiveOptions,
	dependencies: TransitiveDependencies,
): Promise<TransitiveResult> => {
	validateDependencies(dependencies);
	const workspaceRoot = validateOptions(options);
	const root = await prepareRoot(options, dependencies);
	validateRoot(root, workspaceRoot);
	const result: TransitiveResult = {};
	if (options.direction & INCOMING)
		result.incoming = await incomingCallsPromise(options, root, dependencies);
	if (options.direction & OUTGOING)
		result.outgoing = await outgoingCallsPromise(options, root, dependencies);
	return result;
};

export const incomingCallsEffect = (
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies?: TransitiveDependencies,
): Effect.Effect<BranchResult, TransitiveCallError> =>
	typedAsync(() =>
		incomingCallsPromise(options, root, dependencies ?? runtimeDependencies()),
	);

export const outgoingCallsEffect = (
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies?: TransitiveDependencies,
): Effect.Effect<BranchResult, TransitiveCallError> =>
	typedAsync(() =>
		outgoingCallsPromise(options, root, dependencies ?? runtimeDependencies()),
	);

export const transitiveCallsEffect = (
	options: TransitiveOptions,
	dependencies?: TransitiveDependencies,
): Effect.Effect<TransitiveResult, TransitiveCallError> =>
	typedAsync(() =>
		transitiveCallsPromise(options, dependencies ?? runtimeDependencies()),
	);

export async function incomingCalls(
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies?: TransitiveDependencies,
): Promise<BranchResult> {
	return Effect.runPromise(incomingCallsEffect(options, root, dependencies));
}

export async function outgoingCalls(
	options: TransitiveOptions,
	root: CallHierarchyItem,
	dependencies?: TransitiveDependencies,
): Promise<BranchResult> {
	return Effect.runPromise(outgoingCallsEffect(options, root, dependencies));
}

export async function transitiveCalls(
	options: TransitiveOptions,
	dependencies?: TransitiveDependencies,
): Promise<TransitiveResult> {
	return Effect.runPromise(transitiveCallsEffect(options, dependencies));
}

globalThis.transitiveCalls = transitiveCalls;
