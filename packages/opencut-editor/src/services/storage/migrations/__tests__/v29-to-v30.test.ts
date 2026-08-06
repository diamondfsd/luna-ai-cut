import { describe, expect, test } from "bun:test";
import { transformProjectV29ToV30 } from "../transformers/v29-to-v30";
import { asRecord, asRecordArray } from "./helpers";

describe("V29 to V30 Migration", () => {
	test("flattens animation bindings and channels by path", () => {
		const result = transformProjectV29ToV30({
			project: {
				id: "project-v29-animations",
				version: 29,
				scenes: [
					{
						id: "scene-1",
						tracks: {
							main: {
								id: "main",
								type: "video",
								elements: [
									{
										id: "text-1",
										type: "text",
										animations: {
											bindings: {
												opacity: {
													path: "opacity",
													kind: "number",
													components: [
														{ key: "value", channelId: "opacity:value" },
													],
												},
												color: {
													path: "color",
													kind: "color",
													colorSpace: "srgb-linear",
													components: [
														{ key: "r", channelId: "color:r" },
														{ key: "g", channelId: "color:g" },
														{ key: "b", channelId: "color:b" },
														{ key: "a", channelId: "color:a" },
													],
												},
												"params.label": {
													path: "params.label",
													kind: "discrete",
													components: [
														{
															key: "value",
															channelId: "params.label:value",
														},
													],
												},
											},
											channels: {
												"opacity:value": {
													kind: "scalar",
													keys: [{ id: "o1", time: 0, value: 0.5 }],
												},
												"color:r": {
													kind: "scalar",
													keys: [{ id: "c1", time: 0, value: 1 }],
												},
												"color:g": {
													kind: "scalar",
													keys: [{ id: "c1", time: 0, value: 0.5 }],
												},
												"color:b": {
													kind: "scalar",
													keys: [{ id: "c1", time: 0, value: 0 }],
												},
												"color:a": {
													kind: "scalar",
													keys: [{ id: "c1", time: 0, value: 1 }],
												},
												"params.label:value": {
													kind: "discrete",
													keys: [{ id: "d1", time: 0, value: "Title" }],
												},
											},
										},
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
		expect(result.project.version).toBe(30);
		const scene = asRecordArray(result.project.scenes)[0];
		const tracks = asRecord(scene.tracks);
		const main = asRecord(tracks.main);
		const element = asRecordArray(main.elements)[0];
		const animations = asRecord(element.animations);
		expect(animations.bindings).toBeDefined();
		expect(animations.channels).toBeDefined();
		expect(animations).toMatchObject({
			opacity: {
				keys: [{ id: "o1", time: 0, value: 0.5 }],
			},
			color: {
				r: { keys: [{ id: "c1", time: 0, value: 1 }] },
				g: { keys: [{ id: "c1", time: 0, value: 0.5 }] },
				b: { keys: [{ id: "c1", time: 0, value: 0 }] },
				a: { keys: [{ id: "c1", time: 0, value: 1 }] },
			},
			"params.label": {
				keys: [{ id: "d1", time: 0, value: "Title" }],
			},
		});
	});

	test("leaves elements without animations unchanged", () => {
		const result = transformProjectV29ToV30({
			project: {
				id: "project-v29-no-animations",
				version: 29,
				scenes: [
					{
						tracks: {
							main: {
								elements: [{ id: "image-1", type: "image" }],
							},
						},
					},
				],
			},
		});

		const scene = asRecordArray(result.project.scenes)[0];
		const tracks = asRecord(scene.tracks);
		const main = asRecord(tracks.main);
		const element = asRecordArray(main.elements)[0];
		expect(element).toEqual({ id: "image-1", type: "image" });
	});
});
