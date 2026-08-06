import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV4ToV5 } from "./transformers/v4-to-v5";

export class V4toV5Migration extends StorageMigration {
	from = 4;
	to = 5;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV4ToV5({ project });
	}
}
