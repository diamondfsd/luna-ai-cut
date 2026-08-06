import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV9ToV10 } from "./transformers/v9-to-v10";

export class V9toV10Migration extends StorageMigration {
	from = 9;
	to = 10;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV9ToV10({ project });
	}
}
