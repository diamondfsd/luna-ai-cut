import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId } from "./utils";

export function transformProjectV9ToV10({
	project,
}: {
	project: ProjectRecord;
}): MigrationResult<ProjectRecord> {
	if (!getProjectId({ project })) {
		return { project, skipped: true, reason: "no project id" };
	}

	if (typeof project.version === "number" && project.version >= 10) {
		return { project, skipped: true, reason: "already v10" };
	}

	return {
		project: { ...project, version: 10 },
		skipped: false,
	};
}
