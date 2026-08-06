import { describe, expect, test } from "bun:test";
import { transformProjectV22ToV23 } from "../transformers/v22-to-v23";
import { asRecord, asRecordArray } from "./helpers";

describe("V22 to V23 Migration", () => {
	test("converts project time values from seconds to ticks and fps to a frame-rate object", () => {
		const result = transformProjectV22ToV23({
			project: {
				id: "project-v22-time",
				version: 22,
				metadata: {
					id: "project-v22-time",
					name: "Project",
					duration: 15.5,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
				settings: {
					fps: 29.97,
					canvasSize: { width: 1920, height: 1080 },
					background: { type: "color", color: "#000000" },
				},
				timelineViewState: {
					zoomLevel: 1,
					scrollLeft: 120,
					playheadTime: 1.25,
				},
				scenes: [
					{
						id: "scene-1",
					bookmarks: [
						{ time: 2.5, duration: 0.75, note: "Marker", color: "#ff0000" },
						{ time: 4.5 },
					],
						tracks: [
							{
								id: "track-1",
								type: "video",
								elements: [
									{
										id: "element-1",
										type: "video",
										startTime: 1.25,
										duration: 5.5,
										trimStart: 0.25,
										trimEnd: 0.5,
										sourceDuration: 6.25,
										animations: {
											bindings: {
												opacity: {
													path: "opacity",
													kind: "number",
													components: [
														{
															key: "value",
															channelId: "opacity:value",
														},
													],
												},
											},
											channels: {
												"opacity:value": {
													kind: "scalar",
													keys: [
														{
															id: "key-1",
															time: 0.5,
															value: 1,
															segmentToNext: "bezier",
															tangentMode: "flat",
															rightHandle: {
																dt: 0.25,
																dv: 0.2,
															},
														},
														{
															id: "key-2",
															time: 1.0,
															value: 0.4,
															segmentToNext: "linear",
															tangentMode: "flat",
															leftHandle: {
																dt: -0.125,
																dv: -0.1,
															},
														},
													],
												},
											},
										},
									},
								],
							},
						],
						createdAt: "2026-01-01T00:00:00.000Z",
						updatedAt: "2026-01-01T00:00:00.000Z",
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(23);

		const metadata = asRecord(result.project.metadata);
		expect(metadata.duration).toBe(1_860_000);

		const settings = asRecord(result.project.settings);
		expect(settings.fps).toEqual({ numerator: 30_000, denominator: 1_001 });

		const timelineViewState = asRecord(result.project.timelineViewState);
		expect(timelineViewState.playheadTime).toBe(150_000);
		expect(timelineViewState.scrollLeft).toBe(120);

		const scenes = asRecordArray(result.project.scenes);
		const scene = scenes[0];
		expect(scene.bookmarks).toEqual([
			{
				time: 300_000,
				duration: 90_000,
				note: "Marker",
				color: "#ff0000",
			},
			{ time: 540_000 },
		]);

		const tracks = asRecordArray(scene.tracks);
		const elements = asRecordArray(tracks[0].elements);
		const element = elements[0];
		expect(element.startTime).toBe(150_000);
		expect(element.duration).toBe(660_000);
		expect(element.trimStart).toBe(30_000);
		expect(element.trimEnd).toBe(60_000);
		expect(element.sourceDuration).toBe(750_000);

		const animations = asRecord(element.animations);
		const channels = asRecord(animations.channels);
		expect(channels["opacity:value"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "key-1",
					time: 60_000,
					value: 1,
					segmentToNext: "bezier",
					tangentMode: "flat",
					rightHandle: {
						dt: 30_000,
						dv: 0.2,
					},
				},
				{
					id: "key-2",
					time: 120_000,
					value: 0.4,
					segmentToNext: "linear",
					tangentMode: "flat",
					leftHandle: {
						dt: -15_000,
						dv: -0.1,
					},
				},
			],
		});
	});

	test("skips projects already on v23", () => {
		const result = transformProjectV22ToV23({
			project: {
				id: "project-v23",
				version: 23,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v23");
	});

	test("skips projects not on v22", () => {
		const result = transformProjectV22ToV23({
			project: {
				id: "project-v21",
				version: 21,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v22");
	});
});
