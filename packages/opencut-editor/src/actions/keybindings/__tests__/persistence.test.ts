import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import {
	decodePersistedKeybindingsState,
	migratePersistedKeybindingsState,
	parseImportedKeybindings,
	serializeKeybindingsState,
} from "../persistence";

describe("keybinding persistence", () => {
	let warnSpy: ReturnType<typeof mock>;
	let originalWarn: typeof console.warn;

	beforeEach(() => {
		originalWarn = console.warn;
		warnSpy = mock(() => {});
		console.warn = warnSpy;
	});

	afterEach(() => {
		console.warn = originalWarn;
	});

	test("migrates legacy persisted keybindings before decoding them", () => {
		const migrated = migratePersistedKeybindingsState({
			state: {
				keybindings: {
					s: "split-selected",
					"ctrl+v": "paste-selected",
				},
				isCustomized: true,
			},
			fromVersion: 2,
		});

		const decoded = decodePersistedKeybindingsState({ state: migrated });
		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected migrated keybindings to decode");

		expect(decoded.isCustomized).toBe(true);
		expect(decoded.keybindings.get("s")).toBe("split");
		expect(decoded.keybindings.get("ctrl+v")).toBe("paste-copied");
		expect(decoded.keybindings.get("escape")).toBe("cancel-interaction");
		expect(warnSpy).not.toHaveBeenCalled();
	});

	test("filters invalid persisted entries at the boundary and warns", () => {
		const decoded = decodePersistedKeybindingsState({
			state: {
				keybindings: {
					space: "toggle-play",
					"shift+bogus": "toggle-play",
					"ctrl+v": "not-an-action",
				},
				isCustomized: false,
			},
		});

		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected persisted keybindings to decode");

		expect(Array.from(decoded.keybindings.entries())).toEqual([
			["space", "toggle-play"],
		]);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	test("returns null and warns when persisted shape is unrecognizable", () => {
		const decoded = decodePersistedKeybindingsState({ state: "garbage" });
		expect(decoded).toBeNull();
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	test("round-trips actions that have no default shortcut", () => {
		// `stop-playback` is a valid `TActionWithOptionalArgs` but is not in the
		// defaults table; the validator must still accept it.
		const serialized = serializeKeybindingsState({
			keybindings: new Map([
				["space", "toggle-play"],
				["x", "stop-playback"],
				["b", "toggle-bookmark"],
			]),
			isCustomized: true,
		});

		const decoded = decodePersistedKeybindingsState({ state: serialized });
		expect(decoded).not.toBeNull();
		if (!decoded) throw new Error("Expected round-tripped keybindings");

		expect(decoded.keybindings.get("space")).toBe("toggle-play");
		expect(decoded.keybindings.get("x")).toBe("stop-playback");
		expect(decoded.keybindings.get("b")).toBe("toggle-bookmark");
		expect(warnSpy).not.toHaveBeenCalled();
	});
});

describe("parseImportedKeybindings", () => {
	test("accepts a valid configuration", () => {
		const result = parseImportedKeybindings({
			config: {
				space: "toggle-play",
				x: "stop-playback",
			},
		});

		expect(result.get("space")).toBe("toggle-play");
		expect(result.get("x")).toBe("stop-playback");
	});

	test("throws on non-object input", () => {
		expect(() => parseImportedKeybindings({ config: null })).toThrow(
			/JSON object/,
		);
		expect(() => parseImportedKeybindings({ config: [] })).toThrow(
			/JSON object/,
		);
	});

	test("throws on non-string action values", () => {
		expect(() =>
			parseImportedKeybindings({ config: { space: 42 } }),
		).toThrow(/expected string/);
	});

	test("throws on invalid shortcut keys", () => {
		expect(() =>
			parseImportedKeybindings({
				config: { "shift+bogus": "toggle-play" },
			}),
		).toThrow(/shift\+bogus/);
	});

	test("throws on invalid actions", () => {
		expect(() =>
			parseImportedKeybindings({ config: { space: "not-an-action" } }),
		).toThrow(/not-an-action/);
	});
});
