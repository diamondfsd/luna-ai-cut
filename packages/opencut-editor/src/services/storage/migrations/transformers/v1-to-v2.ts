import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

// Frozen snapshots of v2-era defaults. See ./README.md.
const DEFAULT_BACKGROUND_BLUR_INTENSITY = 10;
const DEFAULT_BACKGROUND_COLOR = "#000000";
const DEFAULT_CANVAS_SIZE = { width: 1920, height: 1080 };
const DEFAULT_FPS = 30;

type LegacyMediaType = "image" | "video" | "audio";

export interface V1ToV2Context {
	legacyTracksBySceneId: Record<string, unknown[]>;
	mediaTypesById: Record<string, LegacyMediaType>;
}

const EMPTY_V1_TO_V2_CONTEXT: V1ToV2Context = {
	legacyTracksBySceneId: {},
	mediaTypesById: {},
};

interface V2Transform {
	scale: number;
	position: { x: number; y: number };
	rotate: number;
}

interface V2VideoElement {
	id: string;
	name: string;
	type: "video";
	mediaId: string;
	muted: boolean;
	hidden: boolean;
	transform: V2Transform;
	opacity: number;
	duration: number;
	startTime: number;
	trimStart: number;
	trimEnd: number;
}

interface V2ImageElement {
	id: string;
	name: string;
	type: "image";
	mediaId: string;
	duration: number;
	startTime: number;
	trimStart: number;
	trimEnd: number;
	hidden: boolean;
	transform: V2Transform;
	opacity: number;
}

interface V2TextElement {
	id: string;
	name: string;
	type: "text";
	content: string;
	fontSize: number;
	fontFamily: string;
	color: string;
	background: {
		enabled: boolean;
		color: string;
		cornerRadius: number;
		paddingX: number;
		paddingY: number;
		offsetX: number;
		offsetY: number;
	};
	textAlign: "left" | "center" | "right";
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline" | "line-through";
	hidden: boolean;
	transform: V2Transform;
	opacity: number;
	duration: number;
	startTime: number;
	trimStart: number;
	trimEnd: number;
}

interface V2AudioElement {
	id: string;
	name: string;
	type: "audio";
	sourceType: "upload";
	mediaId: string;
	volume: number;
	duration: number;
	startTime: number;
	trimStart: number;
	trimEnd: number;
}

interface V2VideoTrack {
	id: string;
	name: string;
	type: "video";
	elements: (V2VideoElement | V2ImageElement)[];
	isMain: boolean;
	muted: boolean;
	hidden: boolean;
}

interface V2TextTrack {
	id: string;
	name: string;
	type: "text";
	elements: V2TextElement[];
	hidden: boolean;
}

interface V2AudioTrack {
	id: string;
	name: string;
	type: "audio";
	elements: V2AudioElement[];
	muted: boolean;
}

type V2TimelineTrack = V2VideoTrack | V2TextTrack | V2AudioTrack;

export function transformProjectV1ToV2({
	project,
	context = EMPTY_V1_TO_V2_CONTEXT,
}: {
	project: ProjectRecord;
	context?: V1ToV2Context;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (isV2Project({ project })) {
		return { project, skipped: true, reason: "already v2" };
	}

	const migratedProject = migrateProject({
		project,
		projectId,
		context,
	});
	return { project: migratedProject, skipped: false };
}

function migrateProject({
	project,
	projectId,
	context,
}: {
	project: ProjectRecord;
	projectId: string;
	context: V1ToV2Context;
}): ProjectRecord {
	const createdAt = normalizeDateString({ value: project.createdAt });
	const updatedAt = normalizeDateString({ value: project.updatedAt });
	const metadataValue = project.metadata;

	const metadata = isRecord(metadataValue)
		? {
				id: getStringValue({ value: metadataValue.id, fallback: projectId }),
				name: getStringValue({ value: metadataValue.name, fallback: "" }),
				thumbnail: getStringValue({ value: metadataValue.thumbnail }),
				createdAt: normalizeDateString({ value: metadataValue.createdAt }),
				updatedAt: normalizeDateString({ value: metadataValue.updatedAt }),
			}
		: {
				id: projectId,
				name: getStringValue({ value: project.name, fallback: "" }),
				thumbnail: getStringValue({ value: project.thumbnail }),
				createdAt,
				updatedAt,
			};

	const scenesValue = project.scenes;
	const scenes = Array.isArray(scenesValue) ? scenesValue : [];
	const legacyBookmarks = Array.isArray(project.bookmarks)
		? project.bookmarks
		: null;

	const migratedScenes = scenes.map((scene) => {
		if (!isRecord(scene)) {
			return scene;
		}

		const sceneId = getStringValue({ value: scene.id });
		if (!sceneId) {
			return scene;
		}

		const existingTracks = scene.tracks;
		const shouldLoadTracks =
			!Array.isArray(existingTracks) || existingTracks.length === 0;

		if (!shouldLoadTracks) {
			return scene;
		}

		const tracks = context.legacyTracksBySceneId[sceneId] ?? [];
		const transformedTracks = transformTracks({
			tracks,
			context,
		});

		return {
			...scene,
			tracks: transformedTracks,
		};
	});

	const normalizedScenes = applyLegacyBookmarks({
		scenes: migratedScenes,
		legacyBookmarks,
	});

	const settingsValue = project.settings;
	const settings = isRecord(settingsValue)
		? {
				fps: getNumberValue({
					value: settingsValue.fps,
					fallback: DEFAULT_FPS,
				}),
				canvasSize: getCanvasSizeValue({
					value: settingsValue.canvasSize,
					fallback: DEFAULT_CANVAS_SIZE,
				}),
				background: getBackgroundValue({
					value: settingsValue.background,
				}),
				originalCanvasSize: null,
			}
		: {
				fps: getNumberValue({ value: project.fps, fallback: DEFAULT_FPS }),
				canvasSize: getCanvasSizeValue({
					value: project.canvasSize,
					fallback: DEFAULT_CANVAS_SIZE,
				}),
				background: getBackgroundValue({
					value: project.background,
					backgroundType: project.backgroundType,
					backgroundColor: project.backgroundColor,
					blurIntensity: project.blurIntensity,
				}),
				originalCanvasSize: null,
			};

	const currentSceneId = getCurrentSceneId({
		value: project.currentSceneId,
		scenes: normalizedScenes,
	});

	return {
		...project,
		metadata,
		scenes: normalizedScenes,
		currentSceneId,
		settings,
		version: 2,
	};
}

function transformTracks({
	tracks,
	context,
}: {
	tracks: unknown[];
	context: V1ToV2Context;
}): V2TimelineTrack[] {
	if (!Array.isArray(tracks)) {
		return [];
	}

	let isFirstVideoTrackFound = false;
	const transformedTracks = tracks.map((track): V2TimelineTrack | null => {
		if (!isRecord(track)) {
			return null;
		}

		const trackType = track.type;
		if (trackType === "media") {
			const isMain = !isFirstVideoTrackFound;
			isFirstVideoTrackFound = true;
			const videoTrack = transformMediaTrack({
				track,
				context,
				isMain,
			});
			return videoTrack;
		}

		if (trackType === "text") {
			return transformTextTrack({ track });
		}

		if (trackType === "audio") {
			return transformAudioTrack({ track });
		}

		return null;
	});

	return transformedTracks.filter(
		(track): track is V2TimelineTrack => track !== null,
	);
}

function transformMediaTrack({
	track,
	context,
	isMain,
}: {
	track: Record<string, unknown>;
	context: V1ToV2Context;
	isMain: boolean;
}): V2VideoTrack {
	const elements = Array.isArray(track.elements) ? track.elements : [];

	const transformedElements = elements.map((element) => {
		if (!isRecord(element) || element.type !== "media") {
			return null;
		}

		const mediaId = getStringValue({ value: element.mediaId });
		if (!mediaId) {
			return null;
		}

		let mediaType: "video" | "image" = "video";
		const storedMediaType = context.mediaTypesById[mediaId];
		if (storedMediaType) {
			mediaType = storedMediaType === "image" ? "image" : "video";
		}

		const defaultTransform: V2Transform = {
			scale: 1,
			position: { x: 0, y: 0 },
			rotate: 0,
		};

		const muted = element.muted === true;

		if (mediaType === "image") {
			const imageElement: V2ImageElement = {
				id: getStringValue({ value: element.id, fallback: "" }),
				name: getStringValue({ value: element.name, fallback: "" }),
				type: "image",
				mediaId,
				duration: getNumberValue({ value: element.duration, fallback: 0 }),
				startTime: getNumberValue({
					value: element.startTime,
					fallback: 0,
				}),
				trimStart: getNumberValue({
					value: element.trimStart,
					fallback: 0,
				}),
				trimEnd: getNumberValue({ value: element.trimEnd, fallback: 0 }),
				hidden: false,
				transform: defaultTransform,
				opacity: 1,
			};
			return imageElement;
		}

		const videoElement: V2VideoElement = {
			id: getStringValue({ value: element.id, fallback: "" }),
			name: getStringValue({ value: element.name, fallback: "" }),
			type: "video",
			mediaId,
			muted,
			hidden: false,
			transform: defaultTransform,
			opacity: 1,
			duration: getNumberValue({ value: element.duration, fallback: 0 }),
			startTime: getNumberValue({ value: element.startTime, fallback: 0 }),
			trimStart: getNumberValue({ value: element.trimStart, fallback: 0 }),
			trimEnd: getNumberValue({ value: element.trimEnd, fallback: 0 }),
		};
		return videoElement;
	});

	const validElements = transformedElements.filter(
		(element): element is V2VideoElement | V2ImageElement => element !== null,
	);

	return {
		id: getStringValue({ value: track.id, fallback: "" }),
		name: getStringValue({ value: track.name, fallback: "" }),
		type: "video",
		elements: validElements,
		isMain,
		muted: false,
		hidden: false,
	};
}

function transformTextTrack({
	track,
}: {
	track: Record<string, unknown>;
}): V2TextTrack {
	const elements = Array.isArray(track.elements) ? track.elements : [];

	const transformedElements = elements
		.map((element): V2TextElement | null => {
			if (!isRecord(element) || element.type !== "text") {
				return null;
			}

			const x = getNumberValue({ value: element.x, fallback: 0 });
			const y = getNumberValue({ value: element.y, fallback: 0 });
			const rotation = getNumberValue({
				value: element.rotation,
				fallback: 0,
			});
			const opacity = getNumberValue({
				value: element.opacity,
				fallback: 1,
			});

			const transform: V2Transform = {
				scale: 1,
				position: { x, y },
				rotate: rotation,
			};

			return {
				id: getStringValue({ value: element.id, fallback: "" }),
				name: getStringValue({ value: element.name, fallback: "" }),
				type: "text",
				content: getStringValue({ value: element.content, fallback: "" }),
				fontSize: getNumberValue({
					value: element.fontSize,
					fallback: 16,
				}),
				fontFamily: getStringValue({
					value: element.fontFamily,
					fallback: "Arial",
				}),
				color: getStringValue({
					value: element.color,
					fallback: "#000000",
				}),
				background: {
					enabled: false,
					color: getStringValue({
						value: element.backgroundColor,
						fallback: "transparent",
					}),
					cornerRadius: 0,
					paddingX: 8,
					paddingY: 4,
					offsetX: 0,
					offsetY: 0,
				},
				textAlign: parseEnum({
					value: element.textAlign,
					allowed: ["left", "center", "right"] as const,
					fallback: "left",
				}),
				fontWeight: parseEnum({
					value: element.fontWeight,
					allowed: ["normal", "bold"] as const,
					fallback: "normal",
				}),
				fontStyle: parseEnum({
					value: element.fontStyle,
					allowed: ["normal", "italic"] as const,
					fallback: "normal",
				}),
				textDecoration: parseEnum({
					value: element.textDecoration,
					allowed: ["none", "underline", "line-through"] as const,
					fallback: "none",
				}),
				hidden: false,
				transform,
				opacity,
				duration: getNumberValue({ value: element.duration, fallback: 0 }),
				startTime: getNumberValue({ value: element.startTime, fallback: 0 }),
				trimStart: getNumberValue({ value: element.trimStart, fallback: 0 }),
				trimEnd: getNumberValue({ value: element.trimEnd, fallback: 0 }),
			};
		})
		.filter((element): element is V2TextElement => element !== null);

	return {
		id: getStringValue({ value: track.id, fallback: "" }),
		name: getStringValue({ value: track.name, fallback: "" }),
		type: "text",
		elements: transformedElements,
		hidden: false,
	};
}

function transformAudioTrack({
	track,
}: {
	track: Record<string, unknown>;
}): V2AudioTrack {
	const elements = Array.isArray(track.elements) ? track.elements : [];

	const transformedElements = elements
		.map((element): V2AudioElement | null => {
			if (!isRecord(element) || element.type !== "audio") {
				return null;
			}

			const mediaId = getStringValue({ value: element.mediaId });
			if (!mediaId) {
				return null;
			}

			return {
				id: getStringValue({ value: element.id, fallback: "" }),
				name: getStringValue({ value: element.name, fallback: "" }),
				type: "audio",
				sourceType: "upload",
				mediaId,
				volume: 1,
				duration: getNumberValue({ value: element.duration, fallback: 0 }),
				startTime: getNumberValue({ value: element.startTime, fallback: 0 }),
				trimStart: getNumberValue({ value: element.trimStart, fallback: 0 }),
				trimEnd: getNumberValue({ value: element.trimEnd, fallback: 0 }),
			};
		})
		.filter((element): element is V2AudioElement => element !== null);

	return {
		id: getStringValue({ value: track.id, fallback: "" }),
		name: getStringValue({ value: track.name, fallback: "" }),
		type: "audio",
		elements: transformedElements,
		muted: false,
	};
}

export { getProjectId } from "./utils";

function getCurrentSceneId({
	value,
	scenes,
}: {
	value: unknown;
	scenes: unknown[];
}): string {
	if (typeof value === "string" && value.length > 0) {
		return value;
	}

	const mainSceneId = findMainSceneId({ scenes });
	if (mainSceneId) {
		return mainSceneId;
	}

	return "";
}

function findMainSceneId({ scenes }: { scenes: unknown[] }): string | null {
	for (const scene of scenes) {
		if (!isRecord(scene)) {
			continue;
		}

		if (scene.isMain === true && typeof scene.id === "string") {
			return scene.id;
		}
	}

	for (const scene of scenes) {
		if (!isRecord(scene)) {
			continue;
		}

		if (typeof scene.id === "string") {
			return scene.id;
		}
	}

	return null;
}

function applyLegacyBookmarks({
	scenes,
	legacyBookmarks,
}: {
	scenes: unknown[];
	legacyBookmarks: unknown[] | null;
}): unknown[] {
	if (!legacyBookmarks || legacyBookmarks.length === 0) {
		return scenes;
	}

	const mainSceneId = findMainSceneId({ scenes });

	return scenes.map((scene) => {
		if (!isRecord(scene)) {
			return scene;
		}

		if (mainSceneId && scene.id !== mainSceneId) {
			return scene;
		}

		if (Array.isArray(scene.bookmarks) && scene.bookmarks.length > 0) {
			return scene;
		}

		return {
			...scene,
			bookmarks: legacyBookmarks,
		};
	});
}

function getBackgroundValue({
	value,
	backgroundType,
	backgroundColor,
	blurIntensity,
}: {
	value?: unknown;
	backgroundType?: unknown;
	backgroundColor?: unknown;
	blurIntensity?: unknown;
}): {
	type: "color" | "blur";
	color?: string;
	blurIntensity?: number;
} {
	if (isRecord(value)) {
		const typeValue = value.type;
		if (typeValue === "blur") {
			return {
				type: "blur",
				blurIntensity: getNumberValue({
					value: value.blurIntensity,
					fallback: DEFAULT_BACKGROUND_BLUR_INTENSITY,
				}),
			};
		}

		return {
			type: "color",
			color: getStringValue({
				value: value.color,
				fallback: DEFAULT_BACKGROUND_COLOR,
			}),
		};
	}

	if (backgroundType === "blur") {
		return {
			type: "blur",
			blurIntensity: getNumberValue({
				value: blurIntensity,
				fallback: DEFAULT_BACKGROUND_BLUR_INTENSITY,
			}),
		};
	}

	return {
		type: "color",
		color: getStringValue({
			value: backgroundColor,
			fallback: DEFAULT_BACKGROUND_COLOR,
		}),
	};
}

function getCanvasSizeValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback: { width: number; height: number };
}): { width: number; height: number } {
	if (isRecord(value)) {
		const width = getNumberValue({
			value: value.width,
			fallback: fallback.width,
		});
		const height = getNumberValue({
			value: value.height,
			fallback: fallback.height,
		});

		return { width, height };
	}

	return fallback;
}

function getNumberValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback: number;
}): number {
	return typeof value === "number" ? value : fallback;
}

function getStringValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback: string;
}): string;
function getStringValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback?: undefined;
}): string | undefined;
function getStringValue({
	value,
	fallback,
}: {
	value: unknown;
	fallback?: string;
}): string | undefined {
	if (typeof value === "string") {
		return value;
	}

	return fallback;
}

function parseEnum<T extends string>({
	value,
	allowed,
	fallback,
}: {
	value: unknown;
	allowed: readonly T[];
	fallback: T;
}): T {
	for (const candidate of allowed) {
		if (value === candidate) {
			return candidate;
		}
	}
	return fallback;
}

function normalizeDateString({ value }: { value: unknown }): string {
	if (value instanceof Date) {
		return value.toISOString();
	}

	if (typeof value === "string") {
		return value;
	}

	return new Date().toISOString();
}

function isV2Project({ project }: { project: ProjectRecord }): boolean {
	const versionValue = project.version;
	if (typeof versionValue === "number" && versionValue >= 2) {
		return true;
	}

	return isRecord(project.metadata) && isRecord(project.settings);
}
