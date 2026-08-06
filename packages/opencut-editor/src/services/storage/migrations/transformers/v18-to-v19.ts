import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV18ToV19({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 19) {
		return { project, skipped: true, reason: "already v19" };
	}

	return {
		project: {
			...migrateCanvasSizeSettings({ project }),
			version: 19,
		},
		skipped: false,
	};
}

function migrateCanvasSizeSettings({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	const settingsValue = project.settings;
	if (!isRecord(settingsValue)) {
		return project;
	}

	const migratedSettings: Record<string, unknown> = {
		...settingsValue,
		canvasSizeMode: "preset",
		lastCustomCanvasSize: null,
	};

	return {
		...project,
		settings: migratedSettings,
	};
}
