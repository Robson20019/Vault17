#!/bin/bash
# Claude Code PostToolUse (Write|Edit) adapter for the security gates: runs
# `gaide check sast` and `gaide check sca` on the edited file through the
# single runtime of every gate (ADR 0006). Each check decides for itself
# whether it applies (module installed, task profile, file type). Exit 2
# feeds the findings back to the agent while the edit context is fresh. A
# missing CLI blocks instead of passing silently (Constitution Principle 8).
if ! command -v gaide >/dev/null 2>&1; then
  echo "gate could not run: gaide CLI not found on PATH. Install with: uv tool install gaide (GAIDE_CLI)." >&2
  exit 2
fi
PAYLOAD="$(cat)"
printf '%s' "$PAYLOAD" | gaide check sast --hook --project "${CLAUDE_PROJECT_DIR:-.}" || exit 2
printf '%s' "$PAYLOAD" | gaide check sca --hook --project "${CLAUDE_PROJECT_DIR:-.}" || exit 2
exit 0
