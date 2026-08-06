import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV13ToV14({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 14) {
		return { project, skipped: true, reason: "already v14" };
	}

	const migratedProject = migrateProjectSplitMasks({ project });

	return {
		project: { ...migratedProject, version: 14 },
		skipped: false,
	};
}

function migrateProjectSplitMasks({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	const migratedScenes = scenesValue.map((scene) =>
		migrateSceneSplitMasks({ scene }),
	);

	return { ...project, scenes: migratedScenes };
}

function migrateSceneSplitMasks({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) return scene;

	const tracksValue = scene.tracks;
	if (!Array.isArray(tracksValue)) return scene;

	const migratedTracks = tracksValue.map((track) =>
		migrateTrackSplitMasks({ track }),
	);

	return { ...scene, tracks: migratedTracks };
}

function migrateTrackSplitMasks({ track }: { track: unknown }): unknown {
	if (!isRecord(track)) return track;

	const elementsValue = track.elements;
	if (!Array.isArray(elementsValue)) return track;

	const migratedElements = elementsValue.map((element) =>
		migrateElementSplitMasks({ element }),
	);

	return { ...track, elements: migratedElements };
}

function migrateElementSplitMasks({ element }: { element: unknown }): unknown {
	if (!isRecord(element)) return element;

	const masksValue = element.masks;
	if (!Array.isArray(masksValue)) return element;

	const migratedMasks = masksValue.map((mask) => migrateSplitMask({ mask }));

	return { ...element, masks: migratedMasks };
}

/**
 * Converts split mask params from position-along-normal to explicit (x, y) anchor.
 *
 * Old: center = (cx + (position-0.5)*W*cos(rot), cy + (position-0.5)*W*sin(rot))
 * New: center = (cx + x*W, cy + y*W)
 *
 * Conversion: x = (position-0.5)*cos(rot), y = (position-0.5)*sin(rot)
 */
function migrateSplitMask({ mask }: { mask: unknown }): unknown {
	if (!isRecord(mask)) return mask;
	if (mask.type !== "split") return mask;

	const params = isRecord(mask.params) ? mask.params : {};
	const position = typeof params.position === "number" ? params.position : 0.5;
	const rotation = typeof params.rotation === "number" ? params.rotation : 0;

	const angleRad = (rotation * Math.PI) / 180;
	const x = (position - 0.5) * Math.cos(angleRad);
	const y = (position - 0.5) * Math.sin(angleRad);

	const { position: _removed, ...restParams } = params;

	return {
		...mask,
		params: { ...restParams, x, y },
	};
}
