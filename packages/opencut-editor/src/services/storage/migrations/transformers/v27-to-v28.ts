import { roundMediaTime } from "@/wasm";
import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV27ToV28({
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
	if (version >= 28) {
		return { project, skipped: true, reason: "already v28" };
	}
	if (version !== 27) {
		return { project, skipped: true, reason: "not v27" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 28,
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
		nextProject.metadata = migrateTimeFields({
			record: project.metadata,
			keys: ["duration"],
		});
	}

	if (isRecord(project.timelineViewState)) {
		nextProject.timelineViewState = migrateTimeFields({
			record: project.timelineViewState,
			keys: ["playheadTime"],
		});
	}

	if (Array.isArray(project.scenes)) {
		nextProject.scenes = project.scenes.map((scene) => migrateScene({ scene }));
	}

	return nextProject;
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

	if (isRecord(scene.tracks)) {
		nextScene.tracks = migrateTracks({ tracks: scene.tracks });
	}

	return nextScene;
}

function migrateTracks({ tracks }: { tracks: ProjectRecord }): ProjectRecord {
	const nextTracks = { ...tracks };

	if (isRecord(tracks.main)) {
		nextTracks.main = migrateTrack({ track: tracks.main });
	}

	if (Array.isArray(tracks.overlay)) {
		nextTracks.overlay = tracks.overlay.map((track) => migrateTrack({ track }));
	}

	if (Array.isArray(tracks.audio)) {
		nextTracks.audio = tracks.audio.map((track) => migrateTrack({ track }));
	}

	return nextTracks;
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) {
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
	if (!isRecord(channel) || !Array.isArray(channel.keys)) {
		return channel;
	}

	return {
		...channel,
		keys: channel.keys.map((keyframe) => migrateAnimationKeyframe({ keyframe })),
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
		nextKeyframe.leftHandle = migrateTimeFields({
			record: keyframe.leftHandle,
			keys: ["dt"],
		});
	}

	if (isRecord(keyframe.rightHandle)) {
		nextKeyframe.rightHandle = migrateTimeFields({
			record: keyframe.rightHandle,
			keys: ["dt"],
		});
	}

	return nextKeyframe;
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

		nextRecord[key] = normalizeMediaTimeValue({ value: record[key] });
	}

	return nextRecord;
}

function normalizeMediaTimeValue({ value }: { value: unknown }): unknown {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return value;
	}
	return roundMediaTime({ time: value });
}
