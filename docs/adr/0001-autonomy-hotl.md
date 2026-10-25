# ADR 0001: Adopt autonomy mode HOTL

- **Status:** proposed
- **Date:** 2026-10-25
- **Decision-makers:** <fill in>

## Context

Constitution Principle 3 makes HIC (Human-In-Command) the default: every agent
change requires explicit human approval before commit. This project was
initialized with `gaide init` choosing **HOTL** (the agent acts and a human supervises, able to interrupt).
Any mode other than HIC is a conscious, dated decision, recorded here.

## Decision

Operate in HOTL from 2026-10-25. <State the scope: which repositories, which kinds
of change, which review happens afterwards, and how the mode is revisited.>

## Alternatives considered

- **HIC:** rejected for now because <reason>.
- **HOOTL:** rejected because <reason>.

## Consequences

### Positive

### Negative (accepted costs)

- Less human attention per change; the mechanical harness (inline enforcement, pre-commit, CI) carries more of the load.

## Constitution adherence

Principle 3 requires this ADR for any mode other than HIC. `gaide.yaml` records the mode and this ADR; `gaide check` and the solver refuse configurations where the mode is not backed by the harness it needs.

## Future review

Revisit when: a new model generation is adopted (constitution expiry note); an incident traces to an unreviewed change; the team composition changes.
