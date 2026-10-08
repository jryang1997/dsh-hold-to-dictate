/** Exercise dictation through the registered slot, native audio boundary and Host API. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
globalThis.Element = class {};
globalThis.Node = class {};

function mount({ selected = false, live = true, location = 'host-local', workletAvailable = true, occurrences = [], stored, languages, language } = {}) {
	let component, worklet, tree, now = 0, cursor = 0, mounted = false, wall = 0;
	let draft = selected ? '前旧后' : '前后', rev = 0;
	const hooks = [], effects = [], listeners = new Map(), timers = new Map(), calls = [], lifts = [];
	const card = {
		closest: () => card, matches: () => false, lastElementChild: null,
		getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, height: 84 }),
		// The capsule is dragged by writing a CSS custom property, so recording these writes is
		// the only way to see which pointer is actually driving the gesture.
		style: { setProperty(name, value) { if (name === '--dsh-htt-lift') lifts.push(value); } },
		addEventListener: listen, removeEventListener: unlisten,
	};
	function listen(type, fn) { listeners.set(type, [...listeners.get(type) ?? [], fn]); }
	function unlisten(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter(x => x !== fn)); }
	const fire = (type, event = {}) => { for (const fn of listeners.get(type) ?? []) fn(event); };
	const inputActions = {
		captureInsertion: () => ({ start: selected ? 1 : draft.length, end: selected ? 2 : draft.length, draftRev: rev }),
		insertText(text, span) {
			if (span.draftRev !== rev) return false;
			draft = draft.slice(0, span.start) + text + draft.slice(span.end);
			rev++; render(); return true;
		},
	};
	const React = {
		createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
		useRef(value) { const i = cursor++; return hooks[i] ??= { current: i === 0 ? card : value }; },
		useState(value) {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = typeof value === 'function' ? value() : value;
			return [hooks[i], next => { hooks[i] = typeof next === 'function' ? next(hooks[i]) : next; if (mounted) render(); }];
		},
		useEffect(fn) { if (!mounted) effects.push(fn); },
	};
	class Recorder {
		state = 'inactive'; events = new Map();
		addEventListener(type, fn) { this.events.set(type, [...this.events.get(type) ?? [], fn]); }
		start() { this.state = 'recording'; }
		stop() {
			this.state = 'inactive';
			for (const fn of this.events.get('dataavailable') ?? []) fn({ data: new Blob(['audio']) });
			for (const fn of this.events.get('stop') ?? []) fn();
		}
	}
	class Audio {
		sampleRate = 16000;
		audioWorklet = workletAvailable ? { addModule: async () => {} } : null;
		createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
		createAnalyser() { return { fftSize: 256, getFloatTimeDomainData: a => a.fill(.1) }; }
		decodeAudioData = async () => ({ duration: 4 });
		createGain() { return { gain: { value: 0 }, connect() {}, disconnect() {} }; }
		close = async () => {};
		resume = async () => {};
	}
	class Offline {
		constructor(_channels, frames) { this.frames = frames; }
		createBufferSource() { return { connect() {}, start() {} }; }
		startRendering = async () => ({ duration: this.frames / 16000, getChannelData: () => new Float32Array(this.frames) });
	}
	class Worklet {
		port = { onmessage: null, close() {} }; constructor() { worklet = this; }
		connect() {} disconnect() {}
	}
	const window = {
		__ModuleLoader__: { load(module) { module.factory(() => React).apply({
			locale: { register() {} }, effect: fn => fn(), inject: (_deps, fn) => fn({
				effect: fn => fn(), remote: { speech: { catalog: async () => ({ ok: true, value: {
					selection: { providerId: 'local' },
					providers: [{ id: 'local', location, ...(languages === undefined ? {} : { languages }) }],
				} }) } },
				slots: { inject: (_slot, fn) => fn(), register(meta, fn) { if (meta.name === 'conversation.input.overlay') component = fn; } },
			}),
		}); } },
		localStorage: { getItem: () => (stored === undefined ? JSON.stringify({ live, ...(language === undefined ? {} : { language }) }) : stored), setItem() {}, removeItem() {} },
		btoa: value => Buffer.from(value, 'binary').toString('base64'),
		setTimeout(fn, ms) { const id = Symbol(); timers.set(id, { fn, at: now + ms }); return id; },
		clearTimeout: id => timers.delete(id), requestAnimationFrame: () => 0, cancelAnimationFrame() {},
		addEventListener: listen, removeEventListener: unlisten,
	};
	// `performance.now()` is the wall clock the refresh period is measured against, so the test
	// drives it separately from the timer clock: `advance` fires timers, `advanceWall` makes the
	// Host look slow without letting any timer come due.
	new Function('window', 'document', 'navigator', 'AudioContext', 'OfflineAudioContext', 'MediaRecorder', 'AudioWorkletNode', 'performance', source)(
		window, { hidden: false, addEventListener: listen, removeEventListener: unlisten },
		{ language: 'zh-CN', mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
		Audio, Offline, Recorder, Worklet, { now: () => wall },
	);
	function render() {
		cursor = 0;
		tree = component({ inputActions, useInput: select => select({ draft, draftRev: rev, occurrences }),
			transcribe(request, signal) { return new Promise((resolve, reject) => calls.push({ request, signal, resolve, reject })); },
		});
	}
	render(); mounted = true;
	const cleanups = effects.map(fn => fn()).filter(fn => typeof fn === 'function');
	const key = { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} };
	return {
		calls, get draft() { return draft; },
		async start() { await flush(); fire('keydown', key); await flush(); },
		async samples(seconds = 2, amplitude = .1) { worklet?.port.onmessage?.({ data: new Float32Array(16000 * seconds).fill(amplitude) }); await flush(); },
		async advance(ms = 1500) {
			now += ms;
			const due = [...timers].filter(([, t]) => t.at <= now);
			for (const [id, t] of due) { if (timers.delete(id)) t.fn(); }
			await flush();
		},
		async result(index, text) { calls[index].resolve({ ok: true, value: { text } }); await flush(); },
		async failure(index) { calls[index].resolve({ ok: false, error: { message: 'temporary failure' } }); await flush(); },
		async retry() {
			function find(node) {
				if (!node || typeof node !== 'object') return null;
				if (node.props?.className === 'dsh-htt-action') return node;
				for (const child of (Array.isArray(node) ? node : node.children ?? [])) { const hit = find(child); if (hit) return hit; }
				return null;
			}
			find(tree).props.onClick(); await flush();
		},
		async finish() { fire('keyup', key); await flush(); },
		async cancel() { fire('keydown', { ...key, key: 'Escape' }); await flush(); },
		/** A pointer event on the card. `target: null` keeps the plugin-control guard out of the way. */
		async pointer(type, over = {}) {
			fire(type, { button: 0, pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 40, target: null, ...over });
			await flush();
		},
		/** How many handlers the gesture currently has on this event type, anywhere. */
		watchers: (type) => (listeners.get(type) ?? []).length,
		/** How often the recording capsule has been dragged since the last snapshot. */
		lifts: () => lifts.length,
		/** Move the wall clock without letting a timer come due, so a slow Host can be simulated. */
		advanceWall(ms) { wall += ms; },
		/** The next live-preview delay, or null while the plugin waits on a reply. The 110 s
		 *  recording cap is a timer too, so anything that long is not a preview cadence. */
		nextDelay() { const at = [...timers.values()].map(t => t.at - now).filter(d => d < 60000); return at.length ? Math.min(...at) : null; },
		edit(text) { draft = text; rev++; render(); },
		dispose() { for (const fn of cleanups) fn(); },
	};
}

// The first slice: real Host recognition appears while the key is still held.
const live = mount();
await live.start(); await live.samples(); await live.advance();
assert.equal(live.calls.length, 1, 'holding sends a valid audio snapshot before release');
const wav = Buffer.from(live.calls[0].request.audioBase64, 'base64');
assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
assert.equal(wav.readUInt32LE(24), 16000);
await live.result(0, '你好');
assert.equal(live.draft, '前后你好', 'the recognized words appear in the draft during recording');
await live.samples(); await live.advance();
await live.result(1, '你好世界');
assert.equal(live.draft, '前后你好世界', 'later words revise the owned range instead of duplicating it');
await live.finish();
await live.result(2, '你好，世界。');
assert.equal(live.draft, '前后你好，世界。', 'release finalizes punctuation without adding a duplicate transcript');
live.dispose();

const cancel = mount({ selected: true });
await cancel.start(); await cancel.samples(); await cancel.advance();
await cancel.result(0, '临时识别');
assert.equal(cancel.draft, '前临时识别后');
await cancel.samples(); await cancel.advance();
await cancel.cancel();
assert.equal(cancel.draft, '前旧后', 'cancelling restores the original selection and surrounding draft');
await cancel.result(1, '迟到结果');
assert.equal(cancel.draft, '前旧后', 'a cancelled request cannot reinsert text');
cancel.dispose();

const conflict = mount();
await conflict.start(); await conflict.samples(); await conflict.advance();
await conflict.result(0, '语音');
conflict.edit('我手工编辑了语音');
await conflict.samples(); await conflict.advance();
await conflict.result(1, '语音修订');
await conflict.finish(); await conflict.result(2, '最终语音');
assert.equal(conflict.draft, '我手工编辑了语音', 'manual editing is never overwritten by live or final recognition');
conflict.dispose();

const serial = mount();
await serial.start(); await serial.samples(); await serial.advance();
await serial.samples(); await serial.advance(3000);
assert.equal(serial.calls.length, 1, 'slow inference cannot build a queue of obsolete snapshots');
await serial.finish();
assert.equal(serial.calls.length, 1, 'final recognition waits for the active Host request');
await serial.result(0, '旧预览');
assert.equal(serial.calls.length, 2);
await serial.result(1, '最终内容');
assert.equal(serial.draft, '前后最终内容');
serial.dispose();

// Cancelling and immediately starting another recording must not await the old request.
const restart = mount();
await restart.start(); await restart.samples(); await restart.advance();
await restart.cancel();
await restart.start(); await restart.finish();
assert.equal(restart.calls.length, 2, 'a new recording finalizes independently of a cancelled preview');
await restart.result(1, '新录音'); await restart.result(0, '旧录音');
assert.equal(restart.draft, '前后新录音');
restart.dispose();

const editedOutside = mount();
await editedOutside.start(); await editedOutside.samples(); await editedOutside.advance(); await editedOutside.result(0, '语音');
editedOutside.edit('前后语音手写');
await editedOutside.cancel();
assert.equal(editedOutside.draft, '前后手写', 'cancel removes unchanged voice text while preserving manual additions outside it');
editedOutside.dispose();

const editedInside = mount();
await editedInside.start(); await editedInside.samples(); await editedInside.advance(); await editedInside.result(0, '语音');
editedInside.edit('前后我改过的语音'); await editedInside.cancel();
assert.equal(editedInside.draft, '前后我改过的语音', 'cancel preserves manual edits inside the former voice range');
editedInside.dispose();

const retry = mount();
await retry.start(); await retry.samples(); await retry.advance(); await retry.result(0, '预览');
await retry.finish(); await retry.failure(1); await retry.retry(); await retry.result(2, '完整识别');
assert.equal(retry.draft, '前后完整识别', 'retry replaces provisional words rather than duplicating them');
retry.dispose();

const previewFailure = mount();
await previewFailure.start(); await previewFailure.samples(); await previewFailure.advance(); await previewFailure.failure(0);
await previewFailure.finish(); await previewFailure.result(1, '完整识别');
assert.equal(previewFailure.draft, '前后完整识别', 'preview errors still allow whole-recording recognition');
previewFailure.dispose();

// Every case above stores a config, so none of them ever runs the load() fallback. A fresh
// install stores nothing at all, and that is exactly the install the README's "off by default"
// describes — so the promise gets checked on the path that only a new user takes.
const fresh = mount({ stored: null });
await fresh.start(); await fresh.samples(); await fresh.advance();
assert.equal(fresh.calls.length, 0, 'a fresh install keeps live dictation off, as the README promises');
await fresh.finish(); await fresh.result(0, '松开识别');
assert.equal(fresh.draft, '前后松开识别', 'a fresh install still transcribes on release');
fresh.dispose();

// A hold that lands while the previous transcription is still in flight cannot start a second
// recording, but it has already drawn its ring and attached its three window listeners. Both of
// onUp's own paths give up on "no recording is running", so begin() has to retract them.
const superseded = mount({ live: false });
await superseded.pointer('pointerdown');
await superseded.advance(300);
assert.ok(superseded.watchers('pointerup') > 0, 'a live gesture listens on the window');
await superseded.pointer('pointerup');
assert.equal(superseded.calls.length, 1, 'the first recording is still transcribing');
await superseded.pointer('pointerdown', { pointerId: 2 });
await superseded.advance(300);
assert.equal(superseded.watchers('pointermove'), 0, 'a press abandoned mid-transcription detaches its window listeners');
assert.equal(superseded.watchers('pointerup'), 0, 'an abandoned press leaves no pointerup listener behind');
assert.equal(superseded.watchers('pointercancel'), 0, 'an abandoned press leaves no pointercancel listener behind');
assert.equal(superseded.calls.length, 1, 'the abandoned press spends no provider call');
superseded.dispose();

// Those window listeners serve every pointer on the screen, so a second finger must not be
// able to decide the fate of a recording the first finger is still making.
const secondFinger = mount({ live: false });
await secondFinger.pointer('pointerdown', { pointerId: 1 });
await secondFinger.advance(300);
const atRest = secondFinger.lifts();
await secondFinger.pointer('pointermove', { pointerId: 2, clientY: 0 });
assert.equal(secondFinger.lifts(), atRest, 'a foreign pointer cannot drag the recording capsule');
await secondFinger.pointer('pointerup', { pointerId: 2, clientY: 0 });
assert.equal(secondFinger.calls.length, 0, 'a foreign pointer cannot end the recording it did not start');
// A cancelled recording would swallow the release below without ever calling the Host, so the
// count at the end is what proves the foreign cancel was ignored rather than obeyed.
await secondFinger.pointer('pointercancel', { pointerId: 3 });
await secondFinger.pointer('pointermove', { pointerId: 1, clientY: 30 });
assert.ok(secondFinger.lifts() > atRest, 'the pointer that started the recording still moves the capsule');
await secondFinger.pointer('pointerup', { pointerId: 1 });
assert.equal(secondFinger.calls.length, 1, 'the recording survives a foreign move, a foreign release and a foreign cancel');
secondFinger.dispose();

for (const options of [{ live: false }, { location: 'cloud' }, { workletAvailable: false }, { occurrences: [{}] }]) {
	const fallback = mount(options);
	await fallback.start(); await fallback.samples(); await fallback.advance();
	assert.equal(fallback.calls.length, 0, 'unsupported or disabled live mode retains release-to-transcribe behavior');
	await fallback.finish(); await fallback.result(0, '松开识别');
	assert.equal(fallback.draft, '前后松开识别'); fallback.dispose();
}
// Live dictation used to stop the moment anything went wrong, and it did so invisibly: the
// capsule kept drawing a waveform while the provisional words simply stopped arriving. A faster
// loop meets all three of these often enough that they decide whether it feels live at all.
const early = mount();
await early.start();
await early.advance(200);
assert.equal(early.calls.length, 0, 'a prefix shorter than MIN_SECONDS is not sent to the Host');
assert.equal(early.nextDelay(), 120, 'and the loop comes back for more rather than giving up on it');await early.samples();
await early.advance(200);
assert.equal(early.calls.length, 1, 'live text starts as soon as the worklet holds enough audio');
early.dispose();

const resilient = mount();
await resilient.start(); await resilient.samples(); await resilient.advance();
await resilient.failure(0);
assert.equal(resilient.nextDelay(), 500, 'a failed preview backs off instead of retrying flat out');
await resilient.advance(3000);
assert.equal(resilient.calls.length, 2, 'a Host failure no longer ends live dictation for the rest of the recording');
resilient.dispose();

// The period is the Host's own round trip, not a delay the plugin invents on top of it. A quick
// reply refreshes on the floor; a slow one sets the next period from what it actually cost.
const paced = mount();
await paced.start(); await paced.samples(); await paced.advance();
assert.equal(paced.nextDelay(), null, 'nothing is scheduled while a preview is still in flight');
await paced.advanceWall(40); await paced.result(0, '快');
assert.equal(paced.nextDelay(), 210, 'a 40 ms reply waits out the rest of the floor interval');
await paced.advance(300);
await paced.advanceWall(900); await paced.result(1, '快慢');
assert.equal(paced.nextDelay(), 135, 'a 900 ms reply waits only the slack the interval still owes');
paced.dispose();

// A provider rejects a language it does not advertise outright — the call fails rather than
// falling back to its default — so a stale or wrong choice would break every transcription.
const hinted = mount({ languages: ['auto', 'zh', 'en', 'yue', 'ja', 'ko'], language: 'yue' });
await hinted.start(); await hinted.samples(); await hinted.advance();
assert.equal(hinted.calls[0].request.language, 'yue', 'a language the provider lists travels with the request');
hinted.dispose();

const unsupported = mount({ languages: ['auto', 'zh'], language: 'ja' });
await unsupported.start(); await unsupported.samples(); await unsupported.advance();
assert.equal(unsupported.calls[0].request.language, undefined, 'a language the provider does not list is left to the Host');
unsupported.dispose();

const hostDecides = mount({ languages: ['auto', 'zh'] });
await hostDecides.start(); await hostDecides.samples(); await hostDecides.advance();
assert.equal(hostDecides.calls[0].request.language, undefined, 'the shipped default keeps the Host in charge of the language');
hostDecides.dispose();

// A take whose previews cost real time stops re-reading itself: it commits everything up to a
// sentence-length pause and then reads forward from there. Short takes never take this path, and
// a take with no such pause keeps the accurate whole-take behaviour rather than being cut mid-word.
const segmented = mount();
await segmented.start(); await segmented.samples(2); await segmented.advance();
assert.equal(Buffer.from(segmented.calls[0].request.audioBase64, 'base64').length, 44 + 2 * 32000, 'the first preview reads the whole take');
await segmented.advanceWall(900); await segmented.result(0, '开头。');
await segmented.samples(2);          // speech to 4 s
await segmented.samples(1, 0);       // a one-second pause, 4-5 s
await segmented.samples(1);          // speech resumes, closing the pause at 4.5 s
await segmented.advance(300);
assert.equal(Buffer.from(segmented.calls[1].request.audioBase64, 'base64').length, 44 + Math.round(4.5 * 32000), 'the first commit covers the take only up to the pause');
await segmented.result(1, '开头，中间。');
assert.equal(segmented.draft, '前后开头，中间。', 'the commit replaces the provisional text instead of appending to it');
await segmented.advance(300);
assert.equal(Buffer.from(segmented.calls[2].request.audioBase64, 'base64').length, 44 + Math.round(1.5 * 32000), 'the window after a commit is short again');
await segmented.result(2, '结尾');
assert.equal(segmented.draft, '前后开头，中间。结尾', 'later words append to the frozen prefix');
segmented.dispose();

// The failure this guards: a window that starts before the anchor re-transcribes words that are
// already on screen. Without a pause there is nothing to commit, so the window stays the whole
// take and the result must replace the text rather than repeat its beginning.
const unpaused = mount();
await unpaused.start(); await unpaused.samples(2); await unpaused.advance();
await unpaused.advanceWall(900); await unpaused.result(0, '一直说');
await unpaused.samples(3);
await unpaused.advance(300);
assert.equal(Buffer.from(unpaused.calls[1].request.audioBase64, 'base64').length, 44 + 5 * 32000, 'with no sentence pause the window simply grows from zero');
await unpaused.result(1, '一直说下去');
assert.equal(unpaused.draft, '前后一直说下去', 'an unpaused take is never duplicated or cut');
unpaused.dispose();

// The dangerous failure: committing at a pause that is only a breath. Cutting there is what took
// measured agreement from 0.99 to 0.85, so a short silence must not become a commit point.
const brief = mount();
await brief.start(); await brief.samples(2); await brief.advance();
await brief.advanceWall(900); await brief.result(0, '开头。');
await brief.samples(2);
await brief.samples(0.4, 0);
await brief.samples(1);
await brief.advance(300);
assert.equal(Buffer.from(brief.calls[1].request.audioBase64, 'base64').length, 44 + Math.round(5.4 * 32000), 'a pause too short to be a sentence break is not committed at');
brief.dispose();

console.log('live: ok');
