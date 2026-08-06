import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV18ToV19 } from "./transformers/v18-to-v19";

export class V18toV19Migration extends StorageMigration {
	from = 18;
	to = 19;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV18ToV19({ project });
	}
}
