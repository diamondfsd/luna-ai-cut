import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV11ToV12 } from "./transformers/v11-to-v12";

export class V11toV12Migration extends StorageMigration {
	from = 11;
	to = 12;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV11ToV12({ project });
	}
}
