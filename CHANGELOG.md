# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] - 2026-10-08

### Added

- A **recognition language** setting (Host decides / Chinese / English / Cantonese / Japanese /
  Korean). A fixed language skips the Host's own per-request language detection — measured
  faster at most clip lengths and never slower — and is filtered against the provider's own
  advertised list first, because a provider rejects an unknown language outright rather than
  falling back to its default.

### Fixed

- Live dictation no longer stops for the rest of a recording when a single preview fails, and
  no longer stops at all when the first previews arrive before the worklet holds `MIN_SECONDS`
  of audio. Both paths used to end the loop silently, with the capsule still drawing a waveform.
- A failed preview now backs off before retrying instead of re-asking as fast as it failed.
- Holding the composer while a transcription is still in flight no longer strands the press
  ring on screen or the gesture's three window listeners on the window. Both of the release
  paths give up on "no recording is running", so the threshold itself now retracts the ring
  and detaches before it abandons the press.
- A second finger — or a trackpad's second key — can no longer drive the discard threshold or
  decide whether a recording is kept or thrown away. The gesture now claims the pointer that
  opened it and ignores every other one, including their `pointercancel`.
- Both are covered by regression tests that drive real gestures: reverting either fix, or any
  one of the three pointer guards, fails `npm test` with a named assertion.

### Changed

- **Live dictation refreshes on the Host's own round trip instead of a fixed one-second delay.**
  The old loop waited a flat second *after* each reply arrived, which capped the cadence at about
  one update per second no matter how fast the recognizer was. The wait is now derived from what
  the previous request actually cost, so the interval between requests sits just above that round
  trip: floored at 250 ms, and doubled after a failure.
- **A long take stops re-reading itself.** Past the point where one whole-take preview costs more
  than about 0.7 s, live dictation commits everything up to the last sentence-length pause and then
  reads forward from there, so each refresh covers a segment instead of the whole recording. The
  pause is found from the recorded audio itself and cut down the middle, so a segment never starts
  on a word; a take with no sentence-length pause never commits and keeps the whole-take behaviour
  rather than being cut mid-word. Committed words are frozen for the rest of that take — the
  release-to-finalize transcription still reads the complete recording, so the text you keep is
  unaffected.
- Measured in Chrome against the shipped recognizer, holding for 21 seconds over speech with
  sentence pauses: **46 previews instead of 14, a median gap of 317 ms instead of 1415 ms**, and
  the first words on screen at 802 ms instead of 1246 ms. The old cadence also grew with the take
  while the new one stays under a second. Cutting at every short pause instead of only at
  sentence-length ones measured 0.85 character agreement with the whole-take result versus 0.99 —
  which is why the threshold is 0.8 s and not lower.

- The published package ships the three images both READMEs reference, and drops `docs/logo.png`,
  which nothing referenced. The tarball is about 1.0 MB rather than 827 kB: the demo recording
  and two settings screenshots are larger than the unused logo was.
- `npm test` gained a package check that runs `npm pack --dry-run` and fails when a README
  points at a file the tarball does not ship; `npm run check` now defers to `npm test`.
- Live dictation's "off by default" is asserted rather than assumed. The settings page test
  reads the shipped default off an empty store, and a fresh install is exercised through the
  release-to-transcribe path, so flipping the default can no longer pass the suite.

## [2.1.0] - 2026-10-02

### Added

- Optional live dictation through the official local speech module: rolling audio
  recognition updates the draft while recording, with whole-recording finalization
  on release. Revision guards protect manual edits and cancel provisional text safely.
  Unsupported environments, reference-chip drafts and cloud providers keep one-shot input.
- Real usage GIF and two settings screenshots in the Chinese and English README.

### Fixed

- Cancelling live dictation removes unchanged provisional words while preserving manual
  additions outside their range. Edits inside that range are kept with an explicit notice.
- Late preview results cannot affect a cancelled or newer recording, and retry replaces
  provisional words instead of inserting a duplicate transcript.

### Changed

- One preview request at a time, with slower refreshes on long recordings to limit repeated
  recognition work. Live-dictation checks now run locally and in GitHub Actions.

## [2.0.2] - 2026-10-02

### Changed

- A new voice-bubble icon pairs a rounded speech capsule with three waveform bars.
- The README is now a concise Chinese homepage with a separate English page. Agent
  installation prompts include the official voice-input module and model preparation.
- Recording uses the host accent colour, an audio-reactive halo, a subtly lit material
  and a stable elapsed-time display.
- Drag-to-discard follows the pointer directly within a soft boundary. Release returns
  the capsule with a velocity-preserving spring on the existing animation clock.
- Successful draft insertion briefly shows a checkmark and confirmation. A new recording
  interrupts that feedback immediately; narrow composers constrain the capsule width.
- Calm motion disables the processing loop too. Reduced motion, reduced transparency
  and increased contrast retain equivalent feedback.

### Fixed

- Long model labels no longer hide the hover hint when the tool row still has room.
- Pointer entry remeasures the tool row; mounting under the pointer restores the hint
  without requiring the pointer to leave and enter again.
- The hover hint fades in and out softly over 320 ms, including calm and reduced motion.
- The recording capsule has its glass background from the first frame. Entry fades the
  contents instead of an ancestor that would clip backdrop filtering.
- Rendered transcript and failure buttons call the active gesture commands; pressing
  those controls cannot arm the composer's recording gesture.

## [2.0.1] - 2026-10-01

### Fixed

- Hold-duration settings show their translated descriptions instead of dictionary keys.
- The render check catches dictionary keys leaking into the settings page.

## [2.0.0] - 2026-10-01

The name changed. Nothing about what the plugin does changed with it — this is a major version
because the **install identity** did, and every existing install has to be redone.

### Changed

- **`dsh-composer-dictation` is now `dsh-hold-to-dictate`.** The old name had two problems.
  "Composer" is DeepSeek Harness's own word for the input box, but to anyone scanning GitHub it
  is also PHP's package manager and several other things; and "dictation" on its own says what
  the plugin does without saying how you invoke it. The new name carries both: the gesture and
  the result. The bundle row, client module id, locale namespace and slot entry id follow it.
- The display name in the plugin list is unchanged: **Hold to talk** / **按住说话**. The package
  name is what GitHub and `dsh plugin add` see; the title is what you read in Settings.

### Not changed, deliberately

- **The settings storage key stays `dsh-composer-dictation.config`.** It is a storage key, not
  an identity: it is what the browser has already written your settings under. Renaming it to
  match the package would silently discard every value anyone had tuned and buy nothing. There
  is a comment in `client.js` saying so, because it otherwise reads as an oversight.
- **The `dsh-htt-` CSS prefix.** `htt` stood for the project's first name, but it is an opaque
  namespace no user ever sees, and this changelog's own history refers to `.dsh-htt-tool`.
  Renaming it would have buried the real change under 279 lines of mechanical diff.

### Upgrading

```sh
dsh plugin remove @jryang1997/dsh-composer-dictation
dsh plugin add github:jryang1997/dsh-hold-to-dictate
```

Your settings survive the move. That is what the unchanged storage key buys.

### Why not `hold-to-talk`

It was the obvious name, and it was taken twice over:

| Where | Who |
|---|---|
| npm | `dsh-hold-to-talk` belongs to a different plugin (latest `0.1.3`) |
| GitHub | `wangzhanchao883/dsh-hold-to-talk` and `Gammonmush803/dsh-hold-to-talk` |

Both are hold-to-talk dictation plugins for the same harness. A third repository carrying that
slug would have been the least visible of the three, and would have read as a copy of the first.
`dsh-hold-to-dictate` was clear on both npm and GitHub when it was chosen.

## [1.5.2] - 2026-10-01

1.5.1 aligned the hover hint to a CSS rule that turned out not to be rendered by anything.

### Fixed

- **The hint was given the wrong font weight.** 1.5.1 copied `13px / 500 / 20px` from the
  InputBar stylesheet's `.RlGAzG_select` rule. That rule is **dead CSS** — nothing in the host
  renders it, so it is the wrong thing to align to. The real model selector is `ModelSelect`'s
  trigger, and it is **13px / 400 / 20px** with normal tracking. The hint was therefore one
  weight too heavy; it is now 400, which is what it had before 1.5.1 and what the control
  beside it actually uses. The 500 in the InputBar stylesheet belongs to the permission chip,
  and a chip is not body text.
- **Vertical alignment is now measured rather than assumed.** 1.5.1 centred the hint on the
  tool row's box, which is `padding: 2px 8px 6px` — asymmetric. Every control in that row is
  centred on the *content* box instead, so a box-centred hint sat exactly **2 px lower** than
  the model selector beside it: too small to name, large enough to read as "something is off".
  The hint is now centred on the trailing group's own measured box, so it lands on the same
  line box as the control it sits next to whatever the row's padding happens to be.

## [1.5.1] - 2026-10-01

A correction. 1.4.0 fixed a problem that did not exist.

### Fixed

- **The duplicate microphone is gone.** 1.4.0 added a focusable microphone button to the tool
  row on the grounds that a chord cannot be found by pressing Tab. That reasoning was wrong:
  this plugin cannot run without the official voice-input bundle, and that bundle *already* puts
  a focusable microphone button next to Send. So the button was never the only keyboard entry —
  it was a second microphone a few centimetres from the first, which is exactly what it looked
  like on screen. The chord stays, and the honest limitation returns with it: the shortcut is
  documented rather than advertised, and the visible microphone belongs to the official plugin.
- **The hover hint now speaks the tool row's typography.** It was 13px / 400 / 18px carrying its
  own letter-spacing; the host's model selector is 13px / 500 / 20px with none. Sitting between
  the mode chips and the model selector, it read as a foreign element that happened to be
  nearby rather than a line of the same row.
- **The microphone glyph is now the host's own**, reproduced glyph-for-glyph:
  `IconMicrophoneOutlineRegular` from `@deepseek-ai/dsh-client-ui-primitives` — a stroked capsule
  and an arc, `fill: none`, `stroke: currentColor`, 1px in a 16×16 box. The previous one was a
  hand-drawn *filled* shape, which is why the two microphones never quite matched.

### Removed

- `DictationButton`, its stylesheet, the `session` store that carried state between it and the
  recording surface, and the three strings it needed. The store existed solely so two seats
  could talk to each other; with one seat left, it has nothing to say.

## [1.5.0] - 2026-10-01

The gesture was built for a mouse and never tuned for a finger. The host does nothing about
touch at all, so the plugin has to.

### Added

- **A separate touch threshold.** A touch press gets its own hold (default 450 ms, configurable
  from 250 to 1200) and a wider slop — a finger rolls, and a long press on a touch screen is
  *also* how a word gets selected, so the threshold has to be long enough that a deliberate
  hold is unmistakably deliberate.
- **Suppression of what a long press otherwise triggers.** While a touch gesture is armed or
  recording, `contextmenu` and `selectstart` are cancelled in the capture phase. Neither is
  handled anywhere near the composer — the desktop shell raises a native context menu from the
  main process, and Lexical writes `user-select: text` onto the editor — so the collision is
  real rather than theoretical.
- The press ring now draws over the hold the press actually uses, so the arc still finishes at
  the moment recording begins.

### Notes

- Suppression is scoped to **touch** on purpose: cancelling `selectstart` for the mouse would
  break dragging a selection out of the same card.
- `touch-action` is not the tool here, and deliberately not used: it governs panning and
  zooming, not long-press selection.

### Known limitation

Whether `preventDefault()` on the DOM `contextmenu` event reaches the desktop shell's
main-process context-menu handler has **not** been confirmed on real hardware. This plugin has
never been driven from a touch screen. The README says so in place of pretending otherwise.

## [1.4.0] - 2026-10-01

The keyboard entry from 1.2.0 was real but invisible: a chord cannot be found by pressing Tab.
Now there is something to find.

### Added

- **A button in the composer's tool row**, to the left of the model selector —
  `conversation.input.left` is an empty list slot inside that row, so what lands there is a real
  flex child. Tab reaches it, Enter activates it, and `aria-keyshortcuts` is what tells a
  keyboard user the chord exists at all. It is a **toggle** rather than a hold, because keeping
  a key pressed with a button is awkward, and because that is what the shipped microphone does.
- A small `session` store: the recording surface lives in one slot and the button in another,
  with different owners, so the phase is published and the two commands are offered through it.
  Deliberately not an event bus — one phase and three commands is the whole of what the two
  seats need to say to each other.

### Changed

- **The known limitation is gone.** "The keyboard shortcut is documented, not advertised" was
  accurate for one release; the button advertises it.
- A new known limitation replaces it, and it is a real one: the composer hides
  `conversation.input.left` while the shipped voice input's activity is expanded, so during an
  official recording the chord is the only way in.

## [1.3.0] - 2026-10-01

### Added

- **A settings page**, under Settings → Plugins → Dictation. Four knobs, and deliberately only
  four: the hold duration, the motion level, the hover hint, and which keyboard chord to use.
- The bundle now registers into `plugins.bundle.config`, keyed by package name — the seat the
  manager offers a bundle for its own page.

### Changed

- **Configuration became a module.** `createConfig` owns the defaults, the clamping, the
  persistence and the change notification behind a four-method interface — `get` / `set` /
  `subscribe` / `reset`. These values used to be module constants read straight out of the
  gesture, and a page that writes them would have scattered storage calls across the whole
  effect. This is the first of three deepenings; the gesture's thresholds and the surface
  lifetimes are still inline.
- **Motion is a preference as well as a signal.** "Calm" applies the same softening as
  `prefers-reduced-motion` — opacity stays, the movement goes — for people who want it without
  changing an operating-system setting.
- The press ring's duration is now driven from configuration instead of being baked into the
  stylesheet.
- Chord matching moved from a hard-coded `Ctrl+Shift+Space` to a small catalogue matched on
  `event.code`, so a keyboard layout that moves the letters around cannot silently break it.

### Notes

- Settings live in the browser's storage, not the DSH profile. That keeps the plugin free of
  any `@deepseek-ai/dsh-*` dependency — a wrong peer range makes DSH skip the entire bundle,
  silently — at the cost of not travelling between machines. The reasoning is in the README.

## [1.2.0] - 2026-10-01

Making good on the three gaps the previous release left open: the gesture had no keyboard
equivalent, a failure flashed past without offering a way out, and errors announced
themselves as politely as a status update.

### Added

- **A keyboard equivalent.** Hold `Ctrl`+`Shift`+`Space` to record and release to transcribe —
  the same gesture, the same state machine, no pointer. The chord is deliberately awkward to
  hit by accident and never claims a keystroke unless it actually starts a recording. It also
  runs through the same discard path, so `Esc` while still holding discards.
- **Retry, in place.** A failed transcription used to mean saying the whole sentence again.
  The failure card now re-sends the recording that is already captured, so a network hiccup or
  a provider error costs one click instead of one repetition.
- **A 1280×640 link preview card** (`docs/social-preview.png`) showing the capsule, the
  waveform and the card left untouched underneath it. GitHub only picks it up once it is
  uploaded under **Settings → Social preview**.

### Changed

- **A failure is no longer a notice.** It stays on screen until it is dismissed or retried,
  carries its own controls, clamps to two lines with the full text on hover, and uses
  `role="alert"` so assistive technology treats it as urgent. The transient notice keeps
  `role="status"`, because nothing is being asked of the user there.
- **Saying nothing is no longer silent.** A recording shorter than `MIN_SECONDS` used to drop
  out with no feedback at all, which a keyboard tap makes much easier to hit. It now says so.
- A second entry point into `begin()` is guarded, so a hold and a chord can never race into
  two captures.

## [1.1.0] - 2026-10-01

Recording no longer takes the composer over, and the whole motion layer was rebuilt on
DeepSeek Harness's own vocabulary instead of a parallel one.

### Added

- **A press ring.** The hold used to be a dead zone: nothing on screen changed until the
  panel appeared. A ring now draws at the pointer over `HOLD_MS`, and retracts if the press
  turns out to be a click, a caret move or the start of a selection. It is a CSS transition,
  so reversing mid-hold drains it from wherever it had actually reached.
- **A floating recording capsule.** Recording renders as a capsule *above* the composer
  rather than a panel over it, so the draft stays readable and typeable while you dictate.
  It carries a live-state dot, the level waveform, and one short word.
- **[`tests/render.test.mjs`](tests/render.test.mjs)**, which loads the client bundle the way
  the DSH module loader does, mounts the component in every gesture state, and then asserts
  the motion rules. Wired into `npm run check` and CI.
- A changelog, issue forms, a pull request template, and contributor notes.

### Changed

- **The motion vocabulary is the host's, not the plugin's.** `cubic-bezier(.16,1,.3,1)` (the
  curve DSH's own menus enter on), `cubic-bezier(.4,0,.2,1)` (`--ds-ease-in-out`), 140–200 ms
  durations (inside `--ds-transition-duration`), and the `MenuSurface` material recipe
  (`--dsw-specific-menu` over `--dsw-menu-backdrop-filter`).
- **Entry and exit are transitions, never keyframes.** Entry rides `@starting-style`; exit a
  `data-leaving` attribute. Anything the user reverses mid-flight retargets from its current
  value. Every surface now has an exit — previously only the hint and the notice did.
- **The level meter is the shipped voice input's waveform**: a 28-slot shift register of RMS
  samples redrawn at 20 fps, replacing five bars that animated `height` (a layout per bar per
  frame) through a CSS variable set on the parent.
- **Drag-to-discard is continuous.** One number (`--dsh-htt-cancel`) drives the capsule's
  wash, the cross glyph, the card's hairline and the meter's retreat together. 48 px arms it,
  38 px disarms it, and the release decision reads velocity before position.
- **Text is a last resort.** The recording state went from two lines (~24 characters) over
  the draft to a single four-character word, and even that word only carries what the dot
  and the waveform cannot.
- **The hover hint moved into the tool row**, aimed at the gap in front of the trailing
  controls so it can never cover the draft. It elides, and is dropped when the row has no room.
- `HOLD_MS` 350 → 300 ms.

### Fixed

- **A surface that shielded the editor.** An exiting panel kept `pointer-events: auto` while
  it faded, so the 180 ms after every recording swallowed the next click into the draft.
  Exiting surfaces now stop accepting input.
- **A double insert.** The retained-transcript chip stayed clickable while it faded, and
  `pending` was only cleared once that exit finished, so a double click inserted the same
  transcript twice.
- **A leaked animation frame.** `cancel()` never stopped the meter, leaving a rAF loop that
  re-armed itself for the rest of the session after every `Esc`.
- **Layout thrash in the meter** — see Changed.
- **Reduced motion deleted feedback instead of softening it.** It now keeps the opacity
  cross-fades and drops only the movement.
- `prefers-reduced-transparency` and `prefers-contrast` are honoured.
- The press ring waits 110 ms before appearing, so ordinary clicks in the text field do not
  flash it.

## [1.0.0] - 2026-09-30

First release — the hold-to-talk gesture and everything it needs to be safe to use.

- Long-press anywhere on the composer card, release to transcribe into the draft. Nothing is
  ever sent automatically.
- Reuses the speech service the official voice-input bundle mounts. If that bundle is off,
  the plugin registers nothing and the composer keeps its normal behaviour.
- Cancel with `Esc`, or hold and swipe up (or leave the box) to discard.
- A transcript whose draft changed underneath it is retained in a chip rather than lost.
- Localised `zh` / `en`; light and dark themes; graceful degradation when a host contract is
  missing.

[Unreleased]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.5.2...v2.0.0
[1.5.2]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/jryang1997/dsh-hold-to-dictate/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jryang1997/dsh-hold-to-dictate/releases/tag/v1.0.0
