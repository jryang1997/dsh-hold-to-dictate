# 3. The transcript lands in the draft; it is never sent

Status: accepted

## Decision

Dictation only writes into the owned range of the draft. The user decides when to send.

## Consequences

- A rejected insert keeps the text as a retained transcript instead of losing it.
- Manual edits or undo during a take stop automatic replacement.
