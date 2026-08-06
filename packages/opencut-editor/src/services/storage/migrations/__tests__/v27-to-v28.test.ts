import { describe, expect, test } from "bun:test";
import { transformProjectV27ToV28 } from "../transformers/v27-to-v28";
import { asRecord, asRecordArray } from "./helpers";

describe("V27 to V28 Migration", () => {
	test("rounds persisted media-time floats back to integer ticks", () => {
		const result = transformProjectV27ToV28({
			project: {
				id: "project-v27-float-time",
				version: 27,
				metadata: {
					id: "project-v27-float-time",
					name: "Project",
					duration: 2_152_466.3677130044,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
				settings: {
					fps: { numerator: 30, denominator: 1 },
					canvasSize: { width: 1920, height: 1080 },
					background: { type: "color", color: "#000000" },
				},
				timelineViewState: {
					zoomLevel: 1.25,
					scrollLeft: 120,
					playheadTime: 301_234.8,
				},
				scenes: [
					{
						id: "scene-1",
						name: "Scene 1",
						isMain: true,
						bookmarks: [
							{
								time: 120_000.4,
								duration: 60_000.6,
								note: "Marker",
								color: "#ff0000",
							},
						],
						tracks: {
							main: {
								id: "main-track",
								type: "video",
								name: "Main",
								muted: false,
								hidden: false,
								elements: [
									{
										id: "element-1",
										type: "video",
										name: "Clip",
										startTime: 300_000.49,
										duration: 2_152_466.3677130044,
										trimStart: 30_000.2,
										trimEnd: 15_000.7,
										sourceDuration: 2_197_467.6,
										mediaId: "media-1",
										transform: {
											scaleX: 1,
											scaleY: 1,
											position: { x: 0, y: 0 },
											rotate: 0,
										},
										opacity: 1,
										animations: {
											channels: {
												opacity: {
													kind: "scalar",
													keys: [
														{
															id: "key-1",
															time: 1_000.6,
															value: 1,
															segmentToNext: "bezier",
															tangentMode: "flat",
															leftHandle: { dt: -120.6, dv: 0 },
															rightHandle: { dt: 60.4, dv: 0 },
														},
													],
												},
											},
										},
									},
								],
							},
							overlay: [],
							audio: [],
						},
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(28);

		const metadata = asRecord(result.project.metadata);
		expect(metadata.duration).toBe(2_152_466);

		const timelineViewState = asRecord(result.project.timelineViewState);
		expect(timelineViewState.playheadTime).toBe(301_235);
		expect(timelineViewState.zoomLevel).toBe(1.25);
		expect(timelineViewState.scrollLeft).toBe(120);

		const scenes = asRecordArray(result.project.scenes);
		const scene = scenes[0];
		expect(scene.bookmarks).toEqual([
			{
				time: 120_000,
				duration: 60_001,
				note: "Marker",
				color: "#ff0000",
			},
		]);

		const tracks = asRecord(scene.tracks);
		const mainTrack = asRecord(tracks.main);
		const elements = asRecordArray(mainTrack.elements);
		const element = elements[0];
		expect(element.startTime).toBe(300_000);
		expect(element.duration).toBe(2_152_466);
		expect(element.trimStart).toBe(30_000);
		expect(element.trimEnd).toBe(15_001);
		expect(element.sourceDuration).toBe(2_197_468);

		const animations = asRecord(element.animations);
		const channels = asRecord(animations.channels);
		const opacityChannel = asRecord(channels.opacity);
		expect(opacityChannel.keys).toEqual([
			{
				id: "key-1",
				time: 1_001,
				value: 1,
				segmentToNext: "bezier",
				tangentMode: "flat",
				leftHandle: { dt: -121, dv: 0 },
				rightHandle: { dt: 60, dv: 0 },
			},
		]);
	});

	test("keeps already-integer media-time values unchanged", () => {
		const result = transformProjectV27ToV28({
			project: {
				id: "project-v27-integer-time",
				version: 27,
				metadata: {
					id: "project-v27-integer-time",
					name: "Project",
					duration: 120_000,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
				timelineViewState: {
					zoomLevel: 2,
					scrollLeft: 300,
					playheadTime: 30_000,
				},
				scenes: [
					{
						id: "scene-1",
						bookmarks: [{ time: 60_000, duration: 15_000 }],
						tracks: {
							main: {
								id: "main-track",
								type: "video",
								name: "Main",
								muted: false,
								hidden: false,
								elements: [
									{
										id: "element-1",
										type: "video",
										name: "Clip",
										startTime: 10_000,
										duration: 20_000,
										trimStart: 1_000,
										trimEnd: 2_000,
										sourceDuration: 23_000,
										mediaId: "media-1",
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
							overlay: [],
							audio: [],
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(28);

		const metadata = asRecord(result.project.metadata);
		expect(metadata.duration).toBe(120_000);

		const timelineViewState = asRecord(result.project.timelineViewState);
		expect(timelineViewState).toEqual({
			zoomLevel: 2,
			scrollLeft: 300,
			playheadTime: 30_000,
		});

		const scenes = asRecordArray(result.project.scenes);
		const scene = scenes[0];
		expect(scene.bookmarks).toEqual([{ time: 60_000, duration: 15_000 }]);

		const tracks = asRecord(scene.tracks);
		const mainTrack = asRecord(tracks.main);
		const element = asRecordArray(mainTrack.elements)[0];
		expect(element.startTime).toBe(10_000);
		expect(element.duration).toBe(20_000);
		expect(element.trimStart).toBe(1_000);
		expect(element.trimEnd).toBe(2_000);
		expect(element.sourceDuration).toBe(23_000);
	});

	test("skips projects already on v28", () => {
		const result = transformProjectV27ToV28({
			project: {
				id: "project-v28",
				version: 28,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v28");
	});

	test("skips projects not on v27", () => {
		const result = transformProjectV27ToV28({
			project: {
				id: "project-v26",
				version: 26,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v27");
	});
});
