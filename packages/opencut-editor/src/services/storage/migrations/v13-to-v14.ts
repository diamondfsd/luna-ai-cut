import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV13ToV14 } from "./transformers/v13-to-v14";

export class V13toV14Migration extends StorageMigration {
	from = 13;
	to = 14;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV13ToV14({ project });
	}
}
