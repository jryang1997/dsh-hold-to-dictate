# Contributing

Thanks for looking. This is a small plugin with no build step, so the loop is short.

## The loop

```bash
npm run check     # parses both halves, checks the dictionaries, mounts every gesture state
```

There is no bundler, no transpiler and no dependencies. `client.js` is the browser half and
is loaded verbatim by the DSH module loader, so **what you edit is what runs** — reload the
page and it is live.

To try a change in a running Harness, install your clone as a bundle and reload:

```bash
dsh plugin --profile <profile> add <absolute path to your clone>
```

Then `Ctrl+R`. The client half is a browser module: it keeps the copy it already loaded until
the page is refreshed, so a reload is always part of the loop.

## What `npm run check` actually guards

`node --check` only proves the file parses. [`tests/render.test.mjs`](tests/render.test.mjs)
goes further: it performs the real module-loader handshake, captures the slot component
through a stubbed `apply`, and mounts it in every state the gesture can be in. It also
asserts the motion rules, because those are exactly the kind of thing that regresses
silently:

- entry and exit are **transitions** (`@starting-style` in, `data-leaving` out), never keyframes;
- only `transform`, `opacity`, `translate` and `scale` are animated;
- no transition animates a layout property or uses `ease-in`;
- exactly one looping animation exists, and it belongs to the transcribing state;
- the bubble and the card's hairline never take pointer events.

If you add a surface, add its exit here too.

`tests/live.test.mjs` exercises the registered slot through the audio and speech-service
boundaries: provisional and final draft updates, guarded rollback, manual edits, slow
responses, cancellation, retry and one-shot fallback. It also pins the refresh cadence — a
reply's own round trip sets the next wait, a failure backs off, a starved first preview retries
rather than ending the loop, and a long take commits at a sentence-length pause but never at a
short one.

## Two rules that are easy to break

**Reuse the turn's own tokens.** Colours come from `--dsw-alias-*`; the surface, radius and
shadow come from the host's own `--dsw-specific-*` / `--dsw-elevation-*` tokens; curves and
durations match what the host's own menus use. Nothing hard-coded, so light, dark,
`prefers-reduced-transparency` and `prefers-contrast` all keep working.

**If you add a dependency, declare it.** The client half may only `require()` modules the
platform already seeds (`react`, `react/jsx-runtime`, `@deepseek-ai/cordis`, …). Anything
else must be listed in `dsh.client.external`, or it throws at runtime with
`require("x") missed the module table`. Today only `react` is required, so `external` is
correctly empty.

## Reporting a bug

Use the issue form — it asks for the two things that decide almost every report here: which
speech provider is configured, and what the browser console says. Most "nothing happens"
reports are the official voice-input bundle being disabled, which is by design: this plugin
registers nothing when the speech service is absent rather than failing loudly.

## Repo assets

`docs/social-preview.png` (1280×640) is the link preview card. GitHub does not read it from
the repository — it is uploaded once under **Settings → Social preview**, and re-uploaded
when the design changes.
