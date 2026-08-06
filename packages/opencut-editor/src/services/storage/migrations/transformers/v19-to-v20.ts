import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV19ToV20({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 20) {
		return { project, skipped: true, reason: "already v20" };
	}

	return {
		project: {
			...migrateVideoSourceAudioState({ project }),
			version: 20,
		},
		skipped: false,
	};
}

function migrateVideoSourceAudioState({
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

function migrateScene({
	scene,
}: {
	scene: unknown;
}): unknown {
	if (!isRecord(scene) || !Array.isArray(scene.tracks)) {
		return scene;
	}

	return {
		...scene,
		tracks: scene.tracks.map((track) => migrateTrack({ track })),
	};
}

function migrateTrack({
	track,
}: {
	track: unknown;
}): unknown {
	if (!isRecord(track) || !Array.isArray(track.elements)) {
		return track;
	}

	return {
		...track,
		elements: track.elements.map((element) => migrateElement({ element })),
	};
}

function migrateElement({
	element,
}: {
	element: unknown;
}): unknown {
	if (!isRecord(element) || element.type !== "video") {
		return element;
	}

	return {
		...element,
		isSourceAudioEnabled:
			typeof element.isSourceAudioEnabled === "boolean"
				? element.isSourceAudioEnabled
				: true,
	};
}
