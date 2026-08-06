import type { MigrationResult, ProjectRecord } from "./transformers/types";

export interface StorageMigrationRunArgs {
	projectId: string;
	project: ProjectRecord;
}

export abstract class StorageMigration {
	abstract from: number;
	abstract to: number;

	abstract run({
		projectId,
		project,
	}: StorageMigrationRunArgs): Promise<MigrationResult<ProjectRecord>>;
}
