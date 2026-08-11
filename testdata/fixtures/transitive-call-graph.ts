export type FixtureItem = {
	name: string;
	uri: string;
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	selectionRange: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
};
const position = (line: number, character = 0) => ({ line, character });
export const fixture = {
	workspaceRoot: "/fixtures/workspace",
	root: {
		name: "root",
		uri: "file:///fixtures/workspace/root.ts",
		range: { start: position(4), end: position(6, 1) },
		selectionRange: { start: position(4), end: position(4, 4) },
	},
	incoming: {
		name: "caller",
		uri: "file:///fixtures/workspace/caller.ts",
		range: { start: position(1), end: position(3, 1) },
		selectionRange: { start: position(1), end: position(1, 6) },
	},
	outgoing: {
		name: "callee",
		uri: "file:///fixtures/workspace/callee.ts",
		range: { start: position(8), end: position(10, 1) },
		selectionRange: { start: position(8), end: position(8, 6) },
	},
};
export const fixtureFiles = {
	"/fixtures/workspace/root.ts": "function root() { return callee(); }\n",
	"/fixtures/workspace/caller.ts": "function caller() { return root(); }\n",
	"/fixtures/workspace/callee.ts": "function callee() { return 1; }\n",
};
