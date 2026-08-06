import { describe, expect, test } from "bun:test";
import { transformProjectV18ToV19 } from "../transformers/v18-to-v19";
import { asRecord } from "./helpers";

describe("V18 to V19 Migration", () => {
	test("adds canvas size mode and empty remembered custom size defaults", () => {
		const result = transformProjectV18ToV19({
			project: {
				id: "project-v18-defaults",
				version: 18,
				metadata: {
					id: "project-v18-defaults",
					name: "Project",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
				},
				settings: {
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					originalCanvasSize: { width: 1920, height: 1080 },
					background: { type: "color", color: "#000000" },
				},
				currentSceneId: "scene-main",
				scenes: [],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(19);
		const settings = asRecord(result.project.settings);
		expect(settings.canvasSizeMode).toBe("preset");
		expect(settings.lastCustomCanvasSize).toBeNull();
		expect(settings.originalCanvasSize).toEqual({
			width: 1920,
			height: 1080,
		});
	});

	test("skips projects already on v19", () => {
		const result = transformProjectV18ToV19({
			project: {
				id: "project-v19",
				version: 19,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v19");
	});

	test("skips projects with no id", () => {
		const result = transformProjectV18ToV19({
			project: {
				version: 18,
				scenes: [],
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("no project id");
	});
});
