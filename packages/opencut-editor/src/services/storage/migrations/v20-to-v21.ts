import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV20ToV21 } from "./transformers/v20-to-v21";

export class V20toV21Migration extends StorageMigration {
	from = 20;
	to = 21;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV20ToV21({ project });
	}
}
