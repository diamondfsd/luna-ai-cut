import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV26ToV27 } from "./transformers/v26-to-v27";

export class V26toV27Migration extends StorageMigration {
	from = 26;
	to = 27;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV26ToV27({ project });
	}
}
