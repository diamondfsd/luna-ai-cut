import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV24ToV25 } from "./transformers/v24-to-v25";

export class V24toV25Migration extends StorageMigration {
	from = 24;
	to = 25;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV24ToV25({ project });
	}
}
