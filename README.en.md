<img src="icon.svg" width="64" height="64" alt="Hold to talk logo">

# Hold to talk

[简体中文](README.md) · **English**

Hold the mouse button in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) message box and speak. Release to transcribe into your draft. **Nothing is sent automatically.**

<p align="center">
  <img src="docs/dictation-demo.gif" width="960" alt="Actual screen recording: hover to reveal the hint, hold to record, then swipe up and release to cancel">
</p>

Actual usage: hover hint → hold to record → swipe up to cancel.

## Ask your Agent to install

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

**The official voice-input module must be installed and enabled, with its recognition models ready.** On first use, click the built-in microphone button beside the message box and follow the prompts to download models and allow microphone access. This plugin uses that module's recognition service.

After installation, reload the page. Hold the mouse button in the message box for about 0.3 seconds, say a sentence, then release. Once the text appears in your draft, you're ready.

<details>
<summary>Install from the command line</summary>

With the official voice-input module already working, run:

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-hold-to-dictate
```

Replace `<profile>` with your profile name. The desktop app manages its `desktop` profile; use the Agent prompt above there.

</details>

## Use it

- Hold the mouse button in the message box to record; release to transcribe.
- Drag upward or outside the box, then release when the cancel cue appears to discard. You can also cancel with `Esc`.
- Keyboard: hold `Ctrl + Shift + Space` to record, then release to transcribe.
- If you edit the draft during recognition, the transcript stays in a small chip. Click it to insert the text.

Under **Settings → Plugins → Hold to talk**, adjust hold duration, keyboard shortcut, hover hint, recognition language and motion.

Enable **Live dictation (experimental)** to recognize while recording through the official local speech module; release to finalize the whole recording. Off by default. A short take re-reads the whole recording each time, so later results can revise earlier words. Once a take is long enough that one such read is slow, it commits at sentence-length pauses and reads only the new audio after each one, which keeps the cadence at a few updates per second instead of slowing down as you speak — at the cost of not revising words already committed. **The release-to-finalize pass still reads the complete recording, so the text you keep is unaffected.** Neither mode is a native token stream.

Live mode requires a local speech provider and a plain-text draft without reference chips. Unsupported environments retain release-to-transcribe. Manual editing stops automatic replacements and keeps the final result available for explicit insertion. Cancellation removes unchanged provisional words while preserving manual additions outside their range. Edits inside that range are kept with an explicit notice.

<p align="center">
  <img src="docs/settings-user.png" width="960" alt="Hold to talk settings: mouse and touch hold durations, motion, hover hint and keyboard shortcut">
</p>

The settings screenshot shows v1.5.2. The current version fixes the description text and updates the plugin name and icon. These older screenshots show neither the v2.1.0 live-dictation toggle nor the v2.2.0 recognition-language row.

<details>
<summary>Another settings screenshot</summary>

<p align="center">
  <img src="docs/settings-user-2.png" width="960" alt="Another Hold to talk settings screenshot showing all settings and component status">
</p>

</details>

## Update or uninstall

**After updating to v2.2.0**, just reload the page. **Live dictation (experimental)** still has to be enabled under **Settings → Plugins → Hold to talk**; leave it off to retain release-to-transcribe. The same pane now offers **recognition language**, "Host decides" by default — naming what you speak is faster.

GitHub installs do not update automatically. To update, send this to your Harness Agent:

```text
Update Hold to talk using plugin_manager. First remove the old installation with
action: remove_bundle, target: @jryang1997/dsh-hold-to-dictate.
Then install with action: install_bundle, target: github:jryang1997/dsh-hold-to-dictate.
Remind me to reload the page. Keep the official voice-input module installed.
```

If you still have the v1.x package `@jryang1997/dsh-composer-dictation`, ask the Agent to remove it first, then install the new package above to avoid activating both plugins. Existing local settings are preserved.

To uninstall, ask the Agent to remove `@jryang1997/dsh-hold-to-dictate`.

## Before you dictate

Recognition uses the speech service selected in Harness. The official default uses local SenseVoice; if you configure a cloud provider, audio is sent to that provider.

Community plugin, unaffiliated with DeepSeek. Tested with DeepSeek Harness `0.2.0-rc.2`.

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Implementation notes](docs/design.md) · [Report an issue](https://github.com/jryang1997/dsh-hold-to-dictate/issues) · [MIT](LICENSE)
