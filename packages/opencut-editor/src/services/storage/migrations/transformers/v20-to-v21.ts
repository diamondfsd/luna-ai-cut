import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

// Frozen snapshot of the v21-era divisor. See ./README.md.
const INTENSITY_TO_SIGMA_DIVISOR = 5;
const LEGACY_DEFAULT_BACKGROUND_BLUR_INTENSITY = 50;

export function transformProjectV20ToV21({
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
	if (version >= 21) {
		return { project, skipped: true, reason: "already v21" };
	}
	if (version !== 20) {
		return { project, skipped: true, reason: "not v20" };
	}

	return {
		project: {
			...migrateBackgroundBlurScale({ project }),
			version: 21,
		},
		skipped: false,
	};
}

function migrateBackgroundBlurScale({
	project,
}: {
	project: ProjectRecord;
}): ProjectRecord {
	if (!isRecord(project.settings)) {
		return project;
	}

	const settings = { ...project.settings };
	const background = settings.background;
	if (!isRecord(background) || background.type !== "blur") {
		return { ...project, settings };
	}

	const raw = background.blurIntensity;
	const blurIntensity =
		typeof raw === "number" && Number.isFinite(raw)
			? raw * INTENSITY_TO_SIGMA_DIVISOR
			: LEGACY_DEFAULT_BACKGROUND_BLUR_INTENSITY;

	return {
		...project,
		settings: {
			...settings,
			background: {
				...background,
				blurIntensity,
			},
		},
	};
}
