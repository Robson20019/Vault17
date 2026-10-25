#!/bin/bash
# Claude Code Stop adapter: forwards the hook payload on stdin to
# `gaide check clean-state --hook`, the single runtime of every gate (ADR 0006).
# Exit 2 rejects the tool call and feeds stderr back to the agent. If the CLI
# is missing, the gate cannot run, so the adapter blocks and says so instead
# of passing silently (Constitution Principle 8).
if ! command -v gaide >/dev/null 2>&1; then
  echo "gate could not run: gaide CLI not found on PATH. Install with: uv tool install gaide (GAIDE_CLI)." >&2
  exit 2
fi
exec gaide check clean-state --hook --project "${CLAUDE_PROJECT_DIR:-.}"
