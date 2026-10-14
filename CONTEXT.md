# Context

The words this repo uses for the dictation gesture. Code, tests, issues and PRs use these terms.

| Term | Meaning |
|---|---|
| **Hold** | Press and keep holding inside the composer card. The gesture arms at the hold threshold and disarms if the pointer moves more than 10 px first. |
| **Take** | One recording, from the start of a hold to release or cancel. Every piece of per-recording state belongs to a take. |
| **Owned range** | The draft range a take writes into, captured with `captureInsertion()` and guarded by `draftRev`. Only the take's own text is ever replaced. |
| **Live preview** | An opt-in, provisional transcript shown while the hold continues. Each preview is an independent unary `speech.transcribe` call on a complete WAV. |
| **Live plan** | The pure scheduling rules for live previews: cadence, backoff, starve limit and windowing (`createLivePlan`). |
| **Window** | The slice of the take's audio one preview reads, `[from, to]`. It starts at 0 or at a commit point. |
| **Commit point** | The middle of the last sentence-length pause in a long take. Words before it are frozen for the rest of the take. |
| **Final read** | The one recognition of the complete recording after release. It replaces any preview text. |
| **Retained transcript** | Text that could not be inserted (the draft moved on, or the composer was busy). The lower-right chip keeps it for the user to place. |
| **Host** | The DSH Harness and the internal APIs it exposes: `slots`, `inputActions`, `useInput` and `remote.speech`. |
| **Provider** | The speech recognizer the Host has selected. `catalog()` reports which providers exist, whether they are ready, and their limits. |
