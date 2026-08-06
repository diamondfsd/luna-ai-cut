import { describe, expect, test } from "bun:test";
import { transformProjectV19ToV20 } from "../transformers/v19-to-v20";
import { asRecordArray } from "./helpers";

describe("V19 to V20 Migration", () => {
	test("backfills source audio enabled state on video elements", () => {
		const result = transformProjectV19ToV20({
			project: {
				id: "project-v19-source-audio",
				version: 19,
				metadata: {
					id: "project-v19-source-audio",
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
						name: "Main",
						isMain: true,
						bookmarks: [],
						createdAt: "2024-01-01T00:00:00.000Z",
						updatedAt: "2024-01-01T00:00:00.000Z",
						tracks: [
							{
								id: "track-video",
								type: "video",
								name: "Video",
								isMain: true,
								muted: false,
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
											position: { x: 0, y: 0 },
											scale: { x: 1, y: 1 },
											rotation: 0,
										},
										opacity: 1,
									},
								],
							},
							{
								id: "track-audio",
								type: "audio",
								name: "Audio",
								muted: false,
								elements: [
									{
										id: "audio-1",
										type: "audio",
										sourceType: "upload",
										mediaId: "media-audio-1",
										name: "Audio",
										duration: 5,
										startTime: 0,
										trimStart: 0,
										trimEnd: 0,
										volume: 0,
									},
								],
							},
						],
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(20);
		const scene = asRecordArray(result.project.scenes)[0];
		const tracks = asRecordArray(scene.tracks);
		expect(tracks[0].elements).toEqual([
			expect.objectContaining({
				id: "video-1",
				isSourceAudioEnabled: true,
			}),
		]);
		expect(
			asRecordArray(tracks[1].elements)[0].isSourceAudioEnabled,
		).toBeUndefined();
	});

	test("preserves existing explicit source audio state", () => {
		const result = transformProjectV19ToV20({
			project: {
				id: "project-v19-existing-state",
				version: 19,
				scenes: [
					{
						tracks: [
							{
								elements: [
									{
										type: "video",
										isSourceAudioEnabled: false,
									},
								],
							},
						],
					},
				],
			},
		});

		const scene = asRecordArray(result.project.scenes)[0];
		const track = asRecordArray(scene.tracks)[0];
		const element = asRecordArray(track.elements)[0];
		expect(element.isSourceAudioEnabled).toBe(false);
	});

	test("skips projects already on v20", () => {
		const result = transformProjectV19ToV20({
			project: {
				id: "project-v20",
				version: 20,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v20");
	});
});
