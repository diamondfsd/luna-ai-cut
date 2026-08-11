# AI Editing Prompts

This directory is the single source of truth for model-facing instructions used by editing agents.

- `agent-system.md`: stable autonomous-agent identity and behavior contract.
- `protocols/`: transport-specific response and tool-calling instructions.
- `protocols/coding-workspace.md`: shared-worktree editing and completion protocol.
- `examples/`: goal-oriented EditProgram examples, not fixed workflows.
- `skills/foundations/`: general editing judgment exposed through the skill tools.
- `skills/`: optional domain knowledge searched and read by the Agent when the current task needs it. Skills can be enabled, disabled, or extended by users.
- `legacy-agent.md`: prompt for the older local planning surface while it remains in the bundle.

Runtime values use `{{UPPER_SNAKE_CASE}}` placeholders and are replaced by the prompt builders. Keep tool results and project state out of static prose.
