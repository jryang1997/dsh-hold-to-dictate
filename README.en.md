<img src="icon.svg" width="64" height="64" alt="Hold to talk logo">

# Hold to talk

Hold the mouse button in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) message box and speak. Release to transcribe into your draft. **Nothing is sent automatically.**

[![check](https://github.com/jryang1997/dsh-hold-to-dictate/actions/workflows/check.yml/badge.svg)](https://github.com/jryang1997/dsh-hold-to-dictate/actions/workflows/check.yml)
[![version](https://img.shields.io/github/v/tag/jryang1997/dsh-hold-to-dictate?label=version)](https://github.com/jryang1997/dsh-hold-to-dictate/tags)
[![license](https://img.shields.io/github/license/jryang1997/dsh-hold-to-dictate)](LICENSE)

[简体中文](README.md) · **English**

<p align="center">
  <img src="docs/dictation-demo.gif" width="960" alt="Actual screen recording: hover to reveal the hint, hold to record, then swipe up and release to cancel">
</p>

<p align="center">
  <img src="docs/gesture-overview.svg" width="840" alt="Three steps: hold for about 0.3 seconds, speak, release and the text lands in your draft">
</p>

## Before installing: two things have to be in place

This plugin has no recognizer of its own. It uses the official voice-input module's service.

| What you need | How to check |
|---|---|
| `@deepseek-ai/dsh-experimental-voice-input-bundle` | Installed and enabled under **Settings → Plugins** |
| A local recognition model | Click the built-in microphone button beside the message box and run "Download and prepare" |

When the models are missing, the plugin says so on its own recording surface and points you at the right pane. When the whole voice module is missing, it registers nothing at all, by design, so nothing happens on screen. Check the module first.

## Install

### Ask your Agent (recommended)

Switch DeepSeek Harness to **Creator mode**, then copy this into an Agent conversation:

```text
Use plugin_manager to install and enable Hold to talk in my current DeepSeek Harness profile.

First check the official voice-input module:
@deepseek-ai/dsh-experimental-voice-input-bundle
Install it if missing; otherwise make sure it is enabled.

Then install this plugin:
action: install_bundle
target: github:jryang1997/dsh-hold-to-dictate
If already installed, check that it is enabled instead of installing it again.

Check whether the recognition models are ready. If I need to download models or
grant microphone access, tell me where. When done, explain how to reload and test.
```

Reload the page afterwards. Hold the mouse button in the message box for about 0.3 seconds, say a sentence, then release. Once the text appears in your draft, you are ready.

<details>
<summary>Install from the command line</summary>

With the official voice-input module already working, run:

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-hold-to-dictate
```

Replace `<profile>` with your profile name. The desktop app manages its `desktop` profile exclusively and the CLI refuses it, so use the Agent prompt above there.

</details>

## Use it

Hold the mouse button in the message box and speak. Release to transcribe.

| Action | How |
|---|---|
| Record | Hold the mouse button in the message box, or hold `Ctrl + Shift + Space` |
| Transcribe | Release |
| Cancel | Drag upward out of the box and release when the cancel cue appears, or press `Esc` |
| Insert a held-back result | If you edited the draft during recognition, the transcript waits in a small chip at the lower right. Click it to insert at the caret |

Moving the pointer into the composer shows a hint line in the middle of the tool row reading "Hold to dictate · swipe up to cancel". When the free space in that row drops under 48 px, which happens with a long model label, the hint is dropped rather than drawn over the controls beside it. Every colour, radius, shadow and curve comes from the host's own tokens, so light, dark, reduced transparency and increased contrast all keep working.

## Settings

Under **Settings → Plugins → Hold to talk**. These settings apply to this machine only.

| Setting | Default | Options |
|---|---|---|
| Hold duration | 300 ms | 150 to 800 ms. Longer if your hand is slow, shorter if it fires by accident |
| Hold duration on a touch screen | 450 ms | 250 to 1200 ms. Longer than the mouse because a long press also selects a word |
| Recognition language | Host decides | Host decides / Chinese / English / Cantonese / Japanese / Korean |
| Keyboard shortcut | `Ctrl + Shift + Space` | Off / `Ctrl + Shift + Space` / `Ctrl + Shift + D` / `Ctrl + Shift + M` / `Ctrl + Alt + Space` |
| Hover hint | On | On / Off |
| Motion | Full | Full / Calm (drops movement and scale, keeps the cross-fades) |
| Live dictation (experimental) | Off | On / Off, see below |

Naming a fixed recognition language skips the Host's own per-request language detection. Measured faster at most clip lengths, and never slower.

<details>
<summary>Settings screenshots (v1.5.2, older)</summary>

<p align="center">
  <img src="docs/settings-user.png" width="960" alt="Hold to talk settings: mouse and touch hold durations, motion, hover hint and keyboard shortcut">
</p>

Both screenshots are from v1.5.2. The description text in them was wrong at the time, the plugin name and icon are the old ones, and neither shows the v2.1.0 live-dictation toggle or the v2.2.0 recognition-language row. The table above is current.

<p align="center">
  <img src="docs/settings-user-2.png" width="960" alt="Another Hold to talk settings screenshot showing all settings and component status">
</p>

</details>

## Live dictation (experimental)

Enabled, this calls the official local speech module while you record and writes results into the draft as they arrive. Releasing finalizes the whole recording.

It behaves in two phases:

- **Short takes** re-read the whole recording each time, so later results can revise earlier words.
- **Long takes** switch once a whole-take read costs more than about 0.7 s. From there it commits everything up to the last sentence-length pause and reads only the new audio after it. The pause is found in the recording itself and cut down the middle, so a window never starts on a word. A take with no sentence-length pause never commits and keeps the whole-take behaviour. Committed words are frozen for the rest of that take.

Neither phase affects what you keep. **The release-to-finalize pass still reads the complete recording.**

Measured on one 21-second clip with sentence pauses, changing only the code version: previews went from 14 to 46, and the first words appeared at 802 ms instead of 1246 ms. The old slowness came from the plugin's own fixed one-second wait, not from the model.

Live mode requires a local speech provider and a plain-text draft without reference chips; other environments keep release-to-transcribe. Editing the draft during recognition stops automatic replacement and keeps the final result in the chip for explicit insertion. Neither mode is a native token stream.

## When something goes wrong

| Symptom | Cause and fix |
|---|---|
| Holding does nothing at all | Almost always the official voice-input module being disabled. The plugin degrades silently rather than failing loudly, so there is no message. Check it is enabled under **Settings → Plugins** |
| It says the speech models are not prepared | Open **Settings → Plugins → Voice input** and run "Download and prepare" once |
| It says the microphone is unavailable | Allow Harness to use the microphone in your system settings, then retry |
| Transcription fails, provider unreachable | The speech service was unreachable at that moment. A failure does not consume the audio you recorded. Use **Retry** on the capsule to send the same recording again, or dismiss and record again |

If you edited the draft during recognition, the result steps aside into the chip at the lower right instead of overwriting your edit.

## Known limits

- After a long take commits a segment, those provisional words stop correcting themselves. Releasing still finalizes from the complete recording.
- The agreement figures come from one studio clip, one model, one machine and a limited number of runs. They are not a guarantee across material.
- Browser testing used a fake microphone fed a WAV plus a simplified DOM stub. **A real microphone on a real page was not tested.** Pause detection is harder on spontaneous speech; in noise it finds no pause and falls back to whole-take recognition, which is the safe direction.
- Recordings are capped at about 110 seconds and 4 MiB, whichever the speech service advertises is smaller.

## Update or uninstall

GitHub installs do not update automatically: pnpm pins a GitHub dependency to one commit, so a new release in the repository is not picked up. Updating means removing first, then installing:

```text
Update Hold to talk using plugin_manager. First remove the old installation with
action: remove_bundle, target: @jryang1997/dsh-hold-to-dictate.
Then install with action: install_bundle, target: github:jryang1997/dsh-hold-to-dictate.
Remind me to reload the page. Keep the official voice-input module installed.
```

Reload the page afterwards. Your settings are preserved.

If you still have the v1.x package `@jryang1997/dsh-composer-dictation`, remove it first and then install the package above, so both plugins are never active at once. To uninstall, remove `@jryang1997/dsh-hold-to-dictate`.

## Before you dictate

Recognition uses the speech service selected in Harness. The official default is local SenseVoice, and audio stays on this machine. If you configure a cloud provider, recordings are sent to that provider.

Community plugin, unaffiliated with DeepSeek. Tested with DeepSeek Harness `0.2.0-rc.2`.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Implementation notes](docs/design.md) · [Report an issue](https://github.com/jryang1997/dsh-hold-to-dictate/issues) · [MIT](LICENSE)
