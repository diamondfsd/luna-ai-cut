import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV27ToV28 } from "./transformers/v27-to-v28";

export class V27toV28Migration extends StorageMigration {
	from = 27;
	to = 28;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV27ToV28({ project });
	}
}
