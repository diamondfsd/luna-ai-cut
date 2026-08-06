import { StorageMigration, type StorageMigrationRunArgs } from "./base";
import type { MigrationResult, ProjectRecord } from "./transformers/types";
import { transformProjectV22ToV23 } from "./transformers/v22-to-v23";

export class V22toV23Migration extends StorageMigration {
	from = 22;
	to = 23;

	async run({
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>> {
		return transformProjectV22ToV23({ project });
	}
}
