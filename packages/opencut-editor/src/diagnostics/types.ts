export type DiagnosticSeverity = "caution" | "error";

export interface DiagnosticDefinition {
	id: string;
	scope: string;
	severity: DiagnosticSeverity;
	message: string;
}
