const INCOMING = 1;
const OUTGOING = 2;
const BOTH = INCOMING | OUTGOING;

const parseToolText = (result) => {
	const text = result?.text ?? result?.content?.find((part) => part.type === "text")?.text;
	if (!text) throw new Error("pi-lens returned no text payload");
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid pi-lens response: ${error instanceof Error ? error.message : String(error)}`);
	}
};

const filePath = (uri) => {
	if (!uri?.startsWith("file://")) return null;
	const path = decodeURIComponent(uri.slice("file://".length));
	return path.startsWith("/") ? path : `/${path}`;
};

const isInside = (uri, root) => {
	const path = filePath(uri);
	return path !== null && (path === root || path.startsWith(`${root}/`));
};

const itemKey = (item) =>
	`${item.uri}|${item.selectionRange.start.line}:${item.selectionRange.start.character}|${item.name}`;

const lineRanges = (item) => ({
	declaration: { start: item.range.start.line + 1, end: item.range.end.line + 1 },
	selection: { start: item.selectionRange.start.line + 1, end: item.selectionRange.end.line + 1 },
});

const compilePatterns = (patterns = []) => patterns.map((pattern) => {
	try {
		return { pattern, regex: new RegExp(pattern) };
	} catch (error) {
		throw new Error(`Invalid regex pattern ${JSON.stringify(pattern)}: ${error instanceof Error ? error.message : String(error)}`);
	}
});

const matchingPatterns = (item, patterns) => {
	const haystack = `${filePath(item.uri) ?? item.uri}\n${item.name}\n${item.detail ?? ""}`;
	return patterns.filter(({ regex }) => regex.test(haystack)).map(({ pattern }) => pattern);
};

const nodeRecord = (item, depth, direction, status, filteredBy = []) => ({
	key: itemKey(item),
	name: item.name,
	path: filePath(item.uri),
	ranges: lineRanges(item),
	depth,
	direction,
	status,
	...(filteredBy.length ? { filteredBy } : {}),
});

async function prepareRoot(options) {
	const prepared = parseToolText(await extensions.lsp_navigation({
		operation: "prepareCallHierarchy",
		path: options.path,
		line: options.line,
		symbol: options.symbol,
	}));
	const root = prepared.result?.[0];
	if (!root) throw new Error(`Could not prepare call hierarchy for ${options.symbol}`);
	return root;
}

async function walk(options, root, direction, directionBit, patterns) {
	const workspaceRoot = options.workspaceRoot.replace(/\/$/, "");
	const queue = [{ item: root, depth: 0 }];
	const seen = new Set();
	const nodes = [];
	const edges = [];
	const boundaries = [];
	let truncated = false;

	while (queue.length) {
		if (nodes.length >= options.maxNodes) {
			truncated = true;
			break;
		}
		const current = queue.shift();
		const currentKey = itemKey(current.item);
		if (seen.has(currentKey)) continue;
		seen.add(currentKey);
		const filteredBy = matchingPatterns(current.item, patterns);
		const status = filteredBy.length ? "filtered" : "included";
		nodes.push(nodeRecord(current.item, current.depth, direction, status, filteredBy));
		if (status === "filtered" || current.depth >= options.maxDepth) continue;

		const response = parseToolText(await extensions.lsp_navigation({
			operation: direction === "incoming" ? "incomingCalls" : "outgoingCalls",
			callHierarchyItem: current.item,
		}));
		for (const call of response.result ?? []) {
			const target = direction === "incoming" ? call.from ?? call.source ?? call : call.to ?? call.target ?? call;
			if (!target?.uri) continue;
			const targetKey = itemKey(target);
			const edge = direction === "incoming"
				? { from: targetKey, to: currentKey, direction: directionBit }
				: { from: currentKey, to: targetKey, direction: directionBit };
			if (!isInside(target.uri, workspaceRoot)) {
				boundaries.push({ ...edge, target: target.name, uri: target.uri, reason: "outside_workspace" });
				continue;
			}
			edges.push(edge);
			if (!seen.has(targetKey) && nodes.length + queue.length < options.maxNodes) {
				queue.push({ item: target, depth: current.depth + 1 });
			} else if (!seen.has(targetKey)) {
				truncated = true;
			}
		}
	}

	return {
		root: nodeRecord(root, 0, direction, matchingPatterns(root, patterns).length ? "filtered" : "included", matchingPatterns(root, patterns)),
		direction,
		directionBit,
		nodes,
		edges,
		boundaries,
		truncated,
	};
}

async function incomingCalls(options, root, patterns) {
	return walk(options, root, "incoming", INCOMING, patterns);
}

async function outgoingCalls(options, root, patterns) {
	return walk(options, root, "outgoing", OUTGOING, patterns);
}

async function transitiveCalls(options) {
	if (typeof extensions?.lsp_navigation !== "function") {
		throw new Error("pi-lens is required: extensions.lsp_navigation is unavailable");
	}
	if (![INCOMING, OUTGOING, BOTH].includes(options.direction)) {
		throw new Error("direction must be 1 (incoming), 2 (outgoing), or 3 (both)");
	}
	if (!Number.isInteger(options.maxDepth) || options.maxDepth < 0) throw new Error("maxDepth must be a non-negative integer");
	if (!Number.isInteger(options.maxNodes) || options.maxNodes < 1) throw new Error("maxNodes must be a positive integer");
	const patterns = compilePatterns(options.regexPatterns);
	const root = await prepareRoot(options);
	const branches = {};
	if (options.direction & INCOMING) branches.incoming = incomingCalls(options, root, patterns);
	if (options.direction & OUTGOING) branches.outgoing = outgoingCalls(options, root, patterns);
	const entries = await Promise.all(Object.entries(branches).map(async ([key, branch]) => [key, await branch]));
	return Object.fromEntries(entries);
}

transitiveCalls