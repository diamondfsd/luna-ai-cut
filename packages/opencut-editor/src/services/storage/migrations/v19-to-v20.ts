import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV19ToV20 } from "./transformers/v19-to-v20";

export class V19toV20Migration extends StorageMigration {
	from = 19;
	to = 20;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV19ToV20({ project });
	}
}
