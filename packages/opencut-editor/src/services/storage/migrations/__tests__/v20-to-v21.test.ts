import { describe, expect, test } from "bun:test";
import { transformProjectV20ToV21 } from "../transformers/v20-to-v21";
import { asRecord } from "./helpers";

const LEGACY_DEFAULT_BACKGROUND_BLUR_INTENSITY = 50;

describe("V20 to V21 Migration", () => {
	test("multiplies blur background intensity by 5", () => {
		const result = transformProjectV20ToV21({
			project: {
				id: "project-v20-blur",
				version: 20,
				metadata: {
					id: "project-v20-blur",
					name: "Project",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
				},
				settings: {
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					background: { type: "blur", blurIntensity: 100 },
				},
				currentSceneId: "scene-main",
				scenes: [],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(21);
		const settings = asRecord(result.project.settings);
		const background = asRecord(settings.background);
		expect(background.blurIntensity).toBe(500);
	});

	test("uses default blur intensity when blur type but intensity missing", () => {
		const result = transformProjectV20ToV21({
			project: {
				id: "project-v20-blur-no-intensity",
				version: 20,
				settings: {
					background: { type: "blur" },
				},
				scenes: [],
			},
		});

		expect(result.skipped).toBe(false);
		const settings = asRecord(result.project.settings);
		const background = asRecord(settings.background);
		expect(background.blurIntensity).toBe(
			LEGACY_DEFAULT_BACKGROUND_BLUR_INTENSITY,
		);
	});

	test("leaves color background unchanged", () => {
		const result = transformProjectV20ToV21({
			project: {
				id: "project-v20-color",
				version: 20,
				settings: {
					background: { type: "color", color: "#000000" },
				},
				scenes: [],
			},
		});

		expect(result.skipped).toBe(false);
		const settings = asRecord(result.project.settings);
		expect(settings.background).toEqual({ type: "color", color: "#000000" });
	});

	test("skips projects already on v21", () => {
		const result = transformProjectV20ToV21({
			project: {
				id: "project-v21",
				version: 21,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v21");
	});

	test("skips projects not on v20", () => {
		const result = transformProjectV20ToV21({
			project: {
				id: "project-v19",
				version: 19,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v20");
	});
});
