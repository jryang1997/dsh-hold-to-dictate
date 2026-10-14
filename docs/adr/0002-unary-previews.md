# 2. Live previews are repeated unary calls on complete WAVs

Status: accepted

## Context

The Host offers only `speech.transcribe(request, signal)`. It has no token-streaming protocol, and the plugin does not ship its own recognizer.

## Decision

Each preview is an independent 16 kHz mono PCM16 WAV built from AudioWorklet PCM. Exactly one preview is in flight. Long takes commit at sentence-length pauses so a preview stays short. Release always makes one final read of the full recording.

## Consequences

- Words before a commit point stop correcting themselves. The final read still covers everything.
- The live plan's cadence follows the measured round trip and is never faster than 250 ms.
- Native streaming would replace the plan if the Host ever offered it.
