import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV28ToV29({
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
	if (version >= 29) {
		return { project, skipped: true, reason: "already v29" };
	}
	if (version !== 28) {
		return { project, skipped: true, reason: "not v28" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 29,
		},
		skipped: false,
	};
}

function migrateProject({ project }: { project: ProjectRecord }): ProjectRecord {
	const nextProject = { ...project };
	if (Array.isArray(project.scenes)) {
		nextProject.scenes = project.scenes.map((scene) => migrateScene({ scene }));
	}
	return nextProject;
}

function migrateScene({ scene }: { scene: unknown }): unknown {
	if (!isRecord(scene)) {
		return scene;
	}

	const nextScene = { ...scene };
	if (isRecord(scene.tracks)) {
		nextScene.tracks = migrateTracks({ tracks: scene.tracks });
	}
	return nextScene;
}

function migrateTracks({ tracks }: { tracks: ProjectRecord }): ProjectRecord {
	const nextTracks = { ...tracks };
	if (isRecord(tracks.main)) {
		nextTracks.main = migrateTrack({ track: tracks.main });
	}
	if (Array.isArray(tracks.overlay)) {
		nextTracks.overlay = tracks.overlay.map((track) => migrateTrack({ track }));
	}
	if (Array.isArray(tracks.audio)) {
		nextTracks.audio = tracks.audio.map((track) => migrateTrack({ track }));
	}
	return nextTracks;
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
	if (!isRecord(element)) {
		return element;
	}

	const nextElement = { ...element };
	const params: ProjectRecord = isRecord(element.params)
		? { ...element.params }
		: {};

	copyTransformParams({ source: element, params });
	copyPrimitiveParam({ source: element, params, sourceKey: "opacity", paramKey: "opacity" });
	copyPrimitiveParam({
		source: element,
		params,
		sourceKey: "blendMode",
		paramKey: "blendMode",
	});

	if (element.type === "audio" || element.type === "video") {
		copyPrimitiveParam({
			source: element,
			params,
			sourceKey: "volume",
			paramKey: "volume",
		});
		copyPrimitiveParam({
			source: element,
			params,
			sourceKey: "muted",
			paramKey: "muted",
		});
	}

	if (element.type === "text") {
		copyTextParams({ source: element, params });
	}

	nextElement.params = params;
	return nextElement;
}

function copyTransformParams({
	source,
	params,
}: {
	source: ProjectRecord;
	params: ProjectRecord;
}): void {
	if (!isRecord(source.transform)) {
		return;
	}
	if (isRecord(source.transform.position)) {
		copyPrimitiveParam({
			source: source.transform.position,
			params,
			sourceKey: "x",
			paramKey: "transform.positionX",
		});
		copyPrimitiveParam({
			source: source.transform.position,
			params,
			sourceKey: "y",
			paramKey: "transform.positionY",
		});
	}
	copyPrimitiveParam({
		source: source.transform,
		params,
		sourceKey: "scaleX",
		paramKey: "transform.scaleX",
	});
	copyPrimitiveParam({
		source: source.transform,
		params,
		sourceKey: "scaleY",
		paramKey: "transform.scaleY",
	});
	copyPrimitiveParam({
		source: source.transform,
		params,
		sourceKey: "rotate",
		paramKey: "transform.rotate",
	});
}

function copyTextParams({
	source,
	params,
}: {
	source: ProjectRecord;
	params: ProjectRecord;
}): void {
	for (const key of [
		"content",
		"fontSize",
		"fontFamily",
		"color",
		"textAlign",
		"fontWeight",
		"fontStyle",
		"textDecoration",
		"letterSpacing",
		"lineHeight",
	]) {
		copyPrimitiveParam({ source, params, sourceKey: key, paramKey: key });
	}

	if (!isRecord(source.background)) {
		return;
	}
	for (const key of [
		"enabled",
		"color",
		"cornerRadius",
		"paddingX",
		"paddingY",
		"offsetX",
		"offsetY",
	]) {
		copyPrimitiveParam({
			source: source.background,
			params,
			sourceKey: key,
			paramKey: `background.${key}`,
		});
	}
}

function copyPrimitiveParam({
	source,
	params,
	sourceKey,
	paramKey,
}: {
	source: ProjectRecord;
	params: ProjectRecord;
	sourceKey: string;
	paramKey: string;
}): void {
	const value = source[sourceKey];
	if (
		typeof value === "number" ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		params[paramKey] = value;
	}
}
