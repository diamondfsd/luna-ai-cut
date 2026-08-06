import type { EditorCore } from "@/core";
import type { DiagnosticDefinition } from "@/diagnostics/types";

interface DiagnosticRegistration extends DiagnosticDefinition {
	check: (editor: EditorCore) => boolean;
}

export class DiagnosticsManager {
	private readonly registrations: DiagnosticRegistration[] = [];
	private readonly listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	register(registration: DiagnosticRegistration): void {
		this.registrations.push(registration);
		this.notify();
	}

	getActive(options?: { scope?: string }): ReadonlyArray<DiagnosticDefinition> {
		const candidates =
			options?.scope !== undefined
				? this.registrations.filter((r) => r.scope === options.scope)
				: this.registrations;

		return candidates.filter((r) => r.check(this.editor));
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	notify(): void {
		this.listeners.forEach((listener) => {
			listener();
		});
	}
}
