import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV2ToV3({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	const projectId = getProjectId({ project });
	if (!projectId) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (isV3Project({ project })) {
		return { project, skipped: true, reason: "already v3" };
	}

	const scenes = getScenes({ project });
	const duration = getDurationFromScenes({ scenes });

	const metadataValue = project.metadata;
	const metadata = isRecord(metadataValue)
		? { ...metadataValue, duration }
		: { duration };

	const migratedProject = {
		...project,
		metadata,
		version: 3,
	};

	return { project: migratedProject, skipped: false };
}

export { getProjectId } from "./utils";

function getScenes({ project }: { project: ProjectRecord }): unknown[] {
	const scenesValue = project.scenes;
	if (!Array.isArray(scenesValue)) {
		return [];
	}

	return scenesValue.filter(isRecord);
}

function getDurationFromScenes({ scenes }: { scenes: unknown[] }): number {
	const mainScene =
		scenes.find(
			(s): s is Record<string, unknown> =>
				isRecord(s) && s.isMain === true,
		) ??
		scenes.find(isRecord) ??
		null;

	if (!mainScene || !Array.isArray(mainScene.tracks)) {
		return 0;
	}

	let maxEnd = 0;
	for (const track of mainScene.tracks) {
		if (!isRecord(track) || !Array.isArray(track.elements)) continue;
		for (const element of track.elements) {
			if (!isRecord(element)) continue;
			const startTime =
				typeof element.startTime === "number" ? element.startTime : 0;
			const duration =
				typeof element.duration === "number" ? element.duration : 0;
			maxEnd = Math.max(maxEnd, startTime + duration);
		}
	}

	return maxEnd;
}

function isV3Project({ project }: { project: ProjectRecord }): boolean {
	const versionValue = project.version;
	if (typeof versionValue === "number" && versionValue >= 3) {
		return true;
	}

	return (
		isRecord(project.metadata) && typeof project.metadata.duration === "number"
	);
}
