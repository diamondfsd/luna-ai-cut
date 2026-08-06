import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV14ToV15 } from "./transformers/v14-to-v15";

export class V14toV15Migration extends StorageMigration {
	from = 14;
	to = 15;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV14ToV15({ project });
	}
}
