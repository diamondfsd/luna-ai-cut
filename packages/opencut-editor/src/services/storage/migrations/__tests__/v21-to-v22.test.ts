import { describe, expect, test } from "bun:test";
import { transformProjectV21ToV22 } from "../transformers/v21-to-v22";
import { asRecord, asRecordArray } from "./helpers";

describe("V21 to V22 Migration", () => {
	test("migrates legacy animation channels to bindings and component channels", () => {
		const result = transformProjectV21ToV22({
			project: {
				id: "project-v21-animations",
				version: 21,
				scenes: [
					{
						id: "scene-1",
						tracks: [
							{
								id: "track-1",
								elements: [
									{
										id: "element-1",
										type: "text",
										animations: {
											channels: {
												opacity: {
													valueKind: "number",
													keyframes: [
														{
															id: "opacity-1",
															time: 1,
															value: 0.5,
															interpolation: "linear",
														},
													],
												},
												"transform.position": {
													valueKind: "vector",
													keyframes: [
														{
															id: "position-1",
															time: 2,
															value: { x: 10, y: 20 },
															interpolation: "hold",
														},
													],
												},
												color: {
													valueKind: "color",
													keyframes: [
														{
															id: "color-1",
															time: 3,
															value: "#ff0000",
															interpolation: "linear",
														},
													],
												},
												"effects.effect-1.params.enabled": {
													valueKind: "discrete",
													keyframes: [
														{
															id: "enabled-1",
															time: 4,
															value: true,
															interpolation: "hold",
														},
													],
												},
											},
										},
									},
								],
							},
						],
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(22);

		const scenes = asRecordArray(result.project.scenes);
		const tracks = asRecordArray(scenes[0].tracks);
		const elements = asRecordArray(tracks[0].elements);
		const animations = asRecord(elements[0].animations);
		const bindings = asRecord(animations.bindings);
		const channels = asRecord(animations.channels);

		expect(bindings.opacity).toEqual({
			path: "opacity",
			kind: "number",
			components: [{ key: "value", channelId: "opacity:value" }],
		});
		expect(bindings["transform.position"]).toEqual({
			path: "transform.position",
			kind: "vector2",
			components: [
				{ key: "x", channelId: "transform.position:x" },
				{ key: "y", channelId: "transform.position:y" },
			],
		});
		expect(bindings.color).toEqual({
			path: "color",
			kind: "color",
			colorSpace: "srgb-linear",
			components: [
				{ key: "r", channelId: "color:r" },
				{ key: "g", channelId: "color:g" },
				{ key: "b", channelId: "color:b" },
				{ key: "a", channelId: "color:a" },
			],
		});
		expect(bindings["effects.effect-1.params.enabled"]).toEqual({
			path: "effects.effect-1.params.enabled",
			kind: "discrete",
			components: [
				{
					key: "value",
					channelId: "effects.effect-1.params.enabled:value",
				},
			],
		});

		expect(channels["opacity:value"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "opacity-1",
					time: 1,
					value: 0.5,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["transform.position:x"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "position-1",
					time: 2,
					value: 10,
					segmentToNext: "step",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["transform.position:y"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "position-1",
					time: 2,
					value: 20,
					segmentToNext: "step",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["color:r"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "color-1",
					time: 3,
					value: 1,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["color:g"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "color-1",
					time: 3,
					value: 0,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["color:b"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "color-1",
					time: 3,
					value: 0,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["color:a"]).toEqual({
			kind: "scalar",
			keys: [
				{
					id: "color-1",
					time: 3,
					value: 1,
					segmentToNext: "linear",
					tangentMode: "flat",
				},
			],
		});
		expect(channels["effects.effect-1.params.enabled:value"]).toEqual({
			kind: "discrete",
			keys: [
				{
					id: "enabled-1",
					time: 4,
					value: true,
				},
			],
		});
	});

	test("skips projects already on v22", () => {
		const result = transformProjectV21ToV22({
			project: {
				id: "project-v22",
				version: 22,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v22");
	});

	test("skips projects not on v21", () => {
		const result = transformProjectV21ToV22({
			project: {
				id: "project-v20",
				version: 20,
			},
		});

		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v21");
	});
});
