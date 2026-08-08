# AI Editing Prompts

This directory is the single source of truth for model-facing instructions used by editing agents.

- `agent-system.md`: stable autonomous-agent identity and behavior contract.
- `protocols/`: transport-specific response and tool-discovery instructions.
- `skills/`: optional professional knowledge loaded by the agent at runtime.
- `legacy-agent.md`: prompt for the older local planning surface while it remains in the bundle.

Runtime values use `{{UPPER_SNAKE_CASE}}` placeholders and are replaced by the prompt builders. Keep tool results and project state out of static prose.
