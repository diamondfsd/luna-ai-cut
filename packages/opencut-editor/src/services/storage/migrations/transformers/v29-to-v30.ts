import type { MigrationResult, ProjectRecord } from "./types";
import { getProjectId, isRecord } from "./utils";

export function transformProjectV29ToV30({
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
	if (version >= 30) {
		return { project, skipped: true, reason: "already v30" };
	}
	if (version !== 29) {
		return { project, skipped: true, reason: "not v29" };
	}

	return {
		project: {
			...migrateProject({ project }),
			version: 30,
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
	if (!isRecord(element) || !isRecord(element.animations)) {
		return element;
	}

	return {
		...element,
		animations: migrateAnimations({ animations: element.animations }),
	};
}

function migrateAnimations({
	animations,
}: {
	animations: ProjectRecord;
}): ProjectRecord {
	if (!isRecord(animations.bindings) || !isRecord(animations.channels)) {
		return animations;
	}

	const channels = animations.channels;
	const nextAnimations: ProjectRecord = { ...animations };
	for (const binding of Object.values(animations.bindings)) {
		if (!isRecord(binding) || typeof binding.path !== "string") {
			continue;
		}
		if (!Array.isArray(binding.components)) {
			continue;
		}

		const componentEntries = binding.components.flatMap((component) => {
			if (
				!isRecord(component) ||
				typeof component.key !== "string" ||
				typeof component.channelId !== "string"
			) {
				return [];
			}
			const channel = channels[component.channelId];
			if (!isRecord(channel)) {
				return [];
			}
			return [[component.key, migrateChannel({ channel })] as const];
		});
		if (componentEntries.length === 0) {
			continue;
		}

		nextAnimations[binding.path] =
			componentEntries.length === 1 && componentEntries[0]?.[0] === "value"
				? componentEntries[0][1]
				: Object.fromEntries(componentEntries);
	}

	return nextAnimations;
}

function migrateChannel({ channel }: { channel: ProjectRecord }): ProjectRecord {
	const { kind: _kind, ...nextChannel } = channel;
	return nextChannel;
}
