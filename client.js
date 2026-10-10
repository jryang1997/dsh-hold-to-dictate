/**
 * Hold-to-talk — long-press anywhere on the composer card to dictate.
 *
 * Client half of @jryang1997/dsh-hold-to-dictate. It mounts one entry into
 * `conversation.input.overlay` (a list slot rendered inside the resident composer
 * card), walks up from its own node to `[data-composer-card]`, and watches pointer
 * events on that card in the capture phase.
 *
 * A press that stays still past HOLD_MS turns the whole card into a recording
 * surface; releasing transcribes through the `speech` Remote and inserts the text
 * with the slot's own `inputActions`. A press that moves or releases earlier is
 * left completely alone, so typing, caret placement and text selection are
 * untouched.
 *
 * Nothing outside this component's subtree is written. The recording surfaces never take a
 * pointer event; the retained-transcript chip and the failure card are the only two that do.
 */
window.__ModuleLoader__.load({
	id: '@jryang1997/dsh-hold-to-dictate',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'dsh-hold-to-dictate';
		const SLOT = 'conversation.input.overlay';
		const ENTRY = 'hold-to-dictate';

		/**
		 * How long the pointer must stay still before the composer becomes a microphone. The
		 * live value comes from settings; this is only the stylesheet's fallback.
		 */
		const HOLD_MS = 300;
		/** Movement beyond this disarms the gesture: it was a click, a caret move or a selection. */
		const ARM_TOLERANCE_PX = 10;
		/** A finger is not a mouse: it rolls, and it never stays within ten pixels. */
		const TOUCH_TOLERANCE_PX = 16;
		/** The hint's own box, shared by its stylesheet rule and its measured position. */
		const HINT_HEIGHT = 20;
		/** Upward travel that arms "release to discard". Leaving the card arms it too. */
		const CANCEL_ARM_PX = 48;
		/**
		 * The disarm threshold, deliberately 10 px *below* the arm threshold. A single
		 * threshold makes a pointer resting on the line flicker the whole bubble between
		 * its normal and discard faces; the band is what turns that into a stable state.
		 */
		const CANCEL_RELEASE_PX = 38;
		/** Upward release speed (px/s) that settles reverse-vs-commit before position does. */
		const CANCEL_FLICK_PX_PER_S = 150;
		/** How much pointer history the release velocity is measured over. */
		const VELOCITY_WINDOW_MS = 90;
		/** Recordings shorter than this are dropped instead of transcribed. */
		const MIN_SECONDS = 0.35;
		/** Kept below the Host default (120 s) so the Host never rejects on duration. */
		const MAX_SECONDS = 110;
		/** Kept below the Host default (4 MiB) so the Host never rejects on size. */
		const MAX_BYTES = 4 * 1024 * 1024 - 4096;
		/**
		 * Live-preview cadence. The transcript grows a few characters a second, so refreshing
		 * tighter than this only re-renders text that has not changed yet.
		 */
		const LIVE_MIN_INTERVAL_MS = 250;
		/** Ceiling for the retry backoff after a failed preview. */
		const LIVE_MAX_BACKOFF_MS = 2500;
		/** Target interval as a multiple of the measured round trip, keeping the worker ~87% busy. */
		const LIVE_INTERVAL_SLACK = 1.15;
		/** Once a preview costs this much, stop re-reading the whole take and commit at pauses. */
		const LIVE_SEGMENT_AFTER_MS = 700;
		/** A pause at least this long marks a sentence break worth committing at. */
		const LIVE_PAUSE_SECONDS = 0.8;
		/** A chunk is silence below this fraction of the loudest chunk heard so far. */
		const LIVE_PAUSE_LEVEL_RATIO = 0.06;
		/** Absolute floor for that test, so a very quiet room still counts its speech as speech. */
		const LIVE_PAUSE_LEVEL_FLOOR = 0.002;
		/** A segment is only worth committing once it is at least this long. */
		const LIVE_SEGMENT_MIN_SECONDS = 1;
		/** How soon to look again while the worklet still holds less than MIN_SECONDS of audio. */
		const LIVE_STARVE_RETRY_MS = 120;
		/** Consecutive starved previews tolerated before live mode gives up on the worklet. */
		const LIVE_STARVE_LIMIT = 12;
		/** How long a transient surface takes to leave, and how long the press ring retracts. */
		const EXIT_MS = 180;
		const RING_EXIT_MS = 140;
		/** How long a one-line notice stays on screen, and how long its exit runs. */
		const NOTICE_MS = 2800;
		const NOTICE_EXIT_MS = 180;
		/** The meter keeps running after release so the bars fall instead of vanishing. */
		const METER_SETTLE_MS = 240;
		const COMPLETE_MS = 900;
		/**
		 * The level meter is the shipped voice-input waveform: a shift register of recent
		 * RMS samples redrawn at 20 fps. The register *is* the smoothing — each new sample
		 * pushes the older ones one bar along, so the trace scrolls instead of flickering.
		 */
		const WAVE_BARS = 28;
		const WAVE_INTERVAL_MS = 50;
		const WAVE_SAMPLE_GAIN = 5;
		const WAVE_MAX_HEIGHT = 17;
		/** Zeros are shifted through faster once recording stops, so the trace drains. */
		const WAVE_DRAIN_PER_TICK = 4;
		/** The press ring. Radius 15.5 draws a 36 px circle; the arc is a dash offset. */
		const RING_RADIUS = 15.5;
		const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
		/** Spring frequency of the release return; the meter clock steps it. */
		const SETTLE_FREQUENCY = 28;

		/** Exact critically damped return; retarget from the current position and velocity. */
		function settleLift(position, velocity, seconds) {
			const decay = Math.exp(-SETTLE_FREQUENCY * seconds);
			const momentum = velocity + SETTLE_FREQUENCY * position;
			return {
				position: (position + momentum * seconds) * decay,
				velocity: (velocity - SETTLE_FREQUENCY * momentum * seconds) * decay,
			};
		}

		//#region config

		/**
		 * Every tunable, in one place.
		 *
		 * The settings page is what forced this module into existence. These values used to be
		 * module constants read straight out of the gesture, and a page that writes them would
		 * have scattered storage calls across the whole effect. One small interface —
		 * get / set / subscribe / reset — keeps the defaults, the clamping, the persistence and
		 * the notification behind it, so no caller has to know where a value came from.
		 *
		 * Storage is the browser's, not the Host's settings service. Deliberate: it keeps the
		 * plugin free of any `@deepseek-ai/dsh-*` dependency (a wrong peer range makes DSH skip
		 * the entire bundle, silently, with nothing on screen to say why), and these are
		 * per-machine preferences rather than configuration that should travel with a profile.
		 */
		const PKG = '@jryang1997/dsh-hold-to-dictate';
		/*
		 * Deliberately still the *old* package name, and deliberately left alone by the 2.0.0
		 * rename. This string is a storage key, not an identity: it is what the browser has
		 * already written the user's settings under. Renaming it to match the package would
		 * silently discard every setting anyone had tuned, in exchange for nothing.
		 */
		const CONFIG_KEY = 'dsh-composer-dictation.config';
		const CONFIG_SLOT = 'plugins.bundle.config';

		/**
		 * The chords offered in settings. Matching is on `event.code`, which is the physical key,
		 * so a layout that moves the letters around cannot silently break the shortcut.
		 */
		const CHORDS = {
			off: null,
			'Control+Shift+Space': { ctrl: true, shift: true, alt: false, code: 'Space', label: 'Ctrl + Shift + Space' },
			'Control+Shift+D': { ctrl: true, shift: true, alt: false, code: 'KeyD', label: 'Ctrl + Shift + D' },
			'Control+Shift+M': { ctrl: true, shift: true, alt: false, code: 'KeyM', label: 'Ctrl + Shift + M' },
			'Control+Alt+Space': { ctrl: true, shift: false, alt: true, code: 'Space', label: 'Ctrl + Alt + Space' },
		};

		/** Which dictionary key names each recognizer language, in schema order. */
		const LANGUAGE_LABELS = {
			host: 'languageHost', zh: 'languageZh', en: 'languageEn',
			yue: 'languageYue', ja: 'languageJa', ko: 'languageKo',
		};

		/** The schema: every knob, what a fresh install runs, and how it is offered. */
		const CONFIG_FIELDS = {
			holdMs: { fallback: HOLD_MS, min: 150, max: 800, step: 10, kind: 'number' },
			touchHoldMs: { fallback: 450, min: 250, max: 1200, step: 10, kind: 'number' },
			motion: { fallback: 'full', oneOf: ['full', 'calm'], kind: 'choice' },
			hint: { fallback: true, kind: 'switch' },
			chord: { fallback: 'Control+Shift+Space', oneOf: Object.keys(CHORDS), kind: 'choice' },
			live: { fallback: false, kind: 'switch' },
			language: { fallback: 'host', oneOf: Object.keys(LANGUAGE_LABELS), kind: 'choice' },
		};

		const configDefaults = () => Object.fromEntries(
			Object.entries(CONFIG_FIELDS).map(([key, field]) => [key, field.fallback]),
		);

		/** Fit one stored value to its field, falling back rather than throwing. */
		const coerceConfig = (field, value) => {
			if (field.oneOf !== undefined) return field.oneOf.includes(value) ? value : field.fallback;
			if (field.kind === 'switch') return typeof value === 'boolean' ? value : field.fallback;
			const number = typeof value === 'number' ? value : Number.parseFloat(value);
			if (!Number.isFinite(number)) return field.fallback;
			return Math.round(Math.min(field.max, Math.max(field.min, number)));
		};

		/** A blocked origin or a private window must not take the plugin down with it. */
		const safeStorage = (() => {
			try {
				const store = window.localStorage;
				store.setItem(`${CONFIG_KEY}.probe`, '1');
				store.removeItem(`${CONFIG_KEY}.probe`);
				return store;
			} catch (error) {
				const memory = new Map();
				return {
					getItem: (key) => (memory.has(key) ? memory.get(key) : null),
					setItem: (key, value) => memory.set(key, value),
					removeItem: (key) => memory.delete(key),
				};
			}
		})();

		/** Read, clamp, persist and broadcast — the whole of the plugin's mutable configuration. */
		function createConfig(storage) {
			const listeners = new Set();

			const load = () => {
				const next = configDefaults();
				try {
					const raw = storage.getItem(CONFIG_KEY);
					if (raw === null) return next;
					const stored = JSON.parse(raw);
					if (stored === null || typeof stored !== 'object') return next;
					for (const [key, field] of Object.entries(CONFIG_FIELDS)) {
						if (key in stored) next[key] = coerceConfig(field, stored[key]);
					}
				} catch (error) {
					// A corrupt store is not worth failing over: the defaults are always a
					// working plugin, and the next write repairs the file.
				}
				return next;
			};

			let values = load();

			const persist = () => {
				try {
					storage.setItem(CONFIG_KEY, JSON.stringify(values));
				} catch (error) {
					/* read-only here; the session still runs on the values held in memory */
				}
			};

			const publish = (key) => {
				for (const listener of listeners) listener(key, values);
			};

			return {
				get: (key) => values[key],
				all: () => ({ ...values }),
				set(key, value) {
					const field = CONFIG_FIELDS[key];
					if (field === undefined) return;
					const next = coerceConfig(field, value);
					if (values[key] === next) return;
					values = { ...values, [key]: next };
					persist();
					publish(key);
				},
				reset() {
					values = configDefaults();
					persist();
					publish(null);
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			};
		}

		const config = createConfig(safeStorage);

		/** The chord a keydown is asking for, or null when it matches none of them. */
		const chordOf = (event) => {
			for (const [name, spec] of Object.entries(CHORDS)) {
				if (spec === null) continue;
				// `=== true`, so a synthesised or partial event with a missing modifier reads as
				// "not held" rather than as "held differently".
				if ((event.ctrlKey === true) !== spec.ctrl) continue;
				if ((event.shiftKey === true) !== spec.shift) continue;
				if ((event.altKey === true) !== spec.alt) continue;
				if (event.metaKey === true) continue;
				if (event.code === spec.code || (spec.code === 'Space' && event.key === ' ')) return name;
			}
			return null;
		};

		/** Only the configured chord counts: choosing Ctrl+Shift+D does not leave Space armed. */
		const isChord = (event) => {
			const wanted = config.get('chord');
			return wanted !== 'off' && chordOf(event) === wanted;
		};

		/** Any key that belongs to the configured chord, which is what ends a held one. */
		const isChordKey = (event) => {
			const spec = CHORDS[config.get('chord')];
			if (spec === undefined || spec === null) return false;
			return event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt'
				|| event.code === spec.code || (spec.code === 'Space' && event.key === ' ');
		};

		//#endregion

		/** Handles captured in `apply`, so a slot entry that receives no injected props still works. */
		const runtime = { speech: null, limits: null };
		/** The provider entry the Host selected, or undefined before its limits arrive. */
		const selectedProvider = () => runtime.limits?.providers?.find((entry) => entry.id === runtime.limits.selection?.providerId);
		/** Recording cap: the smaller of the Host's limit and this plugin's ceiling. */
		const maxSeconds = () => Math.min(MAX_SECONDS, runtime.limits?.maxDurationSeconds ?? MAX_SECONDS);
		/** Audio cap: the smaller of the Host's limit and this plugin's ceiling. */
		const maxBytes = () => Math.min(MAX_BYTES, runtime.limits?.maxAudioBytes ?? MAX_BYTES);

		const zh = {
			hint: '按住鼠标语音输入文字 · 上滑取消',
			release: '松开完成',
			cancelHint: 'Esc 取消 · 上滑或移出输入框取消',
			cancelReady: '松开丢弃',
			cancelReadyHint: '松手即丢弃，移回输入框可继续',
			transcribing: '识别中',
			complete: '已插入草稿',
			cancelled: '已取消',
			cancelledEdited: '已停止录音；草稿有改动，保留现有文字',
			empty: '没有识别到内容，可以说长一点再试',
			tooShort: '太短了，按住再多说一会儿',
			conflict: '草稿已改动，转写结果保留在右下角',
			pending: '插入转写',
			pendingHint: '点击插入到当前光标',
			retry: '重试',
			dismiss: '关闭',
			notReady: '语音模型还没准备好：请到「设置 → 插件 → 语音输入」点一次「下载并准备」',
			failed: '转写失败：{message}',
			unavailable: '当前环境无法录音',
			permission: '麦克风不可用，请在系统设置中允许后重试',
			tooLarge: '录音超出语音服务上限，请说短一点',
			settingsIntro: '这些设置只影响本机，不会离开这台电脑。',
			holdMsLabel: '按住时长',
			holdMsHint: '按住多久才开始录音。手慢就调长一点，误触多就调短一点。',
			touchHoldMsLabel: '触屏按住时长',
			touchHoldMsHint: '手指按住多久才开始录音。触摸屏上长按同时也是选词，所以这里默认更长。',
			motionLabel: '动效',
			motionHint: '「精简」会去掉位移与缩放，只保留淡入淡出。',
			motionFull: '完整',
			motionCalm: '精简',
			hintLabel: '悬停提示',
			hintHint: '鼠标移入输入框时，在工具行中间显示那一行提示。',
			switchOn: '开',
			switchOff: '关',
			chordLabel: '键盘快捷键',
			chordHint: '按住这个组合键同样可以说话，松开即转写。',
			chordOff: '关闭',
			liveLabel: '边说边出字（实验）',
			liveHint: '录音时滚动识别，文字可能修正；松开后整段定稿。仅对本地语音服务启用。',
			languageLabel: '识别语言',
			languageHint: '「跟随宿主」由 Harness 每次自己判断语种，固定成你实际说的语言可以省掉这一步；实测多数长度下更快，也可能持平。',
			languageHost: '跟随宿主',
			languageZh: '中文',
			languageEn: '英文',
			languageYue: '粤语',
			languageJa: '日文',
			languageKo: '韩文',
			settingsReset: '恢复默认',
			settingsLocal: '单位：毫秒',
		};
		const en = {
			hint: 'Hold to dictate · swipe up to cancel',
			release: 'Release to finish',
			cancelHint: 'Esc, or swipe up / leave the box to cancel',
			cancelReady: 'Release to discard',
			cancelReadyHint: 'releasing now discards it — move back to keep it',
			transcribing: 'Transcribing',
			complete: 'Added to draft',
			cancelled: 'Cancelled',
			cancelledEdited: 'Recording stopped; draft edits were preserved',
			empty: 'Nothing was recognized — try speaking a little longer',
			tooShort: 'Too short — hold a little longer',
			conflict: 'Draft changed; the transcript is kept at the lower right',
			pending: 'Insert transcript',
			pendingHint: 'Click to insert at the current caret',
			retry: 'Retry',
			dismiss: 'Dismiss',
			notReady: 'The speech models are not prepared yet: open Settings → Plugins → Voice input and run "Download and prepare" once',
			failed: 'Could not transcribe the recording: {message}',
			unavailable: 'This environment cannot record audio',
			permission: 'Microphone unavailable; allow access in system settings and retry',
			tooLarge: 'That recording is longer than the speech service accepts',
			settingsIntro: 'These settings apply to this machine only; nothing leaves it.',
			holdMsLabel: 'Hold duration',
			holdMsHint: 'How long the press must stay still. Longer if your hand is slow, shorter if it fires by accident.',
			touchHoldMsLabel: 'Hold duration on a touch screen',
			touchHoldMsHint: 'How long a finger must stay still. Longer by default, because a long press is also how a touch screen selects a word.',
			motionLabel: 'Motion',
			motionHint: 'Calm drops movement and scale, and keeps the cross-fades.',
			motionFull: 'Full',
			motionCalm: 'Calm',
			hintLabel: 'Hover hint',
			hintHint: 'Show the hint line in the middle of the tool row when the pointer enters the composer.',
			switchOn: 'On',
			switchOff: 'Off',
			chordLabel: 'Keyboard shortcut',
			chordHint: 'Hold this chord to dictate without a mouse; letting go transcribes.',
			chordOff: 'Off',
			liveLabel: 'Live dictation (experimental)',
			liveHint: 'Recognize while recording; words may be revised. Release to finalize the whole recording. Local speech providers only.',
			languageLabel: 'Recognition language',
			languageHint: '"Host decides" makes Harness detect the language on every request; naming what you actually speak skips that step. Measured faster at most lengths, and never slower.',
			languageHost: 'Host decides',
			languageZh: 'Chinese',
			languageEn: 'English',
			languageYue: 'Cantonese',
			languageJa: 'Japanese',
			languageKo: 'Korean',
			settingsReset: 'Restore defaults',
			settingsLocal: 'milliseconds',
		};

		/**
		 * Last-resort dictionary for the case where a slot entry is handed no translator at
		 * all. DSH always resolves through `ctx.locale` first — its fallback chain ends at
		 * English — so this should never be reached; it exists so that a registration change
		 * can never leave raw keys on screen.
		 */
		const fallbackDictionary = String(navigator.language ?? '').toLowerCase().startsWith('zh') ? zh : en;

		/**
		 * Resolve a label through the slot's own translator, falling back to the local
		 * dictionary so a missing `t` can never surface a raw key in the UI.
		 */
		const translate = (props, key, params) => {
			if (typeof props.t === 'function') {
				const value = props.t(key, params);
				if (typeof value === 'string' && value !== key) return value;
			}
			const template = fallbackDictionary[key] ?? key;
			if (params === undefined) return template;
			return template.replace(/\{(\w+)\}/g, (match, name) =>
				params[name] === undefined ? match : String(params[name]));
		};

		//#region audio

		/** Wrap 16 kHz mono float samples in the exact 44-byte PCM16 WAV header the Host validates. */
		function encodeWave(samples) {
			const length = samples.length;
			const buffer = new ArrayBuffer(44 + length * 2);
			const view = new DataView(buffer);
			const ascii = (offset, value) => {
				for (let index = 0; index < value.length; index += 1) {
					view.setUint8(offset + index, value.charCodeAt(index));
				}
			};
			ascii(0, 'RIFF');
			view.setUint32(4, 36 + length * 2, true);
			ascii(8, 'WAVE');
			ascii(12, 'fmt ');
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, 16000, true);
			view.setUint32(28, 32000, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			ascii(36, 'data');
			view.setUint32(40, length * 2, true);
			for (let index = 0; index < length; index += 1) {
				const sample = Math.max(-1, Math.min(1, samples[index]));
				view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
			}
			return buffer;
		}

		/** Canonical base64 of the whole buffer, chunked so the argument list stays small. */
		function toBase64(buffer) {
			const bytes = new Uint8Array(buffer);
			let binary = '';
			for (let offset = 0; offset < bytes.length; offset += 0x8000) {
				binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
			}
			return window.btoa(binary);
		}

		/** Decode whatever MediaRecorder produced and re-render it as 16 kHz mono PCM16 WAV. */
		async function toSixteenKilohertz(blob) {
			const bytes = await blob.arrayBuffer();
			const decoder = new AudioContext();
			try {
				const decoded = await decoder.decodeAudioData(bytes);
				const seconds = Math.min(decoded.duration, MAX_SECONDS);
				const frames = Math.max(1, Math.round(seconds * 16000));
				const offline = new OfflineAudioContext(1, frames, 16000);
				const source = offline.createBufferSource();
				source.buffer = decoded;
				source.connect(offline.destination);
				source.start(0);
				const rendered = await offline.startRendering();
				return { buffer: encodeWave(rendered.getChannelData(0)), seconds: rendered.duration };
			} finally {
				await decoder.close().catch(() => undefined);
			}
		}

		/** One microphone capture: permission, chunks, live level, and the encoded result. */
		function createCapture(live = false) {
			const chunks = [];
			const pcm = [];
			let frames = 0;
			let source = null;
			let worklet = null;
			let stream = null;
			let recorder = null;
			let context = null;
			let analyser = null;
			let failure = null;
			let released = false;
			// Pause structure, counted in the same sample frames as the audio itself, so a commit
			// point can never drift away from what the recognizer was actually sent.
			let checkpointFrame = 0;
			let quietFrom = 0;
			let quiet = false;
			let loudest = 0;

			const release = () => {
				if (released) return;
				released = true;
				try {
					if (recorder !== null && recorder.state !== 'inactive') recorder.stop();
				} catch (error) {
					/* already torn down */
				}
				if (stream !== null) for (const track of stream.getTracks()) track.stop();
				stream = null;
				if (worklet !== null) {
					worklet.port.onmessage = null;
					worklet.port.close();
					worklet.disconnect();
				}
				if (source !== null) source.disconnect();
				pcm.length = 0;
				recorder = null;
				analyser = null;
				if (context !== null) {
					context.close().catch(() => undefined);
					context = null;
				}
			};

			return {
				async start() {
					if (typeof MediaRecorder === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
						throw new Error('media-recorder-unavailable');
					}
					stream = await navigator.mediaDevices.getUserMedia({
						audio: {
							channelCount: 1,
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
						},
						video: false,
					});
					if (released) {
						for (const track of stream.getTracks()) track.stop();
						return;
					}
					context = new AudioContext();
					analyser = context.createAnalyser();
					analyser.fftSize = 256;
					source = context.createMediaStreamSource(stream);
					source.connect(analyser);
					if (live && context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
						// PCM snapshots are independent WAVs; partial MediaRecorder containers
						// cannot reliably be decoded before their final header is written.
						const url = URL.createObjectURL(new Blob([`
class DictationPCM extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(4096); this.used = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const sample of input) {
      this.buffer[this.used++] = sample;
      if (this.used === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096); this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor('dsh-dictation-pcm', DictationPCM);
`], { type: 'text/javascript' }));
						try {
							await context.audioWorklet.addModule(url);
							if (released) return;
							worklet = new AudioWorkletNode(context, 'dsh-dictation-pcm');
							worklet.port.onmessage = ({ data }) => {
								if (released || !(data instanceof Float32Array)) return;
								const chunk = data.subarray(0, Math.max(0, Math.floor(context.sampleRate * MAX_SECONDS) - frames));
								if (chunk.length === 0) return;
								pcm.push(chunk); frames += chunk.length;
								let energy = 0;
								for (const sample of chunk) energy += sample * sample;
								const level = Math.sqrt(energy / chunk.length);
								if (level > loudest) loudest = level;
								const held = Math.max(loudest * LIVE_PAUSE_LEVEL_RATIO, LIVE_PAUSE_LEVEL_FLOOR);
								if (level < held) {
									if (!quiet) { quiet = true; quietFrom = frames - chunk.length; }
								} else {
									// The run just ended; only a sentence-length one is worth committing at,
									// and it is cut down the middle so a small clock offset cannot land on a
									// word.
									if (quiet && frames - chunk.length - quietFrom >= context.sampleRate * LIVE_PAUSE_SECONDS) {
										checkpointFrame = Math.round((quietFrom + frames - chunk.length) / 2);
									}
									quiet = false;
								}
							};
							source.connect(worklet);
							// The processor has silent outputs; keeping it connected keeps capture live.
							worklet.connect(context.destination);
						} catch (error) {
							// Worklet/CSP support is optional; whole-recording dictation still works.
							console.warn('dsh-hold-to-dictate: live audio unavailable', error);
						} finally {
							URL.revokeObjectURL(url);
						}
					}
					if (released) return;
					recorder = new MediaRecorder(stream);
					recorder.addEventListener('dataavailable', (event) => {
						if (event.data !== undefined && event.data.size > 0) chunks.push(event.data);
					});
					// A device lost mid-capture may never emit `stop`; record the reason and let
					// `stop()` bail out instead of awaiting an event that will not arrive.
					recorder.addEventListener('error', (event) => {
						failure = event?.error instanceof Error ? event.error : new Error('recorder-failed');
					});
					recorder.start(200);
				},
				/**
				 * Encode the recording, or one window of it, as the canonical WAV the Host validates.
				 *
				 * `from` and `to` are audio seconds and default to the whole take. Segmented live
				 * dictation reads only the window since its last commit, which is what stops a long
				 * recording from re-reading all of itself on every refresh.
				 */
				async snapshot(from = 0, to = null) {
					if (released || frames < context.sampleRate * MIN_SECONDS) return null;
					const samples = new Float32Array(frames);
					let offset = 0;
					for (const chunk of pcm) { samples.set(chunk, offset); offset += chunk.length; }
					const rate = context.sampleRate;
					const start = Math.max(0, Math.min(frames - 1, Math.round(from * rate)));
					const end = to === null ? frames : Math.max(start + 1, Math.min(frames, Math.round(to * rate)));
					const slice = start === 0 && end === frames ? samples : samples.subarray(start, end);
					const seconds = (end - start) / rate;
					const window = { seconds, from: start / rate, to: end / rate };
					if (rate === 16000) return { buffer: encodeWave(slice), ...window };
					const offline = new OfflineAudioContext(1, Math.round(slice.length * 16000 / rate), 16000);
					const buffer = offline.createBuffer(1, slice.length, rate);
					buffer.copyToChannel(slice, 0);
					const node = offline.createBufferSource();
					node.buffer = buffer; node.connect(offline.destination); node.start(0);
					const rendered = await offline.startRendering();
					return { buffer: encodeWave(rendered.getChannelData(0)), ...window };
				},
				/** Audio second of the newest sentence-length pause, or 0 when there has not been one. */
				checkpoint() { return checkpointFrame / context.sampleRate; },
				/**
				 * RMS amplitude of the current frame — the same measure the shipped voice input
				 * uses, and deliberately *unclamped*: the waveform applies its own gain when it
				 * draws, so clamping here would flatten loud speech into a solid block.
				 */
				level() {
					if (analyser === null || released) return 0;
					const frame = new Float32Array(analyser.fftSize);
					analyser.getFloatTimeDomainData(frame);
					let sum = 0;
					for (let index = 0; index < frame.length; index += 1) {
						sum += frame[index] * frame[index];
					}
					return Math.sqrt(sum / frame.length);
				},
				async stop() {
					if (recorder !== null && recorder.state !== 'inactive') {
						await new Promise((resolve) => {
							// Bounded: a wedged recorder must never hang the composer UI, and the
							// microphone has to be released either way.
							const timer = window.setTimeout(resolve, 4000);
							const settle = () => {
								window.clearTimeout(timer);
								resolve();
							};
							recorder.addEventListener('stop', settle, { once: true });
							recorder.addEventListener('error', settle, { once: true });
							try {
								recorder.stop();
							} catch (error) {
								settle();
							}
						});
					}
					const blob = new Blob(chunks, { type: chunks[0]?.type ?? 'audio/webm' });
					const reason = failure;
					release();
					if (reason !== null) throw reason;
					if (blob.size === 0) return { buffer: encodeWave(new Float32Array(0)), seconds: 0 };
					return await toSixteenKilohertz(blob);
				},
				dispose: release,
			};
		}

		//#endregion

		//#region styles

		/**
		 * Every curve, duration and material here is borrowed from the host app rather than
		 * invented, so the plugin reads as part of DSH instead of as a guest:
		 *
		 * - `cubic-bezier(.16,1,.3,1)` is the curve DSH's own menus and preset seats enter on.
		 * - `cubic-bezier(.4,0,.2,1)` is its `--ds-ease-in-out`.
		 * - 140–200 ms sits inside its `--ds-transition-duration` band.
		 * - The translucent surface is the `MenuSurface` recipe the host uses for every
		 *   floating layer: `--dsw-menu-surface-fill` over `--dsw-menu-backdrop-filter`.
		 * - `--dsw-radius-panel` is the composer card's own 28 px, and the app runs with
		 *   `corner-shape: superellipse(1.5)` globally, so matching the radius matches the
		 *   squircle too.
		 *
		 * Two rules hold throughout. Motion is `transform`/`opacity`/`translate`/`scale` only,
		 * never a layout property. And every state change is a *transition* — entry rides
		 * `@starting-style` and exit a `data-leaving` attribute — never a keyframe, so
		 * anything the user reverses mid-flight resumes from where it actually is.
		 */
		const STYLES = `
.dsh-htt-layer{
  --dsh-htt-out:cubic-bezier(.16,1,.3,1);
  --dsh-htt-in-out:cubic-bezier(.4,0,.2,1);
  --dsh-htt-t-press:140ms;
  --dsh-htt-t-base:200ms;
  --dsh-htt-t-exit:${EXIT_MS}ms;
  --dsh-htt-hold:${HOLD_MS}ms;
}

/* ---- press ring: the 300 ms before the bubble exists ------------------- */
.dsh-htt-ring{
  position:absolute; width:36px; height:36px; margin:-18px 0 0 -18px;
  color:var(--dsw-alias-label-secondary); pointer-events:none;
  transition:opacity var(--dsh-htt-t-press) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-ring{opacity:0}}
/*
 * The ring waits 110 ms before appearing. Clicking into the text field is the most
 * common thing anyone does in this composer, and a ring that flashes on every caret
 * move would be noise; a press that is still going after 110 ms is a hold.
 */
.dsh-htt-ring{transition-delay:110ms}
.dsh-htt-ring[data-leaving]{opacity:0;transition-delay:0ms;transition-duration:120ms}
.dsh-htt-ring-track{opacity:.16}
/*
 * The arc is the hold progress. Because it is a transition, disarming simply
 * retargets the dash offset back to full and the ring drains from wherever it
 * had actually reached — no restart, no jump.
 */
.dsh-htt-ring-arc{
  transform:rotate(-90deg); transform-origin:50% 50%;
  stroke-dasharray:${RING_LENGTH.toFixed(2)}; stroke-dashoffset:0;
  transition:stroke-dashoffset var(--dsh-htt-hold) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-ring-arc{stroke-dashoffset:${RING_LENGTH.toFixed(2)}}}
.dsh-htt-ring[data-leaving] .dsh-htt-ring-arc{
  stroke-dashoffset:${RING_LENGTH.toFixed(2)};
  transition:stroke-dashoffset 140ms var(--dsh-htt-in-out);
}

/* ---- hover hint: parked in the tool row, never over the draft ---------- */
.dsh-htt-hint{
  position:absolute; display:flex; align-items:center; gap:6px; height:${HINT_HEIGHT}px;
  /*
   * The tool row has one typographic voice and this has to join it. The host's model selector
   * — the ModelSelect trigger, the control this sits beside — is 13px / 400 / 20px with normal
   * tracking and label-secondary; everything here matches it.
   *
   * Not to be confused with the InputBar stylesheet's select rule, which is 13px / 500 and is
   * dead CSS: nothing in the host renders it. Its live twin is the permission chip, whose 500
   * weight belongs to a chip, not to body text.
   */
  font-size:13px; font-weight:400; line-height:20px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  user-select:none; pointer-events:none;
  opacity:0; translate:0 3px;
  transition:opacity 320ms var(--dsh-htt-in-out),
             translate 220ms var(--dsh-htt-out);
}
.dsh-htt-hint[data-on]{
  opacity:1; translate:0 0;
}

/* ---- retained transcript ---------------------------------------------- */
.dsh-htt-pending{
  position:absolute; display:flex; align-items:center; gap:6px;
  box-sizing:border-box; height:26px; padding:0 9px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l2);
  box-shadow:var(--dsw-elevation-stroke);
  color:var(--dsw-alias-label-primary);
  font-size:13px; line-height:18px; letter-spacing:.01em;
  white-space:nowrap; cursor:pointer; user-select:none;
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out),
             scale var(--dsh-htt-t-press) var(--dsh-htt-out);
}
.dsh-htt-pending:active{scale:.96}
.dsh-htt-pending:focus-visible{
  outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
  outline-offset:3px;
}
@starting-style{.dsh-htt-pending{opacity:0; translate:0 4px}}
.dsh-htt-pending[data-leaving]{
  opacity:0; translate:0 3px; scale:.97;
  /* An invisible chip must stop being clickable, or a double-click inserts twice. */
  pointer-events:none;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}

/* ---- the recording bubble: a capsule that grows out of the composer ----- */
/*
 * Recording does not take the composer over. Apple's rule is "dim to focus, separate to
 * keep flow": a panel that runs *alongside* what you are doing uses translucency and
 * offset without a scrim, so the flow is never broken. So the bubble floats above the
 * card and the card itself is left alone — your draft stays readable and typeable for
 * the whole recording. That also retires the old failure mode where a full-bleed panel
 * turned its own exit into a 180 ms invisible shield over the editor.
 *
 * The bubble never accepts pointer events, so there is nothing here that can swallow a
 * click; the only thing the card shows is a hairline when a release would discard.
 */
.dsh-htt-bubble{
  position:absolute; bottom:calc(100% + 10px); left:0; right:0;
  display:flex; justify-content:center;
  transform-origin:bottom center;
  pointer-events:none;
  /* Fading an ancestor clips the child's backdrop until opacity reaches 1. */
  transition:scale var(--dsh-htt-t-base) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-bubble{scale:.96}}
.dsh-htt-bubble[data-leaving]{
  scale:.96;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}
.dsh-htt-pill{
  position:relative; box-sizing:border-box;
  display:flex; align-items:center; gap:10px;
  min-height:44px; max-width:calc(100% - 24px); padding:0 16px;
  border-radius:999px;
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  /* Pointer tracking is direct; the existing meter clock springs it home on release. */
  translate:0 var(--dsh-htt-lift,0px);
}
/* The host's own translucent-layer recipe, copied from MenuSurface.module.css. */
.dsh-htt-material{
  position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:var(--dsw-menu-surface-fill,var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2)));
  backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));
  -webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));
  border:1px solid var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-prominent),inset 0 1px 0 color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);
  opacity:1; transition:opacity var(--dsh-htt-t-exit) var(--dsh-htt-in-out);
}
.dsh-htt-bubble[data-leaving] .dsh-htt-material{opacity:0}
.dsh-htt-material::after{
  content:''; position:absolute; inset:0; border-radius:inherit;
  box-shadow:inset 0 0 16px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);
  opacity:var(--dsh-htt-energy,0); transition:opacity 80ms linear;
}
/*
 * The discard wash. One opacity number drives the whole red state — the pill's ring, its
 * tint and the card's hairline — so it is continuous and reversible, never a hard cut.
 */
.dsh-htt-alarm{
  position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  border:1px solid var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  opacity:var(--dsh-htt-cancel,0);
  transition:opacity 100ms linear;
}
/* The card's own outline, so the discard state is visible at the draft too. */
.dsh-htt-edge{
  position:absolute; inset:0; border-radius:var(--dsw-radius-panel);
  border:1px solid var(--dsw-alias-state-error-primary);
  pointer-events:none;
  opacity:var(--dsh-htt-cancel,0);
  transition:opacity 100ms linear;
}
.dsh-htt-body{
  position:relative; z-index:1;
  display:flex; align-items:center; gap:10px; min-width:0; max-width:100%;
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-body{opacity:0;translate:0 3px}}
.dsh-htt-bubble[data-leaving] .dsh-htt-body{opacity:0;translate:0 3px}

/* ---- state mark: a mic-is-live dot that becomes the discard cross ------ */
.dsh-htt-mark{position:relative; flex:0 0 auto; width:16px; height:16px; display:grid; place-items:center}
.dsh-htt-dot{
  position:absolute; inset:0; display:grid; place-items:center;
  opacity:calc(1 - var(--dsh-htt-cancel,0) * 1.6);
  transition:opacity 100ms linear;
}
.dsh-htt-dot-core{
  width:7px; height:7px; border-radius:50%;
  background:var(--dsw-alias-state-business-primary);
}
/* The halo follows real microphone energy, without an idle loop. */
.dsh-htt-mark[data-state=recording] .dsh-htt-dot::before{
  content:''; position:absolute; inset:1px; border-radius:50%;
  background:var(--dsw-alias-state-business-primary);
  opacity:calc(.08 + var(--dsh-htt-energy,0) * .2);
  scale:calc(1 + var(--dsh-htt-energy,0) * .55);
  transition:opacity 80ms linear, scale 80ms linear;
}
.dsh-htt-check{
  position:absolute; inset:0; display:grid; place-items:center;
  color:var(--dsw-alias-state-business-primary);
  opacity:0; scale:.7;
  transition:opacity 140ms var(--dsh-htt-out),scale 200ms var(--dsh-htt-out);
}
.dsh-htt-mark[data-state=complete] .dsh-htt-check{opacity:1;scale:1}
.dsh-htt-mark[data-state=complete] .dsh-htt-dot,
.dsh-htt-mark[data-state=complete] .dsh-htt-cross{opacity:0}
/*
 * While recording the waveform is the activity, so the dot only marks that the mic is
 * live and stays still. It earns an animation only once transcribing drains the
 * waveform, because then it is the only thing left that can say "still working".
 */
.dsh-htt-mark[data-state=transcribing] .dsh-htt-dot-core{
  background:var(--dsw-alias-label-tertiary);
  animation:dsh-htt-breathe 1.4s ease-in-out infinite alternate;
}
@keyframes dsh-htt-breathe{from{opacity:.35}to{opacity:1}}
.dsh-htt-cross{
  position:absolute; inset:0; display:grid; place-items:center;
  color:var(--dsw-alias-state-error-primary);
  opacity:calc(var(--dsh-htt-cancel,0) * var(--dsh-htt-cancel,0));
  scale:calc(.8 + var(--dsh-htt-cancel,0) * .2);
  transition:opacity 100ms linear, scale 100ms linear;
}

/* ---- level meter ------------------------------------------------------- */
.dsh-htt-slot{position:relative; flex:0 1 112px; width:112px; min-width:40px; height:22px}
.dsh-htt-wave{
  position:absolute; inset:0; display:block;
  color:var(--dsw-alias-state-business-primary);
  opacity:calc(1 - var(--dsh-htt-cancel,0) * .85);
  scale:calc(1 - var(--dsh-htt-cancel,0) * .16);
  transition:opacity 100ms linear, scale 100ms linear;
}
.dsh-htt-pill[data-phase=transcribing] .dsh-htt-wave{opacity:.28;scale:.94}
.dsh-htt-pill[data-phase=complete] .dsh-htt-wave{opacity:.2;scale:.9}
.dsh-htt-time{
  color:var(--dsw-alias-label-secondary); font-size:11px; line-height:18px;
  font-variant-numeric:tabular-nums; font-weight:400; flex:0 0 auto;
}

/* ---- one short label: text appears only where a mistake is possible ----- */
.dsh-htt-row{display:grid; align-items:center; min-width:0}
.dsh-htt-row > *{
  grid-area:1 / 1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  font-size:13px; line-height:18px; font-weight:500; letter-spacing:.01em;
  color:var(--dsw-alias-label-primary);
  opacity:0; translate:0 2px;
  transition:opacity 120ms var(--dsh-htt-out), translate 140ms var(--dsh-htt-out);
}
.dsh-htt-row > [data-on]{opacity:1; translate:0 0; transition-duration:var(--dsh-htt-t-base)}
.dsh-htt-row > [data-tone=error]{color:var(--dsw-alias-state-error-primary)}

/* ---- one-line notice --------------------------------------------------- */
.dsh-htt-notice{
  position:absolute; display:flex; align-items:center; gap:6px;
  box-sizing:border-box; height:26px; padding:0 10px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color:var(--dsw-alias-border-l1);
  box-shadow:var(--dsw-elevation-stroke);
  font-size:13px; line-height:18px;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; user-select:none;
  color:var(--dsw-alias-label-secondary);
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-notice{opacity:0; translate:0 5px}}
.dsh-htt-notice[data-leaving]{
  opacity:0; translate:0 3px;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}

/* ---- a failure waits for an answer ------------------------------------ */
/*
 * The notice flashes past because nothing is being asked of you. A failure is the opposite:
 * it stays until it is dismissed or retried, so it carries controls, stays legible if the
 * message is long, and announces itself assertively rather than politely.
 */
.dsh-htt-failure{
  position:absolute; display:flex; align-items:flex-start; gap:8px;
  box-sizing:border-box; padding:7px 9px;
  border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-2);
  --dsw-elevation-stroke-color:var(--dsw-alias-state-error-primary);
  box-shadow:var(--dsw-elevation-stroke);
  color:var(--dsw-alias-state-error-primary);
  font-size:13px; line-height:18px;
  pointer-events:auto;
  transition:opacity var(--dsh-htt-t-base) var(--dsh-htt-out),
             translate var(--dsh-htt-t-base) var(--dsh-htt-out);
}
@starting-style{.dsh-htt-failure{opacity:0; translate:0 5px}}
.dsh-htt-failure[data-leaving]{
  opacity:0; translate:0 3px;
  transition-duration:var(--dsh-htt-t-exit);
  transition-timing-function:var(--dsh-htt-in-out);
}
.dsh-htt-failure-text{
  flex:1 1 auto; min-width:0; display:-webkit-box;
  -webkit-line-clamp:2; line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;
}
.dsh-htt-action{
  flex:0 0 auto; box-sizing:border-box; height:22px; padding:0 8px;
  border:1px solid currentColor; border-radius:6px; background:transparent;
  color:inherit; font:inherit; font-size:12px; line-height:20px; cursor:pointer;
  transition:background-color var(--dsh-htt-t-press) var(--dsh-htt-out),
             scale var(--dsh-htt-t-press) var(--dsh-htt-out);
}
.dsh-htt-action:hover{background:color-mix(in srgb, currentColor 12%, transparent)}
.dsh-htt-action:active{scale:.96}
.dsh-htt-action:focus-visible{
  /* The host's own ring, so its pointer-modality suppression still wins. */
  outline-style:solid; outline-width:2px; outline-offset:2px;
  outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
}
.dsh-htt-action-icon{width:22px; padding:0; display:grid; place-items:center}

@media (prefers-reduced-motion:reduce){
  /* Gentler, not none: opacity and colour stay, movement goes. */
  .dsh-htt-pending,.dsh-htt-notice,.dsh-htt-row > *,.dsh-htt-body{
    translate:none!important; scale:none!important;
    transition:opacity 140ms linear!important;
  }
  .dsh-htt-hint{translate:none!important;transition:opacity 320ms var(--dsh-htt-in-out)!important}
  .dsh-htt-bubble{scale:none!important}
  .dsh-htt-pill{translate:none!important}
  .dsh-htt-wave,.dsh-htt-cross,.dsh-htt-check,
  .dsh-htt-dot::before{scale:none!important; transition:opacity 140ms linear}
  .dsh-htt-mark[data-state=transcribing] .dsh-htt-dot-core{animation:none; opacity:.7}
  .dsh-htt-ring,.dsh-htt-ring-arc{transition-duration:1ms!important}
  @starting-style{.dsh-htt-bubble{scale:none}}
}
/*
 * The same softening as the prefers-reduced-motion query above, but chosen rather than
 * signalled. The duplication is deliberate: one is an operating-system preference and the
 * other is a setting, and CSS cannot share a declaration list across a media boundary.
 */
.dsh-htt-layer[data-motion=calm] .dsh-htt-pending,
.dsh-htt-layer[data-motion=calm] .dsh-htt-notice,
.dsh-htt-layer[data-motion=calm] .dsh-htt-row > *,
.dsh-htt-layer[data-motion=calm] .dsh-htt-body{
  translate:none!important; scale:none!important;
  transition:opacity 140ms linear!important;
}
.dsh-htt-layer[data-motion=calm] .dsh-htt-hint{translate:none!important;transition:opacity 320ms var(--dsh-htt-in-out)!important}
.dsh-htt-layer[data-motion=calm] .dsh-htt-bubble{scale:none!important}
.dsh-htt-layer[data-motion=calm] .dsh-htt-pill{translate:none!important}
.dsh-htt-layer[data-motion=calm] .dsh-htt-wave,
.dsh-htt-layer[data-motion=calm] .dsh-htt-cross,
.dsh-htt-layer[data-motion=calm] .dsh-htt-check,
.dsh-htt-layer[data-motion=calm] .dsh-htt-dot::before{scale:none!important; transition:opacity 140ms linear}
.dsh-htt-layer[data-motion=calm] .dsh-htt-mark[data-state=transcribing] .dsh-htt-dot-core{animation:none; opacity:.7}
.dsh-htt-layer[data-motion=calm] .dsh-htt-ring,
.dsh-htt-layer[data-motion=calm] .dsh-htt-ring-arc{transition-duration:1ms!important}

/* A media query list, because the two preferences ask for the same opaque surface. */
@media (prefers-reduced-transparency:reduce), (prefers-contrast:more){
  .dsh-htt-material{
    background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-2));
    backdrop-filter:none; -webkit-backdrop-filter:none;
  }
}
@media (prefers-contrast:more){
  .dsh-htt-pill{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3)}
  .dsh-htt-material::after{display:none}
}
`;

		const layerStyle = (height) => ({
			position: 'absolute',
			top: 0,
			left: 0,
			right: 0,
			height,
			pointerEvents: 'none',
		});

		/**
		 * The notice and the retained-transcript chip share a seat: just above the tool row,
		 * right-aligned. Both are opaque chips, so covering part of the draft is a deliberate
		 * interruption rather than a legibility problem.
		 *
		 * The *hint* is bare text and is deliberately not here — it is parked in the tool
		 * row's empty middle so it can never land on the user's own writing.
		 */
		const cornerStyle = (rowHeight) => ({
			position: 'absolute',
			right: '14px',
			bottom: `${rowHeight + 6}px`,
			maxWidth: '76%',
		});

		/**
		 * `hintRight` and `hintMax` come from `measure()`: the hint's right edge is aimed at
		 * the gap in front of the tool row's trailing group, and `hintMax` is that gap. When
		 * the row is too narrow for the whole line it truncates rather than overlapping a
		 * control, and below 48 px of room it is not rendered at all.
		 *
		 * Vertically it is centred on the trailing group's own box rather than on the row, so
		 * it lines up with the model selector beside it whatever the row's padding happens to be.
		 */
		const hintStyle = (box) => ({
			right: `${box.hintRight}px`,
			...(box.hintCentre === null || box.hintCentre === undefined
				? { bottom: `${Math.max(4, (box.rowHeight - HINT_HEIGHT) / 2)}px` }
				: { top: `${box.hintCentre - HINT_HEIGHT / 2}px` }),
			maxWidth: `${box.hintMax}px`,
		});

		const pendingStyle = (box) => ({ ...cornerStyle(box.rowHeight), pointerEvents: 'auto' });

		const noticeStyle = (box) => cornerStyle(box.rowHeight);

		/**
		 * The host's microphone, reproduced glyph-for-glyph.
		 *
		 * This is `IconMicrophoneOutlineRegular` from `@deepseek-ai/dsh-client-ui-primitives`: a
		 * stroked capsule and an arc — `fill: none`, `stroke: currentColor`, 1px in a 16×16 box.
		 * It replaces an earlier hand-drawn mic that was *filled* rather than stroked, which is
		 * why it never quite matched the one sitting three centimetres to its right in the same
		 * tool row.
		 *
		 * The capsule's geometry is expressed in terms of the stroke width, so the numbers look
		 * odd on purpose. Copying the resolved 5 / 1.5 / 6 / 9 / 3 without the formula would be
		 * correct at 1px and wrong at any other weight.
		 */
		function MicGlyph({ size = 16, strokeWidth = 1 }) {
			const capsule = 7 - strokeWidth;
			return h(
				'svg',
				{
					width: size, height: size, viewBox: '0 0 16 16',
					fill: 'none', stroke: 'currentColor', strokeWidth,
					'aria-hidden': true, style: { flex: '0 0 auto', display: 'block' },
				},
				h('rect', {
					x: 4.5 + strokeWidth / 2,
					y: 1 + strokeWidth / 2,
					width: capsule,
					height: 10 - strokeWidth,
					rx: capsule / 2,
				}),
				h('path', {
					d: 'M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15',
				}),
			);
		}

		/** Circle-and-cross, shown once releasing would discard the recording. */
		function DiscardGlyph({ size = 13 }) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true, style: { flex: '0 0 auto' } },
				h('path', {
					d: 'M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					fill: 'none',
				}),
			);
		}

		/** A small mark that tells the three notice tones apart at a glance. */
		function NoticeGlyph({ tone }) {
			const common = {
				width: 13,
				height: 13,
				viewBox: '0 0 16 16',
				'aria-hidden': true,
				style: { flex: '0 0 auto' },
			};
			if (tone === 'error') {
				return h(
					'svg',
					common,
					h('path', {
						d: 'M8 2.2 14.4 13.4H1.6Z',
						fill: 'none',
						stroke: 'currentColor',
						strokeWidth: 1.4,
						strokeLinejoin: 'round',
					}),
					h('path', {
						d: 'M8 6.1v3.1M8 11.2v.1',
						stroke: 'currentColor',
						strokeWidth: 1.4,
						strokeLinecap: 'round',
					}),
				);
			}
			if (tone === 'muted') {
				return h(
					'svg',
					common,
					h('circle', { cx: 8, cy: 8, r: 6.1, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
					h('path', { d: 'M4.1 11.9 11.9 4.1', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
				);
			}
			return h(
				'svg',
				common,
				h('path', {
					d: 'M3.4 8.4 6.5 11.5 12.6 5.2',
					fill: 'none',
					stroke: 'currentColor',
					strokeWidth: 1.6,
					strokeLinecap: 'round',
					strokeLinejoin: 'round',
				}),
			);
		}

		//#endregion

		//#region settings page

		/**
		 * The page Settings → Plugins opens for this bundle.
		 *
		 * The Host offers `plugins.bundle.config` and a form primitive library, but that library
		 * renders text inputs only — no switch, no select, no stepper. Rather than pull a
		 * `@deepseek-ai/dsh-*` runtime dependency in for the skin (a wrong peer range makes DSH
		 * skip the whole bundle, silently), the controls are built here out of the same theme
		 * tokens everything else uses. They look native because the tokens are native.
		 */
		const SETTINGS_STYLES = `
.dsh-htt-set{display:flex; flex-direction:column; gap:2px; font-size:13px; line-height:18px; color:var(--dsw-alias-label-primary)}
.dsh-htt-set-intro{color:var(--dsw-alias-label-secondary); padding:0 2px 10px}
.dsh-htt-set-row{display:flex; align-items:flex-start; gap:16px; padding:10px 2px; border-top:1px solid var(--dsw-alias-border-l1)}
.dsh-htt-set-text{display:flex; flex-direction:column; gap:1px; flex:1 1 auto; min-width:0}
.dsh-htt-set-label{font-weight:500}
.dsh-htt-set-hint{color:var(--dsw-alias-label-secondary); font-size:12px; line-height:17px}
.dsh-htt-set-control{flex:0 0 auto; display:flex; align-items:center; gap:6px; padding-top:1px}
.dsh-htt-set-number{
  box-sizing:border-box; width:76px; height:28px; padding:0 8px;
  border:1px solid var(--dsw-alias-border-l2); border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-1); color:inherit; font:inherit; text-align:right;
}
.dsh-htt-set-group{
  display:flex; gap:2px; padding:2px;
  border:1px solid var(--dsw-alias-border-l1); border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-1);
}
.dsh-htt-set-segment, .dsh-htt-set-toggle, .dsh-htt-set-reset{
  box-sizing:border-box; height:24px; padding:0 10px;
  border:1px solid transparent; border-radius:6px; background:transparent;
  color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; line-height:22px; cursor:pointer;
  transition:background-color var(--dsh-htt-t-press,140ms) linear, color var(--dsh-htt-t-press,140ms) linear;
}
.dsh-htt-set-segment:hover, .dsh-htt-set-toggle:hover, .dsh-htt-set-reset:hover{
  background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary);
}
.dsh-htt-set-segment[data-on], .dsh-htt-set-toggle[data-on]{
  background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2); font-weight:500;
}
.dsh-htt-set-reset{height:28px; line-height:26px}
.dsh-htt-set-number:focus-visible, .dsh-htt-set-segment:focus-visible,
.dsh-htt-set-toggle:focus-visible, .dsh-htt-set-reset:focus-visible{
  outline-style:solid; outline-width:2px; outline-offset:2px;
  outline-color:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));
}
`;

		/** One labelled row: what it is and why, on the left; the control on the right. */
		function SettingsPage(props) {
			const [values, setValues] = React.useState(() => config.all());
			React.useEffect(() => config.subscribe(() => setValues(config.all())), []);
			const t = (key) => translate(props, key);

			const row = (key, label, hint, control) =>
				h(
					'div',
					{ className: 'dsh-htt-set-row', key, 'data-setting': key },
					h(
						'div',
						{ className: 'dsh-htt-set-text' },
						h('span', { className: 'dsh-htt-set-label' }, label),
						h('span', { className: 'dsh-htt-set-hint' }, hint),
					),
					h('div', { className: 'dsh-htt-set-control' }, control),
				);

			/**
			 * A number field and its row, with both strings derived from the field's own name.
			 *
			 * Deriving them is what keeps the schema and the dictionary from drifting — but it
			 * only works if the derivation matches how the keys are actually spelled. It did not:
			 * this built `holdMsLabel` + `Hint`, while the dictionary says `holdMsHint`, and the
			 * settings page rendered the raw key as its own description until a screenshot of the
			 * real page caught it.
			 */
			const numberRow = (key) => {
				const field = CONFIG_FIELDS[key];
				const label = t(`${key}Label`);
				return row(
					key,
					label,
					t(`${key}Hint`),
					h('input', {
						type: 'number',
						className: 'dsh-htt-set-number',
						min: field.min,
						max: field.max,
						step: field.step,
						value: values[key],
						'aria-label': label,
						onChange: (event) => config.set(key, event.target.value),
					}),
				);
			};

			return h(
				'div',
				{ className: 'dsh-htt-set' },
				h('style', null, SETTINGS_STYLES),
				h('div', { className: 'dsh-htt-set-intro' }, t('settingsIntro')),
				numberRow('holdMs'),
				numberRow('touchHoldMs'),
				row(
					'motion',
					t('motionLabel'),
					t('motionHint'),
					h(
						'div',
						{ className: 'dsh-htt-set-group', role: 'radiogroup', 'aria-label': t('motionLabel') },
						CONFIG_FIELDS.motion.oneOf.map((option) =>
							h(
								'button',
								{
									type: 'button',
									key: option,
									className: 'dsh-htt-set-segment',
									role: 'radio',
									'aria-checked': values.motion === option ? 'true' : 'false',
									'data-on': values.motion === option ? '' : undefined,
									onClick: () => config.set('motion', option),
								},
								t(option === 'full' ? 'motionFull' : 'motionCalm'),
							),
						),
					),
				),
				row(
					'hint',
					t('hintLabel'),
					t('hintHint'),
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-htt-set-toggle',
							'aria-pressed': values.hint ? 'true' : 'false',
							'data-on': values.hint ? '' : undefined,
							onClick: () => config.set('hint', !values.hint),
						},
						t(values.hint ? 'switchOn' : 'switchOff'),
					),
				),
				row(
					'language',
					t('languageLabel'),
					t('languageHint'),
					h(
						'div',
						{ className: 'dsh-htt-set-group', role: 'radiogroup', 'aria-label': t('languageLabel') },
						CONFIG_FIELDS.language.oneOf.map((option) =>
							h(
								'button',
								{
									type: 'button',
									key: option,
									className: 'dsh-htt-set-segment',
									role: 'radio',
									'aria-checked': values.language === option ? 'true' : 'false',
									'data-on': values.language === option ? '' : undefined,
									onClick: () => config.set('language', option),
								},
								t(LANGUAGE_LABELS[option]),
							),
						),
					),
				),
				row(
					'live', t('liveLabel'), t('liveHint'),
					h('button', {
						type: 'button', className: 'dsh-htt-set-toggle',
						'aria-pressed': values.live ? 'true' : 'false',
						'data-on': values.live ? '' : undefined,
						onClick: () => config.set('live', !values.live),
					}, t(values.live ? 'switchOn' : 'switchOff')),
				),
				row(
					'chord',
					t('chordLabel'),
					t('chordHint'),
					h(
						'div',
						{ className: 'dsh-htt-set-group', role: 'radiogroup', 'aria-label': t('chordLabel') },
						CONFIG_FIELDS.chord.oneOf.map((option) =>
							h(
								'button',
								{
									type: 'button',
									key: option,
									className: 'dsh-htt-set-segment',
									role: 'radio',
									'aria-checked': values.chord === option ? 'true' : 'false',
									'data-on': values.chord === option ? '' : undefined,
									onClick: () => config.set('chord', option),
								},
								option === 'off' ? t('chordOff') : CHORDS[option].label,
							),
						),
					),
				),
				h(
					'div',
					{ className: 'dsh-htt-set-row' },
					h('div', { className: 'dsh-htt-set-text' }, h('span', { className: 'dsh-htt-set-hint' }, t('settingsLocal'))),
					h(
						'div',
						{ className: 'dsh-htt-set-control' },
						h(
							'button',
							{ type: 'button', className: 'dsh-htt-set-reset', onClick: () => config.reset() },
							t('settingsReset'),
						),
					),
				),
			);
		}

		//#endregion


		//#region component

		/** Replace only this recording's plain-text range, guarded by the Host revision. */
		function createLiveDraft(actions, span, getInput) {
			const input = getInput();
			if (!input || typeof input.draft !== 'string' || input.draftRev !== span.draftRev
				|| !Array.isArray(input.occurrences) || input.occurrences.length > 0
				|| span.start < 0 || span.end > input.draft.length) return null;
			const original = input.draft.slice(span.start, span.end);
			let range = { ...span }, text = original, changed = false, conflict = false;
			const write = (value) => {
				if (conflict) return false;
				if (actions.captureInsertion().draftRev !== range.draftRev) { conflict = true; return false; }
				const clean = value.replace(/[\uE100-\uE11D\uFFFC]/gu, '');
				if (text === clean) return true;
				if (actions.insertText(clean, range) !== true) { conflict = true; return false; }
				range = { start: span.start, end: span.start + clean.length, draftRev: actions.captureInsertion().draftRev };
				text = clean; changed = true;
				return true;
			};
			return { write, rollback() {
				if (!changed) return true;
				const current = getInput();
				const fresh = actions.captureInsertion();
				if (fresh.draftRev !== range.draftRev) {
					// Edits outside an unchanged owned range need not prevent cancellation.
					if (!current || current.draftRev !== fresh.draftRev || !Array.isArray(current.occurrences)
						|| current.occurrences.length > 0 || typeof current.draft !== 'string'
						|| current.draft.slice(0, range.start) !== input.draft.slice(0, range.start)
						|| current.draft.slice(range.start, range.end) !== text) return false;
					range = { ...range, draftRev: fresh.draftRev };
				}
				conflict = false;
				return write(original);
			} };
		}

		/**
		 * The language hint to send, or undefined to let the Host decide for itself.
		 *
		 * A provider rejects a language it does not advertise outright — the call fails rather than
		 * falling back — so the chosen value is filtered against what the selected provider lists.
		 * A fixed language also skips the Host's own detection pass, which measured about 2.5x the
		 * inference cost of a fixed one against the shipped local recognizer.
		 */
		function transcribeLanguage() {
			const chosen = config.get('language');
			if (chosen === 'host') return undefined;
			const provider = selectedProvider();
			return provider?.languages?.includes(chosen) ? chosen : undefined;
		}

		/** One transcribe request body, carrying the language hint the selected provider can take. */
		function transcribeRequest(audio) {
			const language = transcribeLanguage();
			const audioBase64 = toBase64(audio.buffer);
			return language === undefined ? { audioBase64 } : { audioBase64, language };
		}

		/** Prefer the entry's injected `transcribe`; fall back to the Remote captured at activation. */
		function resolveTranscribe(props) {
			if (typeof props.transcribe === 'function') return props.transcribe;
			if (runtime.speech === null) return undefined;
			return (request, signal) => runtime.speech.transcribe(request, signal);
		}

		const IDLE = {
			phase: 'idle', notice: '', tone: 'info', leaving: false, cancelled: false, pending: '',
			pendingLeaving: false, bubbleLeaving: false, arm: null, armLeaving: false, retryable: false, elapsed: 0,
		};
		/** Completion remains visible briefly, but never blocks another recording. */
		const BUBBLE_PHASES = new Set(['recording', 'transcribing', 'complete']);
		/** Below this much room in the tool row the hint is dropped rather than overlapped. */
		const HINT_MIN_PX = 48;
		/*
		 * The keyboard equivalent of the hold lives in the config region, because which chord it
		 * is has to be read from settings on every keystroke: the mouse needs a threshold to tell
		 * a hold from a click, but a three-key chord has no such ambiguity, so it starts on the
		 * keydown and ends on the keyup — hold-and-release, exactly like the pointer.
		 */

		function HoldToTalk(props) {
			const input = typeof props.useInput === 'function' ? props.useInput((snapshot) => snapshot) : null;
			const root = React.useRef(null);
			const wave = React.useRef(null);
			const commands = React.useRef({});
			const [hovered, setHovered] = React.useState(false);
			const [view, setView] = React.useState(IDLE);
			const [box, setBox] = React.useState({ height: 0, rowHeight: 0, hintRight: 14, hintMax: 0 });
			const latest = React.useRef(null);
			latest.current = { props, input, view, setHovered, setView };
			/*
			 * Settings are read through `config` at the moment they are needed, but the layer has
			 * to re-render when one changes: the motion preference and the ring's hold duration
			 * are CSS hooks, not values the effect can apply imperatively.
			 */
			const [settings, setSettings] = React.useState(() => config.all());
			React.useEffect(() => config.subscribe(() => setSettings(config.all())), []);
			// Notices live and die on timers owned by the setup effect below, so that the exit
			// animation can run before the element unmounts. A React effect cannot do this:
			// its dependency on `view` would restart the countdown the moment it re-renders.

			React.useEffect(() => {
				const node = root.current;
				if (node === null) return undefined;
				const card = node.closest('[data-composer-card]');
				if (card === null) {
					console.warn('dsh-hold-to-dictate: [data-composer-card] not found; the composer layout changed');
					return undefined;
				}

				/**
				 * Real boxes for a row's children.
				 *
				 * DSH renders slot wrappers as `div[data-slot]` with `display: contents`, and a
				 * `display: contents` element has an all-zero rect. When every direct child is
				 * one of those, the measurements have to come from one level deeper, where the
				 * actual groups live.
				 */
				const collectBoxes = (row) => {
					const boxes = (nodes) => Array.from(nodes)
						.map((child) => child.getBoundingClientRect())
						.filter((child) => child.width > 0);
					const direct = boxes(row.children);
					return direct.length > 0 ? direct : boxes(row.querySelectorAll(':scope > * > *'));
				};

				/**
				 * The card is `[overlayAnchor, (accessory), (attachments), DraftEditor, row]`, so
				 * its last element child is the tool row.
				 *
				 * The hint is aimed at that row's empty middle: the row is
				 * `justify-content: space-between`, with the trailing group last. The gap in front
				 * is where a hint can sit without covering a control or the user's own
				 * writing. When no such gap exists the hint is dropped rather than overlapped.
				 */
				const measure = () => {
					const rect = card.getBoundingClientRect();
					const row = card.lastElementChild;
					let rowHeight = 0;
					let hintRight = 14;
					let hintMax = 0;
					let hintCentre = null;
					if (row !== null) {
						const rowRect = row.getBoundingClientRect();
						rowHeight = rowRect.height;
						const boxes = collectBoxes(row);
						const trailing = boxes.at(-1);
						if (trailing !== undefined) {
							hintRight = Math.max(12, rect.right - trailing.left + 12);
							const leading = boxes.filter((child) => child.right <= trailing.left - 12).pop();
							const floor = leading === undefined ? rect.left + 12 : leading.right + 12;
							hintMax = Math.max(0, trailing.left - 12 - floor);
							/*
							 * Vertical alignment is measured off the control the hint sits beside,
							 * not off the row's box. The row is `padding: 2px 8px 6px` — asymmetric —
							 * so a box-centred hint lands 2 px lower than every control around it.
							 * That is small enough to read as "something is off" and too small to
							 * name, which is exactly the kind of thing that should be derived
							 * rather than guessed at.
							 */
							hintCentre = trailing.top + trailing.height / 2 - rect.top;
						}
					}
					setBox({ height: rect.height, rowHeight, hintRight, hintMax, hintCentre });
				};
				measure();
				const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
				if (observer !== null) observer.observe(card);
				window.addEventListener('resize', measure);

				const state = {
					liveDraft: null,
					liveTimer: 0,
					liveWait: LIVE_STARVE_RETRY_MS,
					liveInterval: LIVE_MIN_INTERVAL_MS,
					liveStarved: 0,
					liveSegmented: false,
					liveCommitted: '',
					liveAnchor: 0,
					liveAnchorAtPause: false,
					preview: null,
					timer: 0,
					limit: 0,
					noticeHold: 0,
					noticeExit: 0,
					bubbleExit: 0,
					pendingExit: 0,
					ringExit: 0,
					raf: 0,
					meter: 0,
					meterStop: 0,
					run: 0,
					active: false,
					busy: false,
					cancelled: false,
					keyboard: false,
					pointerId: null,
					touch: false,
					tolerance: ARM_TOLERANCE_PX,
					retry: null,
					level: 0,
					capture: null,
					starting: null,
					span: null,
					abort: null,
					x: 0,
					y: 0,
					samples: [],
					waveAt: -Infinity,
					waveLines: null,
					waveLevels: null,
					waveDraining: false,
					recordedAt: null,
					elapsed: 0,
					lift: { position: 0, velocity: 0 },
					motionAt: null,
				};

				const say = (key, params) => translate(latest.current.props, key, params);

				const clearTimeoutOf = (key) => {
					if (state[key] !== 0) {
						window.clearTimeout(state[key]);
						state[key] = 0;
					}
				};

				const clearNotice = () => {
					clearTimeoutOf('noticeHold');
					clearTimeoutOf('noticeExit');
				};

				const clearBubbleExit = () => clearTimeoutOf('bubbleExit');
				const clearPendingExit = () => clearTimeoutOf('pendingExit');

				/** Merge a patch without touching the notice or the bubble lifetime. */
				const patch = (values) => latest.current.setView((current) => ({ ...current, ...values }));

				/**
				 * Publish a phase change. Two surfaces get a two-stage lifetime so their exit
				 * can actually play before they unmount:
				 *
				 * - a notice holds for NOTICE_MS, dissolves for NOTICE_EXIT_MS, then clears;
				 * - the bubble survives one EXIT_MS after the last busy phase, so releasing the
				 *   button ends with the surface withdrawing rather than blinking out.
				 *
				 * Both are plain `data-leaving` flags driving CSS transitions, so a recording
				 * started during an exit simply retargets and the bubble comes back.
				 */
				const show = (patchValues) => {
					if (patchValues.phase !== undefined) {
						// A phase change replaces the previous notice's timers.
						clearNotice();
						clearBubbleExit();
						const leaving = BUBBLE_PHASES.has(latest.current.view.phase)
							&& !BUBBLE_PHASES.has(patchValues.phase);
						latest.current.setView((current) => ({
							...current,
							leaving: false,
							bubbleLeaving: leaving,
							...patchValues,
						}));
						if (leaving) {
							state.bubbleExit = window.setTimeout(() => {
								state.bubbleExit = 0;
								patch({ bubbleLeaving: false });
							}, EXIT_MS);
						}
					} else {
						latest.current.setView((current) => ({ ...current, leaving: false, ...patchValues }));
					}
					if (patchValues.phase === 'complete') {
						state.noticeHold = window.setTimeout(() => show({ phase: 'idle' }), COMPLETE_MS);
						return;
					}
					if (patchValues.phase !== 'notice') return;
					state.noticeHold = window.setTimeout(() => {
						state.noticeHold = 0;
						patch({ leaving: true });
						state.noticeExit = window.setTimeout(() => {
							state.noticeExit = 0;
							patch({ phase: 'idle', notice: '', leaving: false });
						}, NOTICE_EXIT_MS);
					}, NOTICE_MS);
				};

				/**
				 * Dismiss the retained transcript. It gets the same exit as everything else, so
				 * a successful insert ends by folding away instead of disappearing.
				 */
				const dropPending = () => {
					clearPendingExit();
					if (latest.current.view.pending === '') return;
					patch({ pendingLeaving: true });
					state.pendingExit = window.setTimeout(() => {
						state.pendingExit = 0;
						patch({ pending: '', pendingLeaving: false });
					}, EXIT_MS);
				};

				/** Retract the press ring, then unmount it once the fade has run. */
				const dropRing = () => {
					clearTimeoutOf('ringExit');
					if (latest.current.view.arm === null) return;
					patch({ armLeaving: true });
					state.ringExit = window.setTimeout(() => {
						state.ringExit = 0;
						patch({ arm: null, armLeaving: false });
					}, RING_EXIT_MS);
				};

				const failure = (error) => {
					const name = error instanceof Error ? error.name : '';
					if (name === 'NotAllowedError' || name === 'SecurityError') return say('permission');
					if (name === 'NotFoundError' || name === 'NotReadableError') return say('unavailable');
					return failureNotice(error instanceof Error ? error.message : String(error));
				};

				/** Turn a Host-side recognition error into a line the user can act on. */
				const failureNotice = (message) => {
					if (/prepare/i.test(message)) return say('notReady');
					return say('failed', { message });
				};

				/**
				 * Park a failure on screen instead of flashing it for 2.8 s.
				 *
				 * A notice is for something that has already resolved itself. A failure is
				 * something the user may want to act on, so it stays until it is dismissed or
				 * retried. `retry` carries what trying again needs — currently the encoded audio,
				 * when the failure happened after it was already captured.
				 */
				const fail = (message, retry) => {
					state.retry = retry ?? null;
					show({
						phase: 'failed',
						notice: message,
						tone: 'error',
						retryable: retry !== undefined && retry !== null,
						cancelled: false,
					});
				};

				const dismissFailure = () => {
					state.retry = null;
					show({ phase: 'idle', notice: '', cancelled: false });
				};

				/**
				 * Try the retained recording again. The Host hiccuped; the user should not have
				 * to say the same sentence twice.
				 */
				const retryFailure = () => {
					const pending = state.retry;
					if (pending === null || state.busy) return;
					state.retry = null;
					state.busy = true;
					void transmit(pending.audio, pending.span, state.run, pending.liveDraft);
				};

				const clearTimer = () => clearTimeoutOf('timer');
				const clearLimit = () => clearTimeoutOf('limit');

				/**
				 * The gesture's end. Trailing `touch` here rather than in `resetGesture` is
				 * deliberate: that one also runs when a recording *starts*, which is precisely
				 * when the touch flag still has work to do.
				 */
				const detach = () => {
					window.removeEventListener('pointermove', onMove, true);
					window.removeEventListener('pointerup', onUp, true);
					window.removeEventListener('pointercancel', onCancel, true);
					state.pointerId = null;
					state.touch = false;
				};

				/**
				 * Drag-to-discard is tracked as one continuous quantity.
				 *
				 * `--dsh-htt-cancel` (0..1) drives the red wash, the discard glyph and the
				 * meter's retreat, so the whole state is a single number the user is steering
				 * 1:1 rather than a boolean that flips. The boolean is still needed for the
				 * label, and it is hysteretic — armed at 48 px, disarmed at 38 px — because a
				 * pointer resting exactly on one threshold would otherwise flicker the bubble
				 * between its two faces.
				 */
				const applyCancel = (level) => {
					state.level = level;
					// Written on the layer so the bubble, the card's hairline and the meter all
					// read the same number without a re-render per pointermove.
					const element = root.current;
					if (element !== null) element.style.setProperty('--dsh-htt-cancel', level.toFixed(3));
				};

				const setCancelArmed = (armed) => {
					if (state.cancelled === armed) return;
					state.cancelled = armed;
					patch({ cancelled: armed });
				};

				const track = (event) => {
					const samples = state.samples;
					samples.push({ t: event.timeStamp, y: event.clientY });
					// Prune by time, not by count: the sample rate varies with the mouse, and a
					// fixed count would average a fast flick over a long, slow window.
					const cutoff = event.timeStamp - VELOCITY_WINDOW_MS * 2;
					while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
				};

				/** Pointer velocity in px/s over the last VELOCITY_WINDOW_MS; positive is down. */
				const velocity = () => {
					const samples = state.samples;
					if (samples.length < 2) return 0;
					const last = samples[samples.length - 1];
					let first = samples[0];
					for (const sample of samples) {
						if (last.t - sample.t <= VELOCITY_WINDOW_MS) {
							first = sample;
							break;
						}
					}
					const elapsed = last.t - first.t;
					return elapsed <= 0 ? 0 : ((last.y - first.y) / elapsed) * 1000;
				};

				/**
				 * Leaving the card counts as arming: the card is short, so an upward drag
				 * reaches its edge before it reaches the distance threshold, and a silent
				 * cancel there is exactly the wrong feedback. Everything here is reversible.
				 */
				const updateCancel = (event) => {
					const outside = !(event.target instanceof Node) || !card.contains(event.target);
					const upward = state.y - event.clientY;
					const threshold = state.cancelled ? CANCEL_RELEASE_PX : CANCEL_ARM_PX;
					setCancelArmed(outside || upward >= threshold);
					applyCancel(outside ? 1 : Math.max(0, Math.min(1, upward / CANCEL_ARM_PX)));
					// A soft 12px boundary keeps the capsule near its composer, even on a long drag.
					state.lift.position = -12 * upward / (Math.abs(upward) + CANCEL_ARM_PX);
					state.lift.velocity = velocity() * 12 * CANCEL_ARM_PX / (Math.abs(upward) + CANCEL_ARM_PX) ** 2;
					root.current?.style.setProperty('--dsh-htt-lift', `${state.lift.position.toFixed(3)}px`);
				};

				const resetGesture = () => {
					state.cancelled = false;
					state.level = 0;
					state.samples = [];
					const element = root.current;
					if (element !== null) element.style.setProperty('--dsh-htt-cancel', '0');
				};

				const cancel = (silent) => {
					clearTimeoutOf('liveTimer');
					const rolledBack = state.liveDraft?.rollback() !== false;
					state.liveDraft = null;
					clearTimer();
					clearLimit();
					detach();
					dropRing();
					const capture = state.capture;
					state.capture = null;
					state.starting = null;
					state.active = false;
					state.busy = false;
					state.keyboard = false;
					state.retry = null;
					state.span = null;
					state.run += 1;
					resetGesture();
					// Every other path stops the meter; without this one a cancel leaves the
					// rAF loop re-arming itself forever, since its token never changes.
					stopMeter(true);
					if (state.abort !== null) state.abort.abort();
					state.abort = null;
					if (capture !== null) capture.dispose();
					if (silent) show({ phase: 'idle', notice: '', cancelled: false });
					else show({ phase: 'notice', notice: say(rolledBack ? 'cancelled' : 'cancelledEdited'), tone: 'muted', cancelled: false });
				};

				/**
				 * The level meter, taken from the shipped voice-input waveform: a shift register
				 * of recent RMS samples redrawn at 20 fps.
				 *
				 * The register *is* the smoothing. Each tick pushes the previous value one bar
				 * along, so the trace scrolls and every bar carries history — which is what
				 * makes it read as a voice rather than as a bouncing equaliser. Nothing here
				 * touches layout: only two SVG attributes per line.
				 */
				const startMeter = (capture) => {
					// A previous drain may still be pending; its timer must not stop this run.
					clearTimeoutOf('meterStop');
					state.waveDraining = false;
					const token = ++state.meter;
					const tick = (now) => {
						if (state.meter !== token) return;
						state.raf = window.requestAnimationFrame(tick);
						if (state.motionAt !== null && !state.active) {
							state.lift = settleLift(state.lift.position, state.lift.velocity, Math.min(.05, (now - state.motionAt) / 1000));
							root.current?.style.setProperty('--dsh-htt-lift', `${state.lift.position.toFixed(3)}px`);
						}
						state.motionAt = now;
						if (now - state.waveAt < WAVE_INTERVAL_MS) return;
						state.waveAt = now;
						if (state.active && state.recordedAt !== null) {
							const elapsed = Math.floor((now - state.recordedAt) / 1000);
							if (elapsed !== state.elapsed) {
								state.elapsed = elapsed;
								patch({ elapsed });
							}
						}
						const svg = wave.current;
						if (svg === null) return;
						if (state.waveLines === null) {
							// Newest sample arrives at the right and history scrolls left, as upstream.
							state.waveLines = Array.from(svg.querySelectorAll('line')).reverse();
							state.waveLevels = state.waveLines.map(() => 0);
						}
						const lines = state.waveLines;
						const levels = state.waveLevels;
						const shifts = state.waveDraining ? WAVE_DRAIN_PER_TICK : 1;
						let next = state.waveDraining ? 0 : capture.level();
						root.current?.style.setProperty('--dsh-htt-energy', Math.min(1, next * WAVE_SAMPLE_GAIN).toFixed(3));
						for (let step = 0; step < shifts; step += 1) {
							for (let index = 0; index < levels.length; index += 1) {
								const previous = levels[index];
								levels[index] = next;
								next = previous;
							}
						}
						for (let index = 0; index < lines.length; index += 1) {
							const height = 1 + Math.min(1, levels[index] * WAVE_SAMPLE_GAIN) * WAVE_MAX_HEIGHT;
							lines[index].setAttribute('y1', String(20 - height));
							lines[index].setAttribute('y2', String(20 + height));
						}
					};
					state.raf = window.requestAnimationFrame(tick);
				};

				/**
				 * Stop metering. The trace is drained first so the bars fall away instead of
				 * vanishing with the bubble — the one piece of the recording that should linger.
				 */
				const stopMeter = (drain) => {
					clearTimeoutOf('meterStop');
					if (!drain) {
						state.meter += 1;
						return;
					}
					state.waveDraining = true;
					state.meterStop = window.setTimeout(() => {
						state.meterStop = 0;
						state.meter += 1;
						state.lift = { position: 0, velocity: 0 };
						root.current?.style.setProperty('--dsh-htt-lift', '0px');
					}, METER_SETTLE_MS);
				};

				async function begin() {
					const actions = latest.current.props.inputActions;
					// Two entry points can race for this — a hold that just crossed its threshold
					// and a chord — and one capture per gesture is the whole contract.
					//
					// Neither entry point can reach here while a recording is running, so bailing
					// out is always safe to clean up after: a hold that lands during a
					// transcription has already drawn its ring and attached the three window
					// listeners, and both of onUp's own paths give up on `!state.active`. Without
					// this the ring stays on screen for good and the listeners stay with it.
					if (actions === undefined || actions === null || state.active || state.busy) {
						clearTimer();
						detach();
						dropRing();
						return;
					}
					const run = ++state.run;
					// A hold that starts while a previous transcription is still in flight
					// abandons that request: the run check discards its result anyway, and
					// left running it would spend the provider call twice.
					if (state.abort !== null) state.abort.abort();
					state.active = true;
					state.busy = true;
					// A new recording supersedes any failure still on screen, and whatever it
					// was offering to retry.
					state.retry = null;
					state.span = actions.captureInsertion();
					state.preview = null;
					state.liveWait = LIVE_STARVE_RETRY_MS;
					state.liveInterval = LIVE_MIN_INTERVAL_MS;
					state.liveStarved = 0;
					state.liveSegmented = false;
					state.liveCommitted = '';
					state.liveAnchor = 0;
					state.liveAnchorAtPause = false;
					const provider = selectedProvider();
					state.liveDraft = config.get('live') && provider?.location === 'host-local'
						? createLiveDraft(actions, state.span, () => latest.current.input) : null;
					state.abort = new AbortController();
					resetGesture();
					const capture = createCapture(state.liveDraft !== null);
					state.capture = capture;
					state.waveLines = null;
					state.waveLevels = null;
					state.waveDraining = false;
					state.waveAt = -Infinity;
					state.recordedAt = null;
					state.elapsed = 0;
					state.motionAt = null;
					state.lift = { position: 0, velocity: 0 };
					root.current?.style.setProperty('--dsh-htt-lift', '0px');
					show({ phase: 'recording', notice: '', cancelled: false, elapsed: 0 });
					// The ring has done its job; the bubble takes the story from here.
					dropRing();

					// The Host caps recording length; stop on our own so a forgotten press cannot
					// grow the chunk buffer without bound and then be rejected on arrival.
					const limitSeconds = maxSeconds();
					state.limit = window.setTimeout(() => {
						state.limit = 0;
						if (state.active) void finish();
					}, limitSeconds * 1000);

					startMeter(capture);

					const starting = capture.start();
					state.starting = starting;
					try {
						await starting;
						if (run === state.run) {
							state.recordedAt = performance.now();
							if (state.active && state.liveDraft !== null) schedulePreview(capture, run);
						}
					} catch (error) {
						if (run !== state.run) return;
						stopMeter(false);
						capture.dispose();
						state.capture = null;
						state.starting = null;
						state.active = false;
						state.busy = false;
						fail(failure(error), null);
					}
				}

				/**
				 * One preview at a time, as fast as the Host actually answers.
				 *
				 * The Host exposes a single unary `transcribe`, so live dictation means re-sending the
				 * growing recording and replacing the provisional words. Its cost is almost entirely
				 * the Host's inference, which is linear in the audio: measured against the shipped
				 * worker at roughly 150 ms fixed plus ~0.15 s per audio second, so a 2-second prefix
				 * comes back in about 0.3 s and a 16-second one in about 1.2 s.
				 *
				 * None of that is ours to throttle. The wait is set so the interval between requests
				 * lands just above the round trip we just measured — the timer only starts once the
				 * reply arrives, so the interval is the wait *plus* that round trip, not the wait
				 * alone. A floor keeps a short recording from re-rendering text that has not grown;
				 * past it the recognizer sets its own pace, however long the take runs.
				 */
				function schedulePreview(capture, run) {
					const period = state.liveWait;
					state.liveTimer = window.setTimeout(() => {
						state.liveTimer = 0;
						if (run !== state.run || !state.active) return;
						const startedAt = performance.now();
						state.preview = (async () => {
							try {
								// Once a whole-take preview is expensive, stop re-reading the take: commit
								// at the last sentence-length pause and read forward from there. The
								// window only starts at a commit point, and a commit point is the middle
								// of a pause, so a segment never begins on a cut through a word. Until the
								// first commit the window is still the whole take, and a take with no
								// sentence-length pause never commits at all.
								const at = state.liveSegmented ? capture.checkpoint() : 0;
								const committing = state.liveSegmented && at > state.liveAnchor + LIVE_SEGMENT_MIN_SECONDS;
								const whole = !state.liveAnchorAtPause;
								const audio = await capture.snapshot(whole ? 0 : state.liveAnchor, committing ? at : null);
								if (run !== state.run || !state.active) return 'stop';
								// The first previews are deliberately early. The worklet holds nothing
								// until it has MIN_SECONDS, and waiting for that is a reason to come
								// back, not a reason to abandon the recording.
								if (!audio) return ++state.liveStarved > LIVE_STARVE_LIMIT ? 'stop' : 'wait';
								state.liveStarved = 0;
								if (audio.buffer.byteLength > maxBytes()) return 'stop';
								const transcribe = resolveTranscribe(latest.current.props);
								if (!transcribe) return 'stop';
								const result = await transcribe(transcribeRequest(audio), state.abort.signal);
								if (run !== state.run || !state.active) return 'stop';
								// A Host hiccup is not the end of live dictation: the words already on
								// screen stay, and the next snapshot tries again further out.
								if (result?.ok !== true) return 'failed';
								const text = result.value?.text ?? '';
								// An empty transcript for a prefix that already produced words is a
								// recognizer hiccup, never an instruction to erase what is on screen.
								if (text === '') return 'ok';
								if (committing) {
									// Everything up to the pause is frozen for the rest of the take; the
									// window's start moves there, so the next preview is short again. The
									// first commit still covers the whole take, so it replaces rather than
									// appends.
									state.liveCommitted = whole ? text : state.liveCommitted + text;
									state.liveAnchor = at;
									state.liveAnchorAtPause = true;
									return state.liveDraft.write(state.liveCommitted) ? 'ok' : 'stop';
								}
								// A window that still starts at zero carries the whole take, so its result is
								// the text; one that starts at a commit point carries only the new words.
								const rendered = whole ? text : state.liveCommitted + text;
								if (whole) { state.liveCommitted = text; state.liveAnchor = audio.to; }
								return state.liveDraft.write(rendered) ? 'ok' : 'stop';
							} catch (error) { return 'failed'; }
						})();
						void state.preview.then((outcome) => {
							// One request at a time; slow inference never builds a stale queue.
							if (outcome === 'stop' || run !== state.run || !state.active) return;
							const rtt = performance.now() - startedAt;
							// A take long enough for a preview to cost this much is the one worth
							// segmenting; shorter ones stay on the accurate whole-take path.
							if (!state.liveSegmented && rtt > LIVE_SEGMENT_AFTER_MS) state.liveSegmented = true;
							state.liveInterval = outcome === 'failed'
								? Math.min(LIVE_MAX_BACKOFF_MS, Math.max(LIVE_MIN_INTERVAL_MS, state.liveInterval * 2))
								: Math.max(LIVE_MIN_INTERVAL_MS, rtt * LIVE_INTERVAL_SLACK);
							state.liveWait = outcome === 'wait'
								? LIVE_STARVE_RETRY_MS
								: Math.max(0, state.liveInterval - rtt);
							schedulePreview(capture, run);
						});
					}, period);
				}

				async function finish() {
					const capture = state.capture;
					const abort = state.abort;
					const span = state.span;
					const starting = state.starting;
					const run = state.run;
					const liveDraft = state.liveDraft;
					const preview = state.preview;
					clearTimeoutOf('liveTimer');
					state.active = false;
					state.keyboard = false;
					state.capture = null;
					state.starting = null;
					state.span = null;
					clearTimer();
					clearLimit();
					detach();
					// The trace drains rather than stopping dead, and the red wash retracts.
					stopMeter(true);
					resetGesture();
					if (capture === null || abort === null) {
						state.busy = false;
						show({ phase: 'idle', notice: '', cancelled: false });
						return;
					}
					show({ phase: 'transcribing', notice: '', cancelled: false });
					try {
						await starting;
						if (run !== state.run) return;
						const audio = await capture.stop();
						if (run !== state.run) return;
						await preview;
						if (run !== state.run) return;
						if (audio.seconds < MIN_SECONDS) {
							// Saying nothing is the one outcome that used to be silent, and a
							// keyboard chord makes it easy to hit by accident.
							state.busy = false;
							show({ phase: 'notice', notice: say('tooShort'), tone: 'muted', cancelled: false });
							return;
						}
						const limitBytes = maxBytes();
						if (audio.buffer.byteLength > limitBytes) {
							state.busy = false;
							fail(say('tooLarge'), null);
							return;
						}
						await transmit(audio, span, run, liveDraft);
					} catch (error) {
						// A stale run's failure must stay invisible: the current run owns `busy`,
						// and clearing it here would break Esc for that run.
						if (run !== state.run) return;
						state.busy = false;
						fail(failure(error), null);
					} finally {
						capture.dispose();
					}
				}

				/**
				 * Send one encoded recording to the Host and place what comes back.
				 *
				 * Split out of `finish()` because it is also the whole of Retry: when the Host
				 * hiccups after the audio is already captured, re-sending it is far better than
				 * asking the user to say the same thing again. The audio is handed back on
				 * failure so the failure card can offer exactly that.
				 */
				async function transmit(audio, span, run, liveDraft = null) {
					const transcribe = resolveTranscribe(latest.current.props);
					if (typeof transcribe !== 'function') {
						state.busy = false;
						fail(say('unavailable'), null);
						return;
					}
					show({ phase: 'transcribing', notice: '', cancelled: false });
					if (state.abort !== null) state.abort.abort();
					const abort = new AbortController();
					state.abort = abort;
					try {
						// providerId is left out so the Host applies its own selection;
						// `transcribeRequest` attaches the chosen language only when the
						// selected provider advertises it.
						const result = await transcribe(transcribeRequest(audio), abort.signal);
						if (run !== state.run) return;
						state.busy = false;
						if (result === undefined || result.ok !== true) {
							fail(failureNotice(result?.error?.message ?? ''), { audio, span, liveDraft });
							return;
						}
						const transcript = result.value?.text ?? '';
						if (transcript === '') {
							liveDraft?.rollback();
							state.retry = null;
							show({ phase: 'notice', notice: say('empty'), tone: 'info', cancelled: false });
							return;
						}
						const actions = latest.current.props.inputActions;
						if (actions === undefined || (liveDraft ? liveDraft.write(transcript) : actions.insertText(transcript, span)) !== true) {
							// Keep the text: the draft moved on, so the user decides when to insert it.
							state.retry = null;
							show({ phase: 'idle', notice: '', pending: transcript });
							return;
						}
						state.retry = null;
						show({ phase: 'complete', notice: '', cancelled: false });
					} catch (error) {
						if (run !== state.run) return;
						state.busy = false;
						fail(failure(error), { audio, span, liveDraft });
					}
				}

				/**
				 * Insert a transcript that was retained after a draft conflict.
				 *
				 * The `pendingLeaving` guard is not redundant with the empty check: the chip is
				 * still mounted, and `pending` is only cleared once its exit finishes, so a
				 * second click inside that window would insert the same text twice.
				 */
				const insertPending = () => {
					const actions = latest.current.props.inputActions;
					const pending = latest.current.view.pending;
					if (actions === undefined || pending === '' || latest.current.view.pendingLeaving) return;
					if (actions.insertText(pending, actions.captureInsertion()) === true) {
						// The text just landed, so the chip folds away instead of blinking out.
						show({ phase: 'complete', notice: '' });
						dropPending();
						return;
					}
					show({ phase: 'notice', notice: say('conflict'), tone: 'info' });
				};

				function onPointerDown(event) {
					if (event.button !== 0) return;
					if (state.active || state.timer !== 0) return;
					// Plugin controls must not arm the card's capture-phase gesture.
					if (event.target instanceof Element && event.target.closest('.dsh-htt-pending, .dsh-htt-failure') !== null) return;
					if (latest.current.props.inputActions === undefined) return;
					/*
					 * A finger is a different instrument from a mouse. It rolls, so it needs more
					 * slop; and a long press on a touch screen is *also* how a word gets selected,
					 * so the threshold is longer — long enough that a deliberate hold is clearly
					 * deliberate. Both are settings rather than guesses.
					 */
					const touch = event.pointerType === 'touch' || event.pointerType === 'pen';
					state.touch = touch;
					/*
					 * The three window listeners below are shared by every pointer on the screen,
					 * so the gesture has to claim one and refuse the rest. Without this, a second
					 * finger or a trackpad's second key drives the discard threshold and decides
					 * whether this recording is kept or thrown away.
					 */
					state.pointerId = event.pointerId;
					state.tolerance = touch ? TOUCH_TOLERANCE_PX : ARM_TOLERANCE_PX;
					const holdMs = config.get(touch ? 'touchHoldMs' : 'holdMs');
					state.x = event.clientX;
					state.y = event.clientY;
					state.cancelled = false;
					state.level = 0;
					state.samples = [{ t: event.timeStamp, y: event.clientY }];
					/*
					 * Acknowledge the press on the frame it happens. The ring starts drawing at
					 * the point of contact over the configured hold, so those milliseconds stop
					 * being a dead zone — but it is deliberately faint, because the same gesture
					 * also begins a caret move or a text selection and must not disturb either.
					 */
					const rect = card.getBoundingClientRect();
					clearTimeoutOf('ringExit');
					patch({
						arm: { x: event.clientX - rect.left, y: event.clientY - rect.top, holdMs },
						armLeaving: false,
						cancelled: false,
					});
					state.timer = window.setTimeout(() => {
						state.timer = 0;
						void begin();
					}, holdMs);
					window.addEventListener('pointermove', onMove, true);
					window.addEventListener('pointerup', onUp, true);
					window.addEventListener('pointercancel', onCancel, true);
				}

				function onMove(event) {
					if (event.pointerId !== state.pointerId) return;
					if (state.active) {
						// Drag-to-discard tracks the pointer 1:1 and stays reversible: the
						// level it writes is what the bubble actually renders.
						track(event);
						updateCancel(event);
						return;
					}
					if (state.timer === 0) return;
					const travelled = Math.hypot(event.clientX - state.x, event.clientY - state.y);
					if (travelled > state.tolerance) {
						clearTimer();
						detach();
						// A click, a caret move or a selection: the arc drains from wherever
						// it had reached instead of restarting or snapping away.
						dropRing();
					}
				}

				function onUp(event) {
					if (event.pointerId !== state.pointerId) return;
					if (state.timer !== 0) {
						clearTimer();
						detach();
						dropRing();
						return;
					}
					if (!state.active) return;
					track(event);
					/*
					 * Velocity decides reverse-versus-commit before position does. A pointer that
					 * swung past the line and is already travelling back down means "keep it";
					 * one that is still climbing means "discard", even if it never quite reached
					 * the threshold.
					 */
					const speed = velocity();
					const discard = state.cancelled
						? speed < CANCEL_FLICK_PX_PER_S
						: speed <= -CANCEL_FLICK_PX_PER_S && state.level > 0.75;
					if (discard) cancel(false);
					else void finish();
				}

				function onCancel(event) {
					// Only the pointer that opened the gesture may close it: another finger
					// leaving the screen is not a reason to throw this recording away.
					if (event.pointerId !== state.pointerId) return;
					if (state.active) cancel(false);
					else {
						clearTimer();
						detach();
						dropRing();
					}
				}

				const onEnter = () => {
					measure();
					latest.current.setHovered(true);
					// Coming back onto the card forgives a discard that was only armed.
					if (state.active) {
						setCancelArmed(false);
						applyCancel(0);
					}
				};
				const onLeave = () => {
					latest.current.setHovered(false);
					// Arm rather than cancel: the user sees the red bubble and can still come
					// back. A recording that is merely transcribing must also be allowed to
					// land, which is why this only fires while a capture runs.
					if (state.active) {
						setCancelArmed(true);
						applyCancel(1);
					}
				};

				const onKeyDown = (event) => {
					if (event.key === 'Escape') {
						if (state.busy || state.timer !== 0) {
							event.preventDefault();
							event.stopPropagation();
							cancel(false);
							return;
						}
						// A failure waits for an answer, so Escape has to be one of them.
						if (latest.current.view.phase === 'failed') {
							event.preventDefault();
							event.stopPropagation();
							dismissFailure();
						}
						return;
					}
					if (!isChord(event)) return;
					// Swallow every repeat so holding the chord does not restart anything, but
					// never preventDefault unless this is genuinely the start of a recording.
					if (event.repeat) {
						event.preventDefault();
						return;
					}
					if (state.busy || state.active || state.timer !== 0) return;
					if (latest.current.props.inputActions === undefined) return;
					event.preventDefault();
					event.stopPropagation();
					state.keyboard = true;
					dropRing();
					void begin();
				};

				/**
				 * The chord ends when any of its three keys comes up, which is what makes
				 * "release to transcribe" and "release to discard" behave exactly as they do
				 * under the mouse.
				 */
				const onKeyUp = (event) => {
					if (!state.keyboard) return;
					if (!isChordKey(event)) return;
					event.preventDefault();
					state.keyboard = false;
					if (state.active) {
						if (state.cancelled) cancel(false);
						else void finish();
					}
				};

				const onVisibility = () => {
					if (document.hidden && (state.active || state.timer !== 0)) cancel(true);
				};

				/** Losing the window mid-capture abandons the recording, as the shipped plugin does. */
				const onBlur = () => {
					if (state.active) cancel(true);
				};

				/*
				 * A touch long press is also how a browser begins selecting a word, and how the
				 * desktop shell raises its native context menu — and the composer does nothing to
				 * stop either. While a *touch* gesture is armed or recording, both are the last
				 * thing that should happen.
				 *
				 * Scoped to touch on purpose: suppressing `selectstart` for the mouse would break
				 * dragging out a selection, which shares this very card.
				 */
				const onSuppress = (event) => {
					if (!state.touch) return;
					if (state.timer === 0 && !state.active) return;
					event.preventDefault();
				};

				card.addEventListener('pointerdown', onPointerDown, true);
				card.addEventListener('pointerenter', onEnter);
				card.addEventListener('pointerleave', onLeave);
				latest.current.setHovered(card.matches(':hover'));
				document.addEventListener('keydown', onKeyDown, true);
				document.addEventListener('keyup', onKeyUp, true);
				document.addEventListener('contextmenu', onSuppress, true);
				document.addEventListener('selectstart', onSuppress, true);
				document.addEventListener('visibilitychange', onVisibility);
				window.addEventListener('blur', onBlur);
				// Rendered buttons use the same effect-owned commands as the gesture listeners.
				commands.current = { insertPending, retryFailure, dismissFailure };

				return () => {
					commands.current = {};
					card.removeEventListener('pointerdown', onPointerDown, true);
					card.removeEventListener('pointerenter', onEnter);
					card.removeEventListener('pointerleave', onLeave);
					document.removeEventListener('keydown', onKeyDown, true);
					document.removeEventListener('keyup', onKeyUp, true);
					document.removeEventListener('contextmenu', onSuppress, true);
					document.removeEventListener('selectstart', onSuppress, true);
					document.removeEventListener('visibilitychange', onVisibility);
					window.removeEventListener('blur', onBlur);
					window.removeEventListener('resize', measure);
					if (observer !== null) observer.disconnect();
					clearTimer();
					clearLimit();
					clearNotice();
					clearTimeoutOf('liveTimer');
					if (state.active || state.busy) state.liveDraft?.rollback();
					clearBubbleExit();
					clearPendingExit();
					clearTimeoutOf('ringExit');
					clearTimeoutOf('meterStop');
					stopMeter(false);
					if (state.raf !== 0) {
						window.cancelAnimationFrame(state.raf);
						state.raf = 0;
					}
					detach();
					state.keyboard = false;
					state.retry = null;
					state.run += 1;
					if (state.abort !== null) state.abort.abort();
					if (state.capture !== null) state.capture.dispose();
				};
			}, []);

			// Derived render state. `pending` survives notices so a rejected transcript is
			// never lost; the chip is the only affordance that can still insert it.
			const pending = view.pending;
			const recording = view.phase === 'recording';
			const completed = view.phase === 'complete';
			const busy = recording || view.phase === 'transcribing';
			const cancelled = recording && view.cancelled;
			// The hint is shown only when the tool row genuinely has room for it.
			const showHint = hovered && view.phase === 'idle' && pending === ''
				&& config.get('hint') && box.hintMax >= HINT_MIN_PX;
			const showPending = !busy && pending !== '';
			const showBubble = busy || completed || view.bubbleLeaving;

			/**
			 * Every variant of the label lives in the same grid cell, so the pill is always as
			 * wide as the widest one and swapping copy never reflows it. Visibility is a
			 * transition on `data-on`, so a quick back-and-forth over the discard threshold
			 * retargets instead of replaying.
			 */
			const labelRow = (variants) =>
				h(
					'span',
					{ className: 'dsh-htt-row' },
					variants.map((variant) =>
						h(
							'span',
							{
								key: variant.key,
								'data-on': variant.on ? '' : undefined,
								'data-tone': variant.tone,
							},
							variant.text,
						),
					),
				);

			return h(
				'div',
				{
					ref: root,
					className: 'dsh-htt-layer',
					'data-motion': settings.motion,
					// The ring draws over the hold this press actually uses — a finger waits longer
					// than a mouse, and the arc has to finish exactly when recording begins.
					style: {
						...layerStyle(box.height),
						'--dsh-htt-hold': `${view.arm === null ? settings.holdMs : view.arm.holdMs}ms`,
					},
				},
				h('style', null, STYLES),
				view.arm !== null &&
					h(
						'span',
						{
							className: 'dsh-htt-ring',
							'data-leaving': view.armLeaving ? '' : undefined,
							style: { left: `${view.arm.x}px`, top: `${view.arm.y}px` },
							'aria-hidden': true,
						},
						h(
							'svg',
							{ width: 36, height: 36, viewBox: '0 0 36 36' },
							h('circle', {
								className: 'dsh-htt-ring-track',
								cx: 18, cy: 18, r: RING_RADIUS,
								fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
							}),
							h('circle', {
								className: 'dsh-htt-ring-arc',
								cx: 18, cy: 18, r: RING_RADIUS,
								fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
							}),
						),
					),
				h(
					'div',
					{
						className: 'dsh-htt-hint',
						'data-on': showHint ? '' : undefined,
						style: hintStyle(box),
						'aria-hidden': true,
					},
					h(MicGlyph, { size: 16 }),
					h('span', null, translate(props, 'hint')),
				),
				showPending &&
					h(
						'button',
						{
							type: 'button',
							className: 'dsh-htt-pending',
							'data-leaving': view.pendingLeaving ? '' : undefined,
							style: pendingStyle(box),
							title: translate(props, 'pendingHint'),
							'aria-label': translate(props, 'pendingHint'),
							onPointerDown: (event) => event.stopPropagation(),
							// Keep the caret where it was: the insert reads the editor's own selection.
							onMouseDown: (event) => event.preventDefault(),
							onClick: () => commands.current.insertPending?.(),
						},
						h(MicGlyph, { size: 14 }),
						h('span', null, translate(props, 'pending')),
					),
				// The card's own outline, so a pending discard is visible where you are looking.
				h('span', { className: 'dsh-htt-edge', 'aria-hidden': true }),
				showBubble &&
					h(
						'div',
						{ className: 'dsh-htt-bubble', 'data-leaving': view.bubbleLeaving ? '' : undefined },
						h(
							'div',
							{
								className: 'dsh-htt-pill',
								'data-phase': view.phase,
								role: 'status',
								'aria-live': 'polite',
								'aria-label': recording
									? cancelled
										? `${translate(props, 'cancelReady')} · ${translate(props, 'cancelReadyHint')}`
										: `${translate(props, 'release')} · ${translate(props, 'cancelHint')}`
									: translate(props, completed ? 'complete' : 'transcribing'),
							},
							h('span', { className: 'dsh-htt-material', 'aria-hidden': true }),
							h('span', { className: 'dsh-htt-alarm', 'aria-hidden': true }),
							h(
								'div',
								{ className: 'dsh-htt-body' },
								h(
									'span',
									{
										className: 'dsh-htt-mark',
										'data-state': completed ? 'complete' : recording ? 'recording' : 'transcribing',
										'aria-hidden': true,
									},
									h('span', { className: 'dsh-htt-dot' }, h('span', { className: 'dsh-htt-dot-core' })),
									h('span', { className: 'dsh-htt-cross' }, h(DiscardGlyph, { size: 10 })),
									h('span', { className: 'dsh-htt-check' }, h(NoticeGlyph, { tone: 'success' })),
								),
								h(
									'span',
									{ className: 'dsh-htt-slot', 'aria-hidden': true },
									h(
										'svg',
										{
											ref: wave,
											className: 'dsh-htt-wave',
											viewBox: `0 0 ${WAVE_BARS * 8} 40`,
											preserveAspectRatio: 'none',
										},
										Array.from({ length: WAVE_BARS }, (_, index) =>
											h('line', {
												key: index,
												x1: index * 8 + 4,
												x2: index * 8 + 4,
												y1: 19,
												y2: 21,
												stroke: 'currentColor',
												strokeWidth: 3,
												strokeLinecap: 'round',
												opacity: 0.25 + index / (WAVE_BARS * 1.5),
											}),
										),
									),
								),
								labelRow([
									{ key: 'transcribe', on: !recording && !completed, text: translate(props, 'transcribing') },
									{ key: 'complete', on: completed, text: translate(props, 'complete') },
									{ key: 'release', on: recording && !cancelled, text: translate(props, 'release') },
									{
										key: 'cancel',
										on: cancelled,
										text: translate(props, 'cancelReady'),
										tone: 'error',
									},
								]),
								h('span', { className: 'dsh-htt-time', 'aria-hidden': true },
									`${String(Math.floor(view.elapsed / 60)).padStart(2, '0')}:${String(view.elapsed % 60).padStart(2, '0')}`),
							),
						),
					),
				view.phase === 'notice' &&
					h(
						'div',
						{
							className: 'dsh-htt-notice',
							'data-tone': view.tone,
							'data-leaving': view.leaving ? '' : undefined,
							style: noticeStyle(box),
							role: 'status',
						},
						h(NoticeGlyph, { tone: view.tone }),
						h('span', null, view.notice),
					),
				view.phase === 'failed' &&
					h(
						'div',
						{
							className: 'dsh-htt-failure',
							style: noticeStyle(box),
							// assertive, not polite: this one is waiting for the user.
							role: 'alert',
						},
						h(NoticeGlyph, { tone: 'error' }),
						h('span', { className: 'dsh-htt-failure-text', title: view.notice }, view.notice),
						view.retryable &&
							h(
								'button',
								{
									type: 'button',
									className: 'dsh-htt-action',
									onPointerDown: (event) => event.stopPropagation(),
									onMouseDown: (event) => event.preventDefault(),
									onClick: () => commands.current.retryFailure?.(),
								},
								translate(props, 'retry'),
							),
						h(
							'button',
							{
								type: 'button',
								className: 'dsh-htt-action dsh-htt-action-icon',
								'aria-label': translate(props, 'dismiss'),
								title: translate(props, 'dismiss'),
								onPointerDown: (event) => event.stopPropagation(),
								onMouseDown: (event) => event.preventDefault(),
								onClick: () => commands.current.dismissFailure?.(),
							},
							h(DiscardGlyph, { size: 11 }),
						),
					),
			);
		}

		//#endregion

		const inject = ['slots', 'locale', 'remote'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }));
			/*
			 * The bundle's own page in Settings → Plugins. The manager keys it by package name —
			 * that is what it passes down as `entryKey` — and shows it between the bundle's
			 * description and its rows.
			 *
			 * Deliberately *outside* the `remote.speech` injection below: settings have to be
			 * reachable while the official voice-input bundle is switched off, which is exactly
			 * when someone would go looking for them.
			 */
			ctx.inject(['slots'], (scope) => {
				scope.effect(() => scope.slots.inject(CONFIG_SLOT, () => scope.slots.register(
					{ name: CONFIG_SLOT, key: PKG, locale: NS },
					SettingsPage,
				)));
			});
			// `remote.speech` is mounted by the experimental voice-input plugin; if that
			// bundle is off the namespace is absent and this callback never runs, so the
			// composer simply keeps its normal behaviour.
			ctx.inject(['remote.speech', 'slots'], (scope) => {
				runtime.speech = scope.remote.speech;
				// Pick up the Host's real recording limits once. A failure or an unexpected
				// envelope only leaves the conservative local defaults in place.
				void (async () => {
					try {
						const catalog = await scope.remote.speech.catalog();
						if (catalog !== undefined && catalog.ok === true) runtime.limits = catalog.value ?? null;
					} catch (error) {
						/* keep the defaults */
					}
				})();
				scope.effect(() =>
					scope.slots.inject(SLOT, () =>
						scope.slots.register(
							{
								name: SLOT,
								id: ENTRY,
								order: 50,
								locale: NS,
								inject: () => ({
									transcribe: (request, signal) => scope.remote.speech.transcribe(request, signal),
								}),
							},
							HoldToTalk,
						),
					),
				);
			});
		}

		return { inject, apply };
	},
});
