#!/bin/bash
# Portable check: is the working tree safe to walk away from? With uncommitted
# changes present (tracked or untracked), verifies (a) no secrets in them and
# (b) the test suite is green. Exit 1 with the reason on stderr; exit 0
# otherwise (including when there is nothing uncommitted). Claude Code calls
# this from a Stop hook (.claude/hooks/check-before-stop.sh); other agents and
# humans run it before ending a session (Principle 8: fail visibly).
#   usage: scripts/check-clean-state.sh
#
# Why the scan is not `gitleaks protect`: that mode drives git itself, and a
# git warning on stderr (the CRLF notice on Windows checkouts) made gitleaks
# abort and report "no leaks found" with exit 0. It also only sees the diff of
# tracked files, so a secret in a brand-new file was never scanned. Here the
# changed files are listed by git, copied to a scratch directory, and scanned
# as plain files, so git and gitleaks never share a stderr and untracked files
# are included. A scanner failure is reported as "gate could not run", never
# as clean.
# Delegation: when the gaide CLI is installed it is the runtime of this check
# (ADR 0006); the shell body below is the fallback for clones without it.
if command -v gaide >/dev/null 2>&1; then exec gaide check clean-state; fi
set -u

changed_files() {
  { git diff --name-only --diff-filter=ACMR HEAD -- 2>/dev/null
    git diff --name-only --diff-filter=ACMR --staged -- 2>/dev/null
    git ls-files --others --exclude-standard 2>/dev/null
  } | sort -u
}

FILES="$(changed_files)"
[ -z "$FILES" ] && exit 0

if command -v gitleaks >/dev/null 2>&1; then
  SCRATCH="$(mktemp -d)"
  trap 'rm -rf "$SCRATCH"' EXIT
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    mkdir -p "$SCRATCH/$(dirname "$f")"
    cp "$f" "$SCRATCH/$f"
  done <<EOF
$FILES
EOF
  gitleaks dir "$SCRATCH" --no-banner --redact --exit-code 1 >/dev/null 2>"$SCRATCH/.gitleaks.err"
  GL=$?
  if [ "$GL" -eq 1 ]; then
    echo "Uncommitted changes contain secret(s) per gitleaks. Remove them before ending (Constitution Principle 6); run 'gitleaks dir . --redact' to see the findings." >&2
    exit 1
  elif [ "$GL" -ne 0 ]; then
    echo "gate could not run: gitleaks exited $GL while scanning uncommitted files ($(tail -n 1 "$SCRATCH/.gitleaks.err" 2>/dev/null)). Fix the scanner before ending; a gate that cannot run is not a pass (Principle 8)." >&2
    exit 1
  fi
fi

if [ -f package.json ] && grep -q '"test"' package.json; then
  npm test --silent >/dev/null 2>&1 || {
    echo "Uncommitted changes with a failing test suite (npm test). Fix the tests or report the failure explicitly before ending." >&2
    exit 1
  }
elif command -v pytest >/dev/null 2>&1 && [ -d tests ]; then
  pytest -q >/dev/null 2>&1
  STATUS=$?
  # exit 5 = no tests collected; acceptable for a fresh template
  if [ "$STATUS" -ne 0 ] && [ "$STATUS" -ne 5 ]; then
    echo "Uncommitted changes with a failing test suite (pytest). Fix the tests or report the failure explicitly before ending." >&2
    exit 1
  fi
fi
exit 0
