import { describe, expect, test } from "bun:test";
import { transformProjectV16ToV17 } from "../transformers/v16-to-v17";
import { asRecord, asRecordArray } from "./helpers";

describe("V16 to V17 Migration", () => {
	test("adds center stroke alignment to masks that do not have it", () => {
		const result = transformProjectV16ToV17({
			project: {
				id: "project-v16",
				version: 16,
				metadata: {
					id: "project-v16",
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
								id: "track-video",
								type: "video",
								name: "Video Track",
								hidden: false,
								elements: [
									{
										id: "video-1",
										type: "video",
										name: "Clip",
										mediaId: "media-1",
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
										masks: [
											{
												id: "mask-1",
												type: "rectangle",
												params: {
													feather: 0,
													inverted: false,
													strokeColor: "#ffffff",
													strokeWidth: 8,
													centerX: 0,
													centerY: 0,
													width: 0.6,
													height: 0.6,
													rotation: 0,
													scale: 1,
												},
											},
											{
												id: "mask-2",
												type: "ellipse",
												params: {
													feather: 0,
													inverted: false,
													strokeColor: "#ffffff",
													strokeWidth: 8,
													strokeAlign: "outside",
													centerX: 0,
													centerY: 0,
													width: 0.6,
													height: 0.6,
													rotation: 0,
													scale: 1,
												},
											},
										],
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
		expect(result.project.version).toBe(17);

		const firstScene = asRecordArray(result.project.scenes)[0];
		const firstTrack = asRecordArray(firstScene.tracks)[0];
		const firstElement = asRecordArray(firstTrack.elements)[0];
		const migratedMasks = asRecordArray(firstElement.masks);

		expect(asRecord(migratedMasks[0].params).strokeAlign).toBe("center");
		expect(asRecord(migratedMasks[1].params).strokeAlign).toBe("outside");
	});

	test("skips projects already on v17", () => {
		const result = transformProjectV16ToV17({
			project: {
				id: "project-v17",
				version: 17,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v17");
	});

	test("skips projects with no id", () => {
		const result = transformProjectV16ToV17({
			project: {
				version: 16,
				scenes: [],
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("no project id");
	});
});
