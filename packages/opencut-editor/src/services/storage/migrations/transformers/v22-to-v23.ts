import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

// Frozen snapshot of the v23-era tick rate. See ./README.md.
const TICKS_PER_SECOND = 120_000;
const ARBITRARY_FPS_DENOMINATOR = 1_000_000;
const STANDARD_FRAME_RATES = [
	{ value: 24_000 / 1_001, numerator: 24_000, denominator: 1_001 },
	{ value: 24, numerator: 24, denominator: 1 },
	{ value: 25, numerator: 25, denominator: 1 },
	{ value: 30_000 / 1_001, numerator: 30_000, denominator: 1_001 },
	{ value: 30, numerator: 30, denominator: 1 },
	{ value: 48, numerator: 48, denominator: 1 },
	{ value: 50, numerator: 50, denominator: 1 },
	{ value: 60_000 / 1_001, numerator: 60_000, denominator: 1_001 },
	{ value: 60, numerator: 60, denominator: 1 },
	{ value: 120, numerator: 120, denominator: 1 },
] as const;
const STANDARD_FRAME_RATE_TOLERANCE = 0.01;

export function transformProjectV22ToV23({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	const version = project.version;
	if (typeof version !== "number") {
		return { project, skipped: true, reason: "invalid version" };
	}
	if (version >= 23) {
		return { project, skipped: true, reason: "already v23" };
	}
	if (version !== 22) {
		return { project, skipped: true, reason: "not v22" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 23,
		},
		skipped: false,
	};
}

function migrateProject({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const nextProject = { ...project };

	if (isRecord(project.metadata)) {
		nextProject.metadata = migrateMetadata({ metadata: project.metadata });
	}

	if (isRecord(project.settings)) {
		nextProject.settings = migrateSettings({ settings: project.settings });
	}

	if (isRecord(project.timelineViewState)) {
		nextProject.timelineViewState = migrateTimelineViewState({
			timelineViewState: project.timelineViewState,
		});
	}

	if (Array.isArray(project.scenes)) {
		nextProject.scenes = project.scenes.map((scene) => migrateScene({ scene }));
	}

	return nextProject;
}

function migrateMetadata({
	metadata,
}: {
	metadata: ProjectRecord;
}): ProjectRecord {
	return migrateTimeFields({
		record: metadata,
		keys: ["duration"],
	});
}

function migrateSettings({
	settings,
}: {
	settings: ProjectRecord;
}): ProjectRecord {
	const nextSettings = { ...settings };
	if ("fps" in settings) {
		nextSettings.fps = migrateFrameRate({ fps: settings.fps });
	}
	return nextSettings;
}

function migrateTimelineViewState({
	timelineViewState,
}: {
	timelineViewState: ProjectRecord;
}): ProjectRecord {
	return migrateTimeFields({
		record: timelineViewState,
		keys: ["playheadTime"],
	});
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) {
		return scene;
	}

	const nextScene = { ...scene };

	if (Array.isArray(scene.bookmarks)) {
		nextScene.bookmarks = scene.bookmarks.map((bookmark) =>
			migrateBookmark({ bookmark }),
		);
	}

	if (Array.isArray(scene.tracks)) {
		nextScene.tracks = scene.tracks.map((track) => migrateTrack({ track }));
	}

	return nextScene;
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) {
		return track;
	}

	if (!Array.isArray(track.elements)) {
		return track;
	}

	return {
		...track,
		elements: track.elements.map((element) => migrateElement({ element })),
	};
}

function migrateElement({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) {
		return element;
	}

	const nextElement = migrateTimeFields({
		record: element,
		keys: ["duration", "startTime", "trimStart", "trimEnd", "sourceDuration"],
	});

	if (isRecord(element.animations)) {
		nextElement.animations = migrateAnimations({
			animations: element.animations,
		});
	}

	return nextElement;
}

function migrateAnimations({
	animations,
}: {
	animations: ProjectRecord;
}): ProjectRecord {
	if (!isRecord(animations.channels)) {
		return animations;
	}

	return {
		...animations,
		channels: Object.fromEntries(
			Object.entries(animations.channels).map(([channelId, channel]) => [
				channelId,
				migrateAnimationChannel({ channel }),
			]),
		),
	};
}

function migrateAnimationChannel({ channel }: { channel: unknown }): unknown {
	if (!isRecord(channel)) {
		return channel;
	}

	if (!Array.isArray(channel.keys)) {
		return channel;
	}

	return {
		...channel,
		keys: channel.keys.map((keyframe) =>
			migrateAnimationKeyframe({ keyframe }),
		),
	};
}

function migrateAnimationKeyframe({
	keyframe,
}: {
	keyframe: unknown;
}): unknown {
	if (!isRecord(keyframe)) {
		return keyframe;
	}

	const nextKeyframe = migrateTimeFields({
		record: keyframe,
		keys: ["time"],
	});

	if (isRecord(keyframe.leftHandle)) {
		nextKeyframe.leftHandle = migrateCurveHandle({
			handle: keyframe.leftHandle,
		});
	}

	if (isRecord(keyframe.rightHandle)) {
		nextKeyframe.rightHandle = migrateCurveHandle({
			handle: keyframe.rightHandle,
		});
	}

	return nextKeyframe;
}

function migrateCurveHandle({
	handle,
}: {
	handle: ProjectRecord;
}): ProjectRecord {
	return migrateTimeFields({
		record: handle,
		keys: ["dt"],
	});
}

function migrateBookmark({ bookmark }: { bookmark: unknown }): unknown {
	if (!isRecord(bookmark)) {
		return bookmark;
	}

	return migrateTimeFields({
		record: bookmark,
		keys: ["time", "duration"],
	});
}

function migrateTimeFields({
	record,
	keys,
}: {
	record: ProjectRecord;
	keys: string[];
}): ProjectRecord {
	const nextRecord = { ...record };

	for (const key of keys) {
		if (!(key in record)) {
			continue;
		}

		nextRecord[key] = migrateTimeValue({ value: record[key] });
	}

	return nextRecord;
}

function migrateTimeValue({ value }: { value: unknown }): unknown {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return value;
	}

	return secondsToTicks({ value });
}

function secondsToTicks({ value }: { value: number }): number {
	return Math.round(value * TICKS_PER_SECOND);
}

function migrateFrameRate({ fps }: { fps: unknown }): unknown {
	if (isRecord(fps)) {
		return fps;
	}

	if (typeof fps !== "number" || !Number.isFinite(fps) || fps <= 0) {
		return fps;
	}

	const standardFrameRate = STANDARD_FRAME_RATES.find(
		(candidate) =>
			Math.abs(fps - candidate.value) <= STANDARD_FRAME_RATE_TOLERANCE,
	);
	if (standardFrameRate) {
		return {
			numerator: standardFrameRate.numerator,
			denominator: standardFrameRate.denominator,
		};
	}

	if (Number.isInteger(fps)) {
		return { numerator: fps, denominator: 1 };
	}

	const scaledNumerator = Math.round(fps * ARBITRARY_FPS_DENOMINATOR);
	const divisor = greatestCommonDivisor({
		left: scaledNumerator,
		right: ARBITRARY_FPS_DENOMINATOR,
	});

	return {
		numerator: scaledNumerator / divisor,
		denominator: ARBITRARY_FPS_DENOMINATOR / divisor,
	};
}

function greatestCommonDivisor({
	left,
	right,
}: {
	left: number;
	right: number;
}): number {
	let nextLeft = Math.abs(left);
	let nextRight = Math.abs(right);

	while (nextRight !== 0) {
		const remainder = nextLeft % nextRight;
		nextLeft = nextRight;
		nextRight = remainder;
	}

	return nextLeft || 1;
}
