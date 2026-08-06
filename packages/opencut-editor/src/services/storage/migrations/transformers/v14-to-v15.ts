import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

// Frozen snapshot of the v15-era fallback. See ./README.md.
const STICKER_INTRINSIC_SIZE_FALLBACK = 200;

export function transformProjectV14ToV15({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 15) {
		return { project, skipped: true, reason: "already v15" };
	}

	const migratedProject = backfillStickerIntrinsicDimensions({ project });

	return {
		project: { ...migratedProject, version: 15 },
		skipped: false,
	};
}

function backfillStickerIntrinsicDimensions({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) return project;

	const migratedScenes = scenesValue.map((scene) => {
		if (!isRecord(scene)) return scene;
		const tracksValue = scene.tracks;
		if (!Array.isArray(tracksValue)) return scene;

		const migratedTracks = tracksValue.map((track) => {
			if (!isRecord(track)) return track;
			const elementsValue = track.elements;
			if (!Array.isArray(elementsValue)) return track;

			const migratedElements = elementsValue.map((element) => {
				if (!isRecord(element)) return element;
				if (element.type !== "sticker") return element;
				if (
					typeof element.intrinsicWidth === "number" &&
					typeof element.intrinsicHeight === "number"
				) {
					return element;
				}
				return {
					...element,
					intrinsicWidth: STICKER_INTRINSIC_SIZE_FALLBACK,
					intrinsicHeight: STICKER_INTRINSIC_SIZE_FALLBACK,
				};
			});

			return { ...track, elements: migratedElements };
		});

		return { ...scene, tracks: migratedTracks };
	});

	return { ...project, scenes: migratedScenes };
}
