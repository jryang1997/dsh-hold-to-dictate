# How this plugin hooks into DSH

Notes for anyone extending this plugin — or writing another composer-level plugin.
Everything below was verified against DSH `0.2.0-rc.2` by reading the shipped packages in
`app.asar` and the live client slot tree. **These are internal interfaces and can change
between releases**; the plugin is written so that a change degrades rather than breaks.
Line numbers are the ones that release shipped, not stable addresses: the column moved once
between `0.1.7-rc.2` and `0.2.0-rc.2`, which is why the checks are written as behaviour rather
than as positions.

## The three things a composer plugin needs

| Need | What DSH provides | Where |
|---|---|---|
| A place to render inside the input box | `conversation.input.overlay` — a `list` slot, `replaceRisk: none`, rendered inside the composer card | declared by `conversation.composer.bar` |
| A way to write the draft | `inputActions`, delivered as a **slot standard prop** | `dsh-client-ui-conversation/lib/client.js:13462-13485` |
| A way to transcribe | `ctx.remote.speech` — a client Cordis service | `dsh-experimental-client-ui-voice-input/lib/client.js:5818` |

### Why not `conversation.input.activity`

That is the seat the shipped microphone uses (`VoiceInput`, registered by `registerUi` at
`.../client-ui-voice-input/lib/client.js:5845`). It is a **single** slot: registering at the
same priority throws, and taking it would mean displacing the shipped UI. The `overlay`
slot is a `list`, so a new `id` simply joins `slash-menu` / `command-popup` /
`feedback-dialog` without touching them.

### Reading the draft API

```js
const span = inputActions.captureInsertion();   // { start, end, draftRev }
inputActions.insertText(text, span);            // boolean
```

`insertText` **replaces** `[start, end)` as one undoable edit, and returns `false` when the
draft revision moved on or the composer is busy (`adjudicating` / `submitting`). Retain the
text and let the user place it — that is what the shipped plugin does, and what the
lower-right chip in this plugin is for.

## The gesture surface

`conversation.input.overlay` renders inside the card's first child, so a component can walk
up to the card from its own node:

```
div[data-composer-card]                     ← position: relative
  └ div.<hash>_overlayAnchor                ← height: 0; position: absolute; inset: 0 0 auto
      └ div[data-slot="conversation.input.overlay"]   ← display: contents
          └ this plugin's layer
```

`[data-composer-card]` is set by the composer itself
(`dsh-client-ui-conversation/lib/client.js:17444`). The editor inside is a Lexical
`div[data-composer-input][contenteditable][role=textbox]`.

Two rules keep typing intact:

1. The layer is `pointer-events: none`, so it never covers the editor.
2. The card is watched in the **capture** phase and nothing is `preventDefault`ed until the
   hold threshold is reached — a click, a caret move or a selection behaves exactly as
   before. Movement beyond 10 px disarms the gesture.

The layer needs an explicit height because the anchor it lives in is zero-height; the
component measures the card with a `ResizeObserver` instead of guessing.

`overlayAnchor` is `height: 0; position: absolute; inset: 0 0 auto`, so it is a **positioning
context at the card's top edge**, not a full-card cover. `inset: 0` inside it would collapse
to nothing; the shipped consumer of this slot (`MenuView` in `dsh-client-ui-input-trigger`)
instead uses `bottom: calc(100% + 4px); left: 0; right: 0` to float *above* the card.

This plugin measures the card and sets its own height, which is what lets the card's outline
be drawn at exactly the card's box. Note that it deliberately does **not** cover the card:
an earlier version filled the whole composer with a recording panel, which meant the draft
disappeared exactly when the user might still want to read it — and, worse, turned the
panel's own exit animation into an invisible click shield over the editor. The recording
surface is now a capsule floating above the card (`bottom: calc(100% + 10px)`, centred),
using the same slot idiom the slash-menu uses. Nothing the plugin draws above the card ever
takes a pointer event.

### Where the hint goes

The hint is the one element here that is bare text rather than an opaque chip, so it is the
one that can ruin a long draft by sitting on top of it. It is therefore parked in the tool
row (`card.lastElementChild`) rather than in the editor area. That row is
`justify-content: space-between`, with the trailing group last even when a long model label
starts left of centre; the hint is right-aligned to the gap in front of that group and clipped to
the gap's width. When the gap is under 48 px the hint is dropped instead of overlapped.

Pointer entry remeasures the gap, and mounting under the pointer sets the initial hover state.
This reads only the card's own subtree — the row is `card.lastElementChild`, the same node
the height measurement already used — and writes nothing outside the plugin's layer.

### Materials, motion and the host

The capsule's surface and every curve and duration are read from the host's own tokens rather
than invented: `--dsw-specific-menu` over `--dsw-menu-backdrop-filter` — the
`MenuSurface.module.css` recipe used for every floating layer in DSH —
`--dsw-elevation-prominent` for a surface that floats above content, and
`cubic-bezier(.16,1,.3,1)`, the curve the host's own menus enter on. The card's discard
hairline reuses `--dsw-radius-panel` (the card's own 28 px, rendered as a squircle by the
app-wide `corner-shape: superellipse(1.5)`).

Entry is a `@starting-style` transition and exit a `data-leaving` attribute, never a
keyframe, so a surface reversed mid-flight retargets from its current value. The glass is
visible immediately; only its contents fade in. Fading an ancestor creates a backdrop root
and temporarily clips the blur, so exit fades the material itself. The hover hint uses a
320 ms opacity transition in both directions, including calm and reduced motion. Gesture position
is separate: pointer movement writes the capsule's lift directly, within a soft 12 px
boundary. Release hands its current position and velocity to a critically damped spring,
stepped by the existing meter clock for 240 ms. There is no second animation loop or dependency.
The level meter is the shipped voice input's waveform: a 28-slot shift register of RMS samples redrawn at
20 fps. `tests/render.test.mjs` asserts all of this, so the rules cannot rot silently.

The host accent colours both the waveform and a halo driven by measured microphone energy.
The elapsed clock starts after microphone acquisition; its digits are tabular and hidden
from screen readers so it never announces every second. On successful insertion, the same
capsule shows a checkmark for 900 ms while keeping its clock space. A new recording clears
that timer immediately. Calm/reduced motion removes lift and scale; reduced transparency
and increased contrast use the host's opaque surface instead.

## Speech recognition

The `speech` remote is **not** part of the default remote assembly — the shipped voice-input
plugin mounts it itself with `ctx.remote.$mount(TYPERT_REMOTE)`. A third-party plugin can
therefore simply inject the namespace:

```js
ctx.inject(['remote.speech', 'slots'], (scope) => { /* scope.remote.speech.transcribe(...) */ });
```

If that bundle is disabled the callback never runs and this plugin registers nothing —
degradation without errors. The alternative, fully self-contained route is to POST the same
`/api/speech/transcribe` envelope directly; the transport is ordinary Typert Remote RPC over
the `/api` channel with same-origin cookie auth.

Host contract (`dsh-experimental-api-speech-to-text/lib/index.js`):

| Method | Notes |
|---|---|
| `transcribe({ audioBase64, providerId?, language? }, signal)` | Audio must be canonical base64 of a 16 kHz mono PCM16 WAV with an exact 44-byte header |
| `catalog()` / `follow(signal)` | Provider list, selection, readiness, `maxAudioBytes` (4 MiB) and `maxDurationSeconds` (120) |
| `configure` / `prepare` / `cancelPreparation` | Preferences and model preparation |

This plugin omits `providerId` so the Host applies its own provider configuration. It sends
`language` only when the `recognition language` setting names one **and** the selected provider
advertises it — a provider rejects an unknown language outright rather than falling back to its
default, so the setting is filtered against `catalog()` rather than trusted. Leaving it to the
Host costs an extra per-request detection pass.

## Experimental live dictation

The opt-in `live` setting reuses the same official `speech.transcribe` call. A silent
AudioWorklet captures continuous PCM alongside MediaRecorder; each preview is an independent
16 kHz mono PCM16 WAV. Partial WebM containers are never decoded for previews. MediaRecorder
retains the complete audio for final recognition on release.

Exactly one preview is in flight. The wait before the next one is derived from what the previous
request actually cost — the timer starts when its reply arrives, so the interval between requests
is the wait plus that round trip. It is floored at 250 ms to avoid re-rendering text that has not
grown, and doubles after a failure. An empty transcript for a window that already produced words
is treated as a recognizer hiccup and leaves the draft alone; a failed preview likewise keeps the
words on screen and backs off instead of ending live dictation for the take.

Because the Host offers only unary calls, a long take would otherwise re-read all of itself on
every refresh. Past the point where one whole-take preview costs about 0.7 s, the loop instead
commits everything up to the last sentence-length pause and reads forward from there. The pause
comes from the recorded audio itself — the worklet's own PCM chunks, so the commit point shares
the audio's frame clock and cannot drift — and is cut down the middle, so a window never starts
on a word. A take with no sentence-length pause never commits and keeps the whole-take behaviour.
Committed words are frozen for the rest of the take; release-to-finalize still reads the complete
recording, so the retained text is unaffected. Release stops capture, waits for the active
preview, and makes one final call. Refreshes never abort the worker. The 110-second limit still
applies.

Measured against the shipped local recognizer: inference is roughly 0.15 s per audio second plus
150 ms, so 2 s of audio answers in about 0.3 s and 16 s in about 1.2 s. The plugin's own cadence
is not the bottleneck — sending every 1.5 s makes inference the limit.

Live insertion uses `useInput` and revision-guarded `InputActions.insertText`, replacing only
the recording's own text range. Original selected text is retained for cancellation. Manual
edits or undo revoke automatic replacement. Cancellation can still restore an unchanged
owned range when the current input snapshot proves its prefix and text are intact; edits
inside that range are preserved with an explicit notice. Final rejected text uses
the existing retained-transcript action; retry carries the same owned range to avoid duplicates.
Reference-chip drafts, cloud providers, missing input hooks and unavailable AudioWorklets
retain one-shot recognition. Native token streaming remains unavailable in the Host API.

## Deliberate non-goals

- No native streaming protocol or third-party recognizer: previews use complete WAV calls.
- No auto-send: the transcript lands in the draft, where it stays editable.
- No DOM writes outside the plugin's own subtree, and no reading of other plugins' DOM —
  the only host node touched is the card the plugin is already mounted inside.
