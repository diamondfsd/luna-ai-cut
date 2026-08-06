import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV25ToV26 } from "./transformers/v25-to-v26";

export class V25toV26Migration extends StorageMigration {
	from = 25;
	to = 26;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV25ToV26({ project });
	}
}
