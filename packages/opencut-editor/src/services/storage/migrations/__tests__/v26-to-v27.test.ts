import { describe, expect, test } from "bun:test";
import { transformProjectV26ToV27 } from "../transformers/v26-to-v27";
import { asRecord, asRecordArray } from "./helpers";

describe("V26 to V27 Migration", () => {
	test("converts custom mask paths from JSON strings to typed point arrays", () => {
		const result = transformProjectV26ToV27({
			project: {
				id: "project-v26-custom-mask",
				version: 26,
				scenes: [
					{
						id: "scene-1",
						tracks: {
							main: {
								id: "track-1",
								type: "video",
								elements: [
									{
										id: "element-1",
										type: "image",
										masks: [
											{
												id: "mask-custom",
												type: "custom",
												params: {
													path: JSON.stringify([
														{
															id: "point-1",
															x: 0,
															y: 0,
															inX: 0,
															inY: 0,
															outX: 0.1,
															outY: 0,
														},
													]),
													closed: false,
												},
											},
											{
												id: "mask-rectangle",
												type: "rectangle",
												params: {
													width: 0.5,
												},
											},
										],
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
		expect(result.project.version).toBe(27);

		const scenes = asRecordArray(result.project.scenes);
		const tracks = asRecord(scenes[0].tracks);
		const mainTrack = asRecord(tracks.main);
		const elements = asRecordArray(mainTrack.elements);
		const masks = asRecordArray(elements[0].masks);
		const customParams = asRecord(masks[0].params);
		const rectangleParams = asRecord(masks[1].params);

		expect(customParams.path).toEqual([
			{
				id: "point-1",
				x: 0,
				y: 0,
				inX: 0,
				inY: 0,
				outX: 0.1,
				outY: 0,
			},
		]);
		expect(rectangleParams.width).toBe(0.5);
	});
});
