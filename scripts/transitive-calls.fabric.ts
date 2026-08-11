const parseToolText = (result) => {
	const text =
		result?.text ?? result?.content?.find((part) => part.type === "text")?.text;
	if (!text) throw new Error("pi-lens returned no text payload");
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(
			`Invalid pi-lens response: ${error instanceof Error ? error.message : String(error)}`,
		);
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
async function transitiveCalls(options) {
	if (typeof extensions?.lsp_navigation !== "function") {
		throw new Error(
			"pi-lens is required: extensions.lsp_navigation is unavailable",
		);
	}
	const rootPath = options.workspaceRoot.replace(/\/$/, "");
	const prepared = parseToolText(
		await extensions.lsp_navigation({
			operation: "prepareCallHierarchy",
			path: options.path,
			line: options.line,
			symbol: options.symbol,
		}),
	);
	const root = prepared.result?.[0];
	if (!root)
		throw new Error(`Could not prepare call hierarchy for ${options.symbol}`);
	const queue = [{ item: root, depth: 0 }];
	const seen = new Set();
	const nodes = [],
		edges = [],
		boundaries = [];
	while (queue.length && nodes.length < options.maxNodes) {
		const current = queue.shift();
		const currentKey = itemKey(current.item);
		if (seen.has(currentKey)) continue;
		seen.add(currentKey);
		nodes.push({
			key: currentKey,
			name: current.item.name,
			path: filePath(current.item.uri),
			ranges: lineRanges(current.item),
			depth: current.depth,
		});
		if (current.depth >= options.maxDepth) continue;
		const response = parseToolText(
			await extensions.lsp_navigation({
				operation:
					options.direction === "incoming" ? "incomingCalls" : "outgoingCalls",
				callHierarchyItem: current.item,
			}),
		);
		for (const call of response.result ?? []) {
			const target =
				options.direction === "incoming"
					? (call.from ?? call.source ?? call)
					: (call.to ?? call.target ?? call);
			if (!target?.uri) continue;
			const targetKey = itemKey(target);
			const edge =
				options.direction === "incoming"
					? { from: targetKey, to: currentKey }
					: { from: currentKey, to: targetKey };
			if (!isInside(target.uri, rootPath)) {
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
			)
				queue.push({ item: target, depth: current.depth + 1 });
		}
	}
	return {
		root: { name: root.name, path: filePath(root.uri), ranges: lineRanges(root) },
		nodes,
		edges,
		boundaries,
		truncated: queue.length > 0 || nodes.length >= options.maxNodes,
	};
}
transitiveCalls;
