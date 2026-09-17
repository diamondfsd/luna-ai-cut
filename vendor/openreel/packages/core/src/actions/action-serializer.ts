import type { Action } from "../types/actions";

export class ActionSerializer {
  serialize(action: Action): string {
    return JSON.stringify(action);
  }

  deserialize(json: string): Action {
    const parsed = JSON.parse(json);
    if (
      typeof parsed.type !== "string" ||
      typeof parsed.id !== "string" ||
      typeof parsed.timestamp !== "number" ||
      typeof parsed.params !== "object" ||
      parsed.params === null
    ) {
      throw new Error("Invalid action JSON: missing required fields");
    }

    return parsed as Action;
  }

  serializeMany(actions: Action[]): string {
    return JSON.stringify(actions);
  }

  deserializeMany(json: string): Action[] {
    const parsed = JSON.parse(json);

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid actions JSON: expected array");
    }

    return parsed.map((item, index) => {
      if (
        typeof item.type !== "string" ||
        typeof item.id !== "string" ||
        typeof item.timestamp !== "number" ||
        typeof item.params !== "object" ||
        item.params === null
      ) {
        throw new Error(
          `Invalid action at index ${index}: missing required fields`,
        );
      }
      return item as Action;
    });
  }
}
