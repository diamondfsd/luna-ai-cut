import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV16ToV17 } from "./transformers/v16-to-v17";

export class V16toV17Migration extends StorageMigration {
	from = 16;
	to = 17;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV16ToV17({ project });
	}
}
