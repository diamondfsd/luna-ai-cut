import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV23ToV24({
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
	if (version >= 24) {
		return { project, skipped: true, reason: "already v24" };
	}
	if (version !== 23) {
		return { project, skipped: true, reason: "not v23" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 24,
		},
		skipped: false,
	};
}

function migrateProject({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	if (!Array.isArray(project.scenes)) {
		return project;
	}

	return {
		...project,
		scenes: project.scenes.map((scene) => migrateScene({ scene })),
	};
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene) || !Array.isArray(scene.tracks)) {
		return scene;
	}

	const mainTrack = findMainTrack({ tracks: scene.tracks });
	const finalMainTrack = mainTrack ?? buildEmptyMainTrack();

	return {
		...scene,
		tracks: {
			overlay: scene.tracks
				.filter((track) => track !== mainTrack)
				.map((track) => migrateTrack({ track }))
				.filter(
					(track): track is ProjectRecord =>
						isRecord(track) && track.type !== "audio",
				),
			main: migrateTrack({ track: finalMainTrack }),
			audio: scene.tracks
				.map((track) => migrateTrack({ track }))
				.filter(
					(track): track is ProjectRecord =>
						isRecord(track) && track.type === "audio",
				),
		},
	};
}

function buildEmptyMainTrack(): ProjectRecord {
	return {
		id: crypto.randomUUID(),
		name: "Main",
		type: "video",
		elements: [],
		muted: false,
		hidden: false,
	};
}

function findMainTrack({
	tracks,
}: {
	tracks: unknown[];
}): ProjectRecord | null {
	for (const track of tracks) {
		if (!isRecord(track)) {
			continue;
		}
		if (track.type === "video" && track.isMain === true) {
			return track;
		}
	}

	for (const track of tracks) {
		if (!isRecord(track)) {
			continue;
		}
		if (track.type === "video") {
			return track;
		}
	}

	return null;
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) {
		return track;
	}

	const nextTrack = { ...track };
	delete nextTrack.isMain;
	return nextTrack;
}
