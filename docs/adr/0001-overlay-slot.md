# 1. Mount in `conversation.input.overlay`, not `conversation.input.activity`

Status: accepted

## Context

The shipped microphone sits in `conversation.input.activity`. That is a single slot: registering at the same priority throws, and taking it would displace the shipped UI.

## Decision

Register in `conversation.input.overlay`, a `list` slot rendered inside the composer card. The plugin joins `slash-menu`, `command-popup` and `feedback-dialog` without touching them.

## Consequences

- The layer is `pointer-events: none` and watches the card in the capture phase, so typing, caret moves and selection behave as before.
- The anchor is zero-height, so the plugin measures the card itself.

Details: [docs/design.md](../design.md#the-three-things-a-composer-plugin-needs).
