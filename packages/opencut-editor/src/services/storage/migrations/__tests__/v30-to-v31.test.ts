import { describe, expect, test } from "bun:test";
import { transformProjectV30ToV31 } from "../transformers/v30-to-v31";
import { asRecord, asRecordArray } from "./helpers";

describe("V30 to V31 Migration", () => {
	test("renames custom masks to freeform without changing params", () => {
		const params = {
			feather: 0,
			inverted: false,
			strokeColor: "#ffffff",
			strokeWidth: 0,
			strokeAlign: "center",
			path: [{ id: "p1", x: 0, y: 0, inX: 0, inY: 0, outX: 0, outY: 0 }],
			closed: true,
			centerX: 0,
			centerY: 0,
			rotation: 0,
			scale: 1,
		};

		const result = transformProjectV30ToV31({
			project: {
				id: "project-v30-freeform",
				version: 30,
				scenes: [
					{
						tracks: {
							main: {
								elements: [
									{
										id: "image-1",
										type: "image",
										masks: [{ id: "mask-1", type: "custom", params }],
									},
								],
							},
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(31);
		const scene = asRecordArray(result.project.scenes)[0];
		const tracks = asRecord(scene.tracks);
		const main = asRecord(tracks.main);
		const element = asRecordArray(main.elements)[0];
		const mask = asRecordArray(asRecord(element).masks)[0];
		expect(mask).toMatchObject({
			id: "mask-1",
			type: "freeform",
			params,
		});
		expect(asRecord(mask).legacyType).toBeUndefined();
	});

	test("leaves a type:freeform mask in a v30 project unchanged", () => {
		const result = transformProjectV30ToV31({
			project: {
				id: "project-v30-already-freeform",
				version: 30,
				scenes: [
					{
						tracks: {
							main: {
								elements: [
									{
										id: "elem-1",
										masks: [{ id: "m1", type: "freeform", params: {} }],
									},
								],
							},
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		const scene = asRecordArray(result.project.scenes)[0];
		const main = asRecord(asRecord(scene.tracks).main);
		const element = asRecordArray(main.elements)[0];
		expect(asRecordArray(asRecord(element).masks)[0]).toMatchObject({
			id: "m1",
			type: "freeform",
		});
	});

	test("leaves elements without a masks array unchanged", () => {
		const result = transformProjectV30ToV31({
			project: {
				id: "project-v30-no-masks",
				version: 30,
				scenes: [
					{
						tracks: {
							main: {
								elements: [{ id: "elem-1", type: "video" }],
							},
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		const scene = asRecordArray(result.project.scenes)[0];
		const main = asRecord(asRecord(scene.tracks).main);
		const element = asRecordArray(main.elements)[0];
		expect(element).toMatchObject({ id: "elem-1", type: "video" });
	});

	test("skips a project that is already v31", () => {
		const project = { id: "p1", version: 31, scenes: [] };
		const result = transformProjectV30ToV31({ project });
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v31");
		expect(result.project).toBe(project);
	});

	test("skips a project that is not v30", () => {
		const project = { id: "p1", version: 29, scenes: [] };
		const result = transformProjectV30ToV31({ project });
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v30");
		expect(result.project).toBe(project);
	});
});
