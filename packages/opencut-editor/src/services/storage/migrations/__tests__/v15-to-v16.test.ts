import { describe, expect, test } from "bun:test";
import { transformProjectV15ToV16 } from "../transformers/v15-to-v16";
import { asRecordArray } from "./helpers";

describe("V15 to V16 Migration", () => {
	test("renames sticker tracks to graphic tracks", () => {
		const result = transformProjectV15ToV16({
			project: {
				id: "project-v15",
				version: 15,
				metadata: {
					id: "project-v15",
					name: "Project",
					createdAt: "2024-01-01T00:00:00.000Z",
					updatedAt: "2024-01-01T00:00:00.000Z",
				},
				settings: {
					fps: 30,
					canvasSize: { width: 1920, height: 1080 },
					background: { type: "color", color: "#000000" },
				},
				currentSceneId: "scene-main",
				scenes: [
					{
						id: "scene-main",
						name: "Main scene",
						isMain: true,
						tracks: [
							{
								id: "track-graphic",
								type: "sticker",
								name: "Sticker Track",
								hidden: false,
								elements: [
									{
										id: "sticker-1",
										type: "sticker",
										name: "Logo",
										stickerId: "icons:mdi:home",
										duration: 5,
										startTime: 0,
										trimStart: 0,
										trimEnd: 0,
										transform: {
											scaleX: 1,
											scaleY: 1,
											position: { x: 0, y: 0 },
											rotate: 0,
										},
										opacity: 1,
									},
								],
							},
						],
						bookmarks: [],
						createdAt: "2024-01-01T00:00:00.000Z",
						updatedAt: "2024-01-01T00:00:00.000Z",
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(16);
		const firstTrack = asRecordArray(
			asRecordArray(result.project.scenes)[0].tracks,
		)[0];
		expect(firstTrack.type).toBe("graphic");
	});

	test("skips projects already on v16", () => {
		const result = transformProjectV15ToV16({
			project: {
				id: "project-v16",
				version: 16,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v16");
	});

	test("skips projects with no id", () => {
		const result = transformProjectV15ToV16({
			project: {
				version: 15,
				scenes: [],
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("no project id");
	});
});
