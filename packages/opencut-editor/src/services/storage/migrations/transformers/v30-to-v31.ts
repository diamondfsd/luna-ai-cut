import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV30ToV31({
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
	if (version >= 31) {
		return { project, skipped: true, reason: "already v31" };
	}
	if (version !== 30) {
		return { project, skipped: true, reason: "not v30" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 31,
		},
		skipped: false,
	};
}

function migrateProject({ project }: { project: ProjectRecord }): ProjectRecord {
	const nextProject = { ...project };
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
	if (!isRecord(element) || !Array.isArray(element.masks)) {
		return element;
	}

	return {
		...element,
		masks: element.masks.map((mask) => migrateMask({ mask })),
	};
}

function migrateMask({ mask }: { mask: unknown }): unknown {
	if (!isRecord(mask) || mask.type !== "custom") {
		return mask;
	}

	// "custom" is the only freeform-path mask type; a down-migration can map
	// type === "freeform" back to "custom" without any additional marker.
	return {
		...mask,
		type: "freeform",
	};
}
