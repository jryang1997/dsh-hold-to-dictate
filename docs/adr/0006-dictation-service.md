# 6. Cross-plugin dictation state is published as a cordis service

Status: accepted (2026-10-25), implemented in the same change set.

## Context

`dsh-ascii-whales` wants to react while this plugin records: whales gather at the
composer and the sea surface responds to the microphone level. That state lives in
this plugin's React component, and the other plugin is a separate installed client
plugin. Both are static web client plugins loaded from the profile's boot roster, so
each gets a full cordis `ctx`; the client runner's Guard only wraps model-authored
dynamic packages.

The candidate channels were: a cordis service (`ctx.provide` + optional
`ctx.inject`), a custom DOM `CustomEvent`, a shared `window` singleton, cordis
custom events, and slot root hooks. The host has no reusable client event bus. The
vendored cordis gives optional injection for free: a child fiber parks while the
service is absent and unloads when the provider unloads. `ctx.emit` is not part of
the sanctioned dynamic-package surface, and a `window` singleton has no owner or
cleanup.

## Decision

Publish a client service named `dictation` with `schema: 1` and a face of
`{ schema, getSnapshot(), subscribe(listener), level() }`. The snapshot is semantic
only: `{ schema, seq, phase, since, sessionId, locked, cancelArmed, polishing, pending, code }`,
with `phase` in `idle | listening | recording | processing | done | error`. It
carries no DOM, no composer rect, no audio, no transcript text and no microphone
permission state.

- Provide it unconditionally from `apply(ctx)`, guarded by
  `ctx.get('dictation') === undefined` so a future native implementation wins and a
  duplicate provide cannot throw.
- Publish after every phase transition and publish a final `idle` snapshot when the
  overlay unmounts or the plugin unloads.
- Also dispatch a `dsh:dictation` CustomEvent on `document` as a degraded channel;
  the consumer only listens when the service is absent.
- Consumers attach through `ctx.inject(['dictation'], child => child.effect(...))`
  and must not add the service to their hard module-level `inject` list.

Composer geometry stays with the consumer: `dsh-ascii-whales` already measures
`[data-composer-card]` (falling back to `[data-composer-seat]`) in its own canvas
coordinate space, so a viewport rect in the payload would duplicate and stale.

## Consequences

- Either plugin can be absent, disabled or reloaded without failing the other: the
  consumer's child fiber parks, no error is raised, and HMR sequences dispose then
  re-provide.
- The contract is public across two packages; changing it needs schema negotiation
  (additive fields only, bump `schema` for a break, or add a new service name).
- Adding a new phase or flag is cheap; adding geometry or text is not, by design.
- The producer owns the contract and its tests; the consumer owns rendering. The
  ADR lives here because this repository is the producer.
