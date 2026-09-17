export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingAssets?: string[];
}

export interface ProjectFileWithMetadata {
  version: string;
  minimumReaderVersion?: string;
  capabilities?: readonly string[];
  project: any;
  metadata?: {
    exportedAt: number;
    description?: string;
  };
}
