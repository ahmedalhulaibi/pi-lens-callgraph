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
	detail?: string;
};

const position = (line: number, character = 0) => ({ line, character });
const declaration = (
	name: string,
	path: string,
	line: number,
	detail?: string,
	endCharacter = 1,
): FixtureItem => ({
	name,
	uri: `file://${path}`,
	range: { start: position(line), end: position(line + 2, endCharacter) },
	selectionRange: { start: position(line), end: position(line, name.length) },
	...(detail ? { detail } : {}),
});

const workspaceRoot = "/fixtures/workspace";
const root = declaration("root", `${workspaceRoot}/root.ts`, 4);
const callerA = declaration("callerA", `${workspaceRoot}/caller-a.ts`, 1);
const callerB = declaration(
	"callerB",
	`${workspaceRoot}/caller-b.ts`,
	12,
	undefined,
	0,
);
const calleeA = declaration("calleeA", `${workspaceRoot}/callee-a.ts`, 8);
const calleeB = declaration(
	"calleeB",
	`${workspaceRoot}/generated/callee-b.ts`,
	18,
	"generated",
);
const shared = declaration("shared", `${workspaceRoot}/shared.ts`, 24);
const outside = declaration("outside", "/fixtures/external/outside.ts", 2);

export const fixture = {
	workspaceRoot,
	root,
	incoming: callerA,
	outgoing: calleeA,
	nodes: { root, callerA, callerB, calleeA, calleeB, shared, outside },
	incomingCalls: {
		root: [callerB, callerA],
		callerA: [root],
		callerB: [outside],
		calleeA: [],
		calleeB: [],
		shared: [],
		outside: [],
	},
	outgoingCalls: {
		root: [outside, calleeB, calleeA],
		callerA: [],
		callerB: [],
		calleeA: [shared],
		calleeB: [shared],
		shared: [root],
		outside: [],
	},
};

export const fixtureFiles = {
	"/fixtures/workspace/root.ts": "function root() { return calleeA(); }\n",
	"/fixtures/workspace/caller-a.ts": "function callerA() { return root(); }\n",
	"/fixtures/workspace/caller-b.ts": "function callerB() { return root(); }\n",
	"/fixtures/workspace/callee-a.ts":
		"function calleeA() { return shared(); }\n",
	"/fixtures/workspace/generated/callee-b.ts":
		"function calleeB() { return shared(); }\n",
	"/fixtures/workspace/shared.ts": "function shared() { return root(); }\n",
};
