import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV25ToV26({
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
	if (version >= 26) {
		return { project, skipped: true, reason: "already v26" };
	}
	if (version !== 25) {
		return { project, skipped: true, reason: "not v25" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 26,
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
	if (!isRecord(scene)) {
		return scene;
	}

	const tracks = scene.tracks;

	// Already in the correct shape — nothing to repair
	if (isRecord(tracks) && Array.isArray(tracks.overlay) && Array.isArray(tracks.audio)) {
		return scene;
	}

	// Reconstruct the flat track array from whatever broken state it's in.
	// v24-to-v25 spread a flat array into a numeric-keyed object, so
	// Object.values recovers the original elements. A true flat array is
	// also handled for safety.
	let trackArray: unknown[];
	if (Array.isArray(tracks)) {
		trackArray = tracks;
	} else if (isRecord(tracks)) {
		trackArray = Object.values(tracks);
	} else {
		trackArray = [];
	}

	const mainTrack = findMainTrack({ tracks: trackArray });
	const finalMainTrack = mainTrack ?? buildEmptyMainTrack();

	return {
		...scene,
		tracks: {
			main: migrateTrack({ track: finalMainTrack }),
			overlay: trackArray
				.filter((track) => track !== mainTrack)
				.map((track) => migrateTrack({ track }))
				.filter(
					(track): track is ProjectRecord =>
						isRecord(track) && track.type !== "audio",
				),
			audio: trackArray
				.map((track) => migrateTrack({ track }))
				.filter(
					(track): track is ProjectRecord =>
						isRecord(track) && track.type === "audio",
				),
		},
	};
}

function findMainTrack({
	tracks,
}: {
	tracks: unknown[];
}): ProjectRecord | null {
	for (const track of tracks) {
		if (!isRecord(track)) continue;
		if (track.type === "video" && track.isMain === true) return track;
	}
	for (const track of tracks) {
		if (!isRecord(track)) continue;
		if (track.type === "video") return track;
	}
	return null;
}

function migrateTrack({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;
	const nextTrack = { ...track };
	delete nextTrack.isMain;
	return nextTrack;
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
