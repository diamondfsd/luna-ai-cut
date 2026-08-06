import { describe, expect, test } from "bun:test";
import { transformProjectV28ToV29 } from "../transformers/v28-to-v29";
import { asRecord, asRecordArray } from "./helpers";

describe("V28 to V29 Migration", () => {
	test("copies built-in element fields into params without deleting source fields", () => {
		const result = transformProjectV28ToV29({
			project: {
				id: "project-v28-builtins",
				version: 28,
				scenes: [
					{
						id: "scene-1",
						tracks: {
							main: {
								id: "main",
								type: "video",
								elements: [
									{
										id: "video-1",
										type: "video",
										name: "Video",
										transform: {
											position: { x: 12, y: -4 },
											scaleX: 1.25,
											scaleY: 0.75,
											rotate: 9,
										},
										opacity: 0.5,
										blendMode: "multiply",
										volume: -6,
										muted: true,
									},
								],
							},
							overlay: [
								{
									id: "text-track",
									type: "text",
									elements: [
										{
											id: "text-1",
											type: "text",
											name: "Text",
											content: "Hello",
											fontSize: 20,
											fontFamily: "Inter",
											color: "#eeeeee",
											textAlign: "left",
											fontWeight: "bold",
											fontStyle: "italic",
											textDecoration: "underline",
											letterSpacing: 1.5,
											lineHeight: 1.4,
											background: {
												enabled: true,
												color: "#111111",
												paddingX: 10,
												paddingY: 12,
											},
											transform: {
												position: { x: 1, y: 2 },
												scaleX: 1,
												scaleY: 1,
												rotate: 0,
											},
											opacity: 1,
										},
									],
								},
							],
							audio: [],
						},
					},
				],
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.version).toBe(29);

		const scene = asRecordArray(result.project.scenes)[0];
		const tracks = asRecord(scene.tracks);
		const main = asRecord(tracks.main);
		const video = asRecordArray(main.elements)[0];
		expect(video.transform).toEqual({
			position: { x: 12, y: -4 },
			scaleX: 1.25,
			scaleY: 0.75,
			rotate: 9,
		});
		expect(video.opacity).toBe(0.5);
		expect(video.volume).toBe(-6);
		expect(video.muted).toBe(true);
		expect(video.params).toEqual({
			"transform.positionX": 12,
			"transform.positionY": -4,
			"transform.scaleX": 1.25,
			"transform.scaleY": 0.75,
			"transform.rotate": 9,
			opacity: 0.5,
			blendMode: "multiply",
			volume: -6,
			muted: true,
		});

		const overlay = asRecordArray(tracks.overlay)[0];
		const text = asRecordArray(asRecord(overlay).elements)[0];
		expect(text.content).toBe("Hello");
		expect(text.background).toEqual({
			enabled: true,
			color: "#111111",
			paddingX: 10,
			paddingY: 12,
		});
		expect(text.params).toMatchObject({
			content: "Hello",
			fontSize: 20,
			fontFamily: "Inter",
			color: "#eeeeee",
			textAlign: "left",
			fontWeight: "bold",
			fontStyle: "italic",
			textDecoration: "underline",
			letterSpacing: 1.5,
			lineHeight: 1.4,
			"background.enabled": true,
			"background.color": "#111111",
			"background.paddingX": 10,
			"background.paddingY": 12,
			"transform.positionX": 1,
			"transform.positionY": 2,
		});
	});
});
