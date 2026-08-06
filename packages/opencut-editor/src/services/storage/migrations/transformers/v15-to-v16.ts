import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV15ToV16({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 16) {
		return { project, skipped: true, reason: "already v16" };
	}

	return {
		project: {
			...renameStickerTracksToGraphic({ project }),
			version: 16,
		},
		skipped: false,
	};
}

function renameStickerTracksToGraphic({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) {
		return project;
	}

	const migratedScenes = scenesValue.map((scene) => {
		if (!isRecord(scene) || !Array.isArray(scene.tracks)) {
			return scene;
		}

		return {
			...scene,
			tracks: scene.tracks.map((track) => {
				if (!isRecord(track) || track.type !== "sticker") {
					return track;
				}

				return {
					...track,
					type: "graphic",
				};
			}),
		};
	});

	return {
		...project,
		scenes: migratedScenes,
	};
}
