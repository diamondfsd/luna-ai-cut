import { describe, expect, test } from "bun:test";
import {
	getProjectId,
	transformProjectV1ToV2,
	type V1ToV2Context,
} from "../transformers/v1-to-v2";
import {
	projectWithNoId,
	projectWithNullValues,
	v1Project,
	v1ProjectWithMultipleScenes,
	v2Project,
} from "./fixtures";
import { asRecord, asRecordArray } from "./helpers";

const DEFAULT_FPS = 30;
const DEFAULT_BACKGROUND_BLUR_INTENSITY = 10;
const DEFAULT_BACKGROUND_COLOR = "#000000";
const DEFAULT_CANVAS_SIZE = { width: 1920, height: 1080 };

describe("V1 to V2 Migration", () => {
	describe("transformProjectV1ToV2", () => {
		test("creates metadata object from flat properties", () => {
			const result = transformProjectV1ToV2({ project: v1Project });

			expect(result.skipped).toBe(false);
			expect(result.project.version).toBe(2);

			const metadata = asRecord(result.project.metadata);
			expect(metadata.id).toBe(v1Project.id);
			expect(metadata.name).toBe(v1Project.name);
			expect(typeof metadata.createdAt).toBe("string");
			expect(typeof metadata.updatedAt).toBe("string");
		});

		test("creates settings object from flat properties", () => {
			const result = transformProjectV1ToV2({ project: v1Project });

			const settings = asRecord(result.project.settings);
			expect(settings.fps).toBe(v1Project.fps);
			expect(settings.canvasSize).toEqual(v1Project.canvasSize);
			expect(settings.originalCanvasSize).toBe(null);
		});

		test("converts color background correctly", () => {
			const result = transformProjectV1ToV2({ project: v1Project });

			const settings = asRecord(result.project.settings);
			const background = asRecord(settings.background);
			expect(background.type).toBe("color");
			expect(background.color).toBe(v1Project.backgroundColor);
		});

		test("converts blur background correctly", () => {
			const projectWithBlur = {
				...v1Project,
				backgroundType: "blur",
				blurIntensity: 30,
			};
			const result = transformProjectV1ToV2({ project: projectWithBlur });

			const settings = asRecord(result.project.settings);
			const background = asRecord(settings.background);
			expect(background.type).toBe("blur");
			expect(background.blurIntensity).toBe(30);
		});

		test("applies legacy bookmarks to main scene", () => {
			const result = transformProjectV1ToV2({ project: v1Project });

			const scenes = asRecordArray(result.project.scenes);
			const mainScene = scenes.find((s) => s.isMain === true);
			expect(mainScene?.bookmarks).toEqual(v1Project.bookmarks);
		});

		test("preserves existing scene bookmarks", () => {
			const result = transformProjectV1ToV2({
				project: v1ProjectWithMultipleScenes,
			});

			const scenes = asRecordArray(result.project.scenes);
			const introScene = scenes.find((s) => s.name === "Intro");
			expect(introScene?.bookmarks).toEqual([1.0]);
		});

		test("skips project that already has v2 structure", () => {
			const result = transformProjectV1ToV2({ project: v2Project });

			expect(result.skipped).toBe(true);
			expect(result.reason).toBe("already v2");
		});

		test("skips project with no id", () => {
			const result = transformProjectV1ToV2({ project: projectWithNoId });

			expect(result.skipped).toBe(true);
			expect(result.reason).toBe("no project id");
		});

		test("handles null values gracefully", () => {
			const result = transformProjectV1ToV2({
				project: projectWithNullValues,
			});

			expect(result.skipped).toBe(false);
			const settings = asRecord(result.project.settings);
			expect(settings.fps).toBe(DEFAULT_FPS);
			expect(settings.canvasSize).toEqual(DEFAULT_CANVAS_SIZE);
		});

		test("uses default values for missing properties", () => {
			const minimalProject = {
				id: "minimal",
				version: 1,
				scenes: [],
			};
			const result = transformProjectV1ToV2({ project: minimalProject });

			const settings = asRecord(result.project.settings);
			expect(settings.fps).toBe(DEFAULT_FPS);
			expect(settings.canvasSize).toEqual(DEFAULT_CANVAS_SIZE);

			const background = asRecord(settings.background);
			expect(background.type).toBe("color");
			expect(background.color).toBe(DEFAULT_BACKGROUND_COLOR);
		});

		test("uses default blur intensity when missing", () => {
			const projectWithBlurNoIntensity = {
				id: "blur-no-intensity",
				version: 1,
				backgroundType: "blur",
				scenes: [],
			};
			const result = transformProjectV1ToV2({
				project: projectWithBlurNoIntensity,
			});

			const settings = asRecord(result.project.settings);
			const background = asRecord(settings.background);
			expect(background.blurIntensity).toBe(DEFAULT_BACKGROUND_BLUR_INTENSITY);
		});

		test("preserves currentSceneId", () => {
			const result = transformProjectV1ToV2({ project: v1Project });
			expect(result.project.currentSceneId).toBe(v1Project.currentSceneId);
		});

		test("finds main scene id when currentSceneId missing", () => {
			const projectWithoutCurrentScene = {
				...v1Project,
				currentSceneId: undefined,
			};
			const result = transformProjectV1ToV2({
				project: projectWithoutCurrentScene,
			});
			expect(result.project.currentSceneId).toBe("scene-main");
		});

		test("skips loading tracks if scene already has tracks", () => {
			const projectWithTracks = {
				...v1Project,
				scenes: [
					{
						id: "scene-main",
						name: "Main scene",
						isMain: true,
						tracks: [
							{
								id: "track-1",
								type: "video",
								name: "Existing Track",
								elements: [],
							},
						],
						bookmarks: [],
						createdAt: "2024-01-15T10:00:00.000Z",
						updatedAt: "2024-01-15T12:00:00.000Z",
					},
				],
			};

			const result = transformProjectV1ToV2({
				project: projectWithTracks,
			});

			const scenes = asRecordArray(result.project.scenes);
			const mainScene = scenes[0];
			const tracks = asRecordArray(mainScene.tracks);
			expect(tracks.length).toBe(1);
			expect(tracks[0].name).toBe("Existing Track");
		});
	});

	describe("Track Loading and Transformation", () => {
		test("loads tracks from legacy DB and transforms media track to video track", () => {
			const context: V1ToV2Context = {
				legacyTracksBySceneId: {
					"scene-main": [
						{
							id: "legacy-track-1",
							type: "media",
							name: "Legacy media track",
							elements: [
								{
									id: "media-element-1",
									name: "Test video clip",
									type: "media",
									mediaId: "media-1",
									duration: 120,
									startTime: 0,
									trimStart: 0,
									trimEnd: 0,
								},
							],
						},
					],
				},
				mediaTypesById: {
					"media-1": "video",
				},
			};

			const projectWithLegacyTracks = {
				...v1Project,
				scenes: [
					{
						id: "scene-main",
						name: "Main scene",
						isMain: true,
						tracks: [],
						bookmarks: [],
						createdAt: "2024-01-15T10:00:00.000Z",
						updatedAt: "2024-01-15T12:00:00.000Z",
					},
				],
			};

			const result = transformProjectV1ToV2({
				project: projectWithLegacyTracks,
				context,
			});

			const scenes = asRecordArray(result.project.scenes);
			const mainScene = scenes[0];
			const tracks = asRecordArray(mainScene.tracks);
			expect(Array.isArray(tracks)).toBe(true);
			expect(tracks).toHaveLength(1);
			expect(tracks[0].type).toBe("video");
			expect(tracks[0].isMain).toBe(true);
		});

		test("transforms text element preserving opacity and migrating position", () => {
			const context: V1ToV2Context = {
				legacyTracksBySceneId: {
					"scene-1": [
						{
							id: "legacy-text-track",
							type: "text",
							name: "Text",
							elements: [
								{
									id: "text-element-1",
									name: "Title",
									type: "text",
									content: "Hello",
									x: 120,
									y: 240,
									rotation: 15,
									opacity: 0.5,
									duration: 90,
									startTime: 10,
									trimStart: 0,
									trimEnd: 0,
								},
							],
						},
					],
				},
				mediaTypesById: {},
			};

			const projectWithTextTrack = {
				id: "project-text",
				version: 1,
				name: "Text Project",
				scenes: [
					{
						id: "scene-1",
						name: "Scene",
						isMain: true,
						tracks: [],
						bookmarks: [],
						createdAt: "2024-01-01T00:00:00.000Z",
						updatedAt: "2024-01-01T00:00:00.000Z",
					},
				],
			};

			const result = transformProjectV1ToV2({
				project: projectWithTextTrack,
				context,
			});

			expect(result.skipped).toBe(false);
			const scenes = asRecordArray(result.project.scenes);
			const tracks = asRecordArray(scenes[0].tracks);
			const elements = asRecordArray(tracks[0].elements);
			const textElement = elements[0];
			expect(textElement.opacity).toBe(0.5);
			expect(textElement.transform).toEqual({
				scale: 1,
				position: { x: 120, y: 240 },
				rotate: 15,
			});
		});
	});

	describe("getProjectId", () => {
		test("returns id from root level", () => {
			const id = getProjectId({ project: v1Project });
			expect(id).toBe("project-v1-123");
		});

		test("returns id from metadata", () => {
			const id = getProjectId({ project: v1ProjectWithMultipleScenes });
			expect(id).toBe("project-v1-multi");
		});
	});
});
