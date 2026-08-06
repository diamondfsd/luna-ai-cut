import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

interface FreeformPathPoint {
	id: string;
	x: number;
	y: number;
	inX: number;
	inY: number;
	outX: number;
	outY: number;
}

function isFreeformPathPoint(value: unknown): value is FreeformPathPoint {
	if (!isRecord(value)) {
		return false;
	}

	return (
		typeof value.id === "string" &&
		typeof value.x === "number" &&
		typeof value.y === "number" &&
		typeof value.inX === "number" &&
		typeof value.inY === "number" &&
		typeof value.outX === "number" &&
		typeof value.outY === "number"
	);
}

function parseFreeformPath({
	path,
}: {
	path: string;
}): FreeformPathPoint[] {
	if (!path) {
		return [];
	}

	try {
		const parsed = JSON.parse(path);
		return Array.isArray(parsed) ? parsed.filter(isFreeformPathPoint) : [];
	} catch {
		return [];
	}
}

export function transformProjectV26ToV27({
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
	if (version >= 27) {
		return { project, skipped: true, reason: "already v27" };
	}
	if (version !== 26) {
		return { project, skipped: true, reason: "not v26" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 27,
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
	if (!isRecord(scene) || !isRecord(scene.tracks)) {
		return scene;
	}

	const tracks = scene.tracks;
	const nextTracks: ProjectRecord = { ...tracks };

	if (isRecord(tracks.main)) {
		nextTracks.main = migrateTrack({ track: tracks.main });
	}

	if (Array.isArray(tracks.overlay)) {
		nextTracks.overlay = tracks.overlay.map((track) => migrateTrack({ track }));
	}

	if (Array.isArray(tracks.audio)) {
		nextTracks.audio = tracks.audio.map((track) => migrateTrack({ track }));
	}

	return {
		...scene,
		tracks: nextTracks,
	};
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
	if (!isRecord(mask) || mask.type !== "custom" || !isRecord(mask.params)) {
		return mask;
	}

	const path = mask.params.path;
	if (typeof path !== "string") {
		return mask;
	}

	return {
		...mask,
		params: {
			...mask.params,
			path: parseFreeformPath({ path }),
		},
	};
}
