import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV16ToV17({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 17) {
		return { project, skipped: true, reason: "already v17" };
	}

	return {
		project: {
			...backfillMaskStrokeAlign({ project }),
			version: 17,
		},
		skipped: false,
	};
}

function backfillMaskStrokeAlign({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) {
		return project;
	}

	const migratedScenes = scenesValue.map((scene) => {
		if (!isRecord(scene)) {
			return scene;
		}

		const tracksValue = scene.tracks;
		if (!Array.isArray(tracksValue)) {
			return scene;
		}

		const migratedTracks = tracksValue.map((track) => {
			if (!isRecord(track)) {
				return track;
			}

			const elementsValue = track.elements;
			if (!Array.isArray(elementsValue)) {
				return track;
			}

			const migratedElements = elementsValue.map((element) => {
				if (!isRecord(element)) {
					return element;
				}

				const masksValue = element.masks;
				if (!Array.isArray(masksValue)) {
					return element;
				}

				const migratedMasks = masksValue.map((mask) => {
					if (!isRecord(mask)) {
						return mask;
					}

					const paramsValue = mask.params;
					if (!isRecord(paramsValue) || typeof paramsValue.strokeAlign === "string") {
						return mask;
					}

					return {
						...mask,
						params: {
							...paramsValue,
							strokeAlign: "center",
						},
					};
				});

				return {
					...element,
					masks: migratedMasks,
				};
			});

			return {
				...track,
				elements: migratedElements,
			};
		});

		return {
			...scene,
			tracks: migratedTracks,
		};
	});

	return {
		...project,
		scenes: migratedScenes,
	};
}
