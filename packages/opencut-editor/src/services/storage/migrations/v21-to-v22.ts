import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV21ToV22 } from "./transformers/v21-to-v22";

export class V21toV22Migration extends StorageMigration {
	from = 21;
	to = 22;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV21ToV22({ project });
	}
}
