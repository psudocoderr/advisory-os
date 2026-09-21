# 1. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

Advisory OS has reached the point where decisions are being re-litigated
because the reasoning behind them was never written down. The Supabase
pooled/direct connection split is the clearest example: it was rediscovered
painfully during a login outage rather than read off a page.

## Decision

Record consequential architecture decisions as short numbered files in
`docs/engineering/adr/`. One decision per file. Record the context and the
consequences, not just the choice — the consequences are what make an old
decision re-evaluable.

Write an ADR when a decision is expensive to reverse, when it will look wrong
to someone who lacks the context, or when it was genuinely close.

## Consequences

`docs/` is gitignored as confidential working material, so `.gitignore` carries
negated patterns for `docs/engineering/` and `docs/legal/`. New engineering
documentation must live under those paths to be version-controlled at all.
