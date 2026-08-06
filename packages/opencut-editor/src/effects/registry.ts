import { DefinitionRegistry } from "@/params/registry";
import type { EffectDefinition } from "@/effects/types";

export class EffectsRegistry extends DefinitionRegistry<string, EffectDefinition> {
	constructor() {
		super("effect");
	}
}

export const effectsRegistry = new EffectsRegistry();
