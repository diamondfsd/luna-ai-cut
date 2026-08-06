import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV12ToV13({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 13) {
		return { project, skipped: true, reason: "already v13" };
	}

	const migratedProject = migrateProjectMasks({ project });

	return {
		project: { ...migratedProject, version: 13 },
		skipped: false,
	};
}

function migrateProjectMasks({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	const migratedScenes = scenesValue.map((scene) =>
		migrateSceneMasks({ scene }),
	);

	return { ...project, scenes: migratedScenes };
}

function migrateSceneMasks({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;

	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	const migratedTracks = tracksValue.map((track) =>
		migrateTrackMasks({ track }),
	);

	return { ...scene, tracks: migratedTracks };
}

function migrateTrackMasks({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;

	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	const migratedElements = elementsValue.map((element) =>
		migrateElementMasks({ element }),
	);

	return { ...track, elements: migratedElements };
}

function migrateElementMasks({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) return element;

	const masksValue = element.masks;
	if (!Array.isArray(masksValue)) return element;

	const migratedMasks = masksValue.map((mask) => migrateMask({ mask }));

	return { ...element, masks: migratedMasks };
}

function migrateMask({ mask }: { mask: unknown }): unknown {
	if (!isRecord(mask)) return mask;

	const params = isRecord(mask.params) ? { ...mask.params } : {};
	const result = { ...mask };

	result.params = {
		...params,
		feather: typeof mask.feather === "number" ? mask.feather : 0,
		inverted: typeof mask.inverted === "boolean" ? mask.inverted : false,
		strokeColor:
			isRecord(mask.stroke) && typeof mask.stroke.color === "string"
				? mask.stroke.color
				: "#ffffff",
		strokeWidth:
			isRecord(mask.stroke) && typeof mask.stroke.width === "number"
				? mask.stroke.width
				: 0,
	};

	delete (result as Record<string, unknown>).feather;
	delete (result as Record<string, unknown>).inverted;
	delete (result as Record<string, unknown>).stroke;

	return result;
}
