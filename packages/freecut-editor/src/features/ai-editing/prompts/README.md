# AI Editing Prompts

This directory is the single source of truth for model-facing instructions used by editing agents.

- `agent-system.md`: stable autonomous-agent identity and behavior contract.
- `protocols/`: transport-specific response and tool-calling instructions.
- `protocols/edit-program.md`: complete declarative editing data contract.
- `examples/`: goal-oriented EditProgram examples, not fixed workflows.
- `skills/foundations/`: professional creation judgment always loaded into the editing agent.
- `skills/`: optional domain knowledge selected from the current request and injected by the host without a model-side search step. Skills can be enabled, disabled, or extended by users.
- `legacy-agent.md`: prompt for the older local planning surface while it remains in the bundle.

Runtime values use `{{UPPER_SNAKE_CASE}}` placeholders and are replaced by the prompt builders. Keep tool results and project state out of static prose.
