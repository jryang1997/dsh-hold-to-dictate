/**
 * Render smoke test.
 *
 * `node --check` proves client.js parses; it cannot prove the component mounts. This
 * loads the bundle exactly the way the DSH module loader does, captures the slot
 * component through a stubbed `apply`, and renders it across every state the gesture
 * can be in — so a renamed helper, a dropped import or a malformed style object fails
 * here instead of in the composer.
 *
 * It also enforces the three motion rules the stylesheet is built on, because they are
 * the kind of thing that quietly regresses: entry and exit are transitions (never
 * keyframes), no transition animates a layout property or uses `ease-in`, and exactly
 * one looping animation exists.
 *
 * No dependencies, no build step — the same constraints as the plugin itself.
 *
 * Run with: node tests/render.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Expose the pure spring only to this harness, without expanding the plugin API.
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
	.replace('return { inject, apply };', 'return { inject, apply, settleLift };');

/*
 * The plugin asks `event.target instanceof Element`, and Node has no DOM at all. Declaring
 * the two constructors is enough to let the pointer path run under the harness.
 */
globalThis.Element = class Element {};
globalThis.Node = class Node {};

const failures = [];
const check = (condition, label) => {
	if (!condition) failures.push(label);
};

//#region an event registry, so the keyboard path can actually be exercised

/** Every listener the component attaches, keyed by event type. */
const listeners = new Map();
const listen = (type, fn) => {
	const bound = listeners.get(type) ?? [];
	bound.push(fn);
	listeners.set(type, bound);
};
const unlisten = (type, fn) => {
	listeners.set(type, (listeners.get(type) ?? []).filter((bound) => bound !== fn));
};
const fire = (type, event) => {
	let handled = 0;
	for (const fn of listeners.get(type) ?? []) {
		fn(event);
		handled += 1;
	}
	return handled;
};

//#endregion

//#region the module loader handshake

let loaded = null;
/** Timer ids are recorded rather than stubbed away: the hold duration is a real assertion. */
const timeouts = [];
const clearedTimers = new Set();
let timerId = 0;
const fakeDocument = {
	hidden: false,
	addEventListener: listen,
	removeEventListener: unlisten,
};
const fakeWindow = {
	__ModuleLoader__: { load: (module) => { loaded = module; } },
	btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
	setTimeout: (fn, ms) => {
		timerId += 1;
		timeouts.push({ id: timerId, fn, ms });
		return timerId;
	},
	clearTimeout: (id) => clearedTimers.add(id),
	requestAnimationFrame: () => 0,
	cancelAnimationFrame: () => undefined,
	addEventListener: listen,
	removeEventListener: unlisten,
};
new Function('window', 'document', 'navigator', 'AudioContext', 'OfflineAudioContext', source)(
	fakeWindow,
	fakeDocument,
	{ language: 'zh-CN' },
	function AudioContext() {},
	function OfflineAudioContext() {},
);

check(loaded !== null, 'client.js registers itself with the module loader');
check(loaded?.id === '@jryang1997/dsh-hold-to-dictate', 'bundle id still matches package.json');

//#endregion

//#region a DOM and a React just real enough to mount once

const flatten = (nodes) => nodes.flatMap((node) => (Array.isArray(node) ? flatten(node) : [node]));

const rect = (left, top, width, height) => ({
	left, top, width, height, right: left + width, bottom: top + height,
	getBoundingClientRect() { return this; },
});

/** The card, its tool row, and two children so `measure()` finds a trailing group. */
const fakeCard = (trailingLeft = 380) => {
	const node = {
		...rect(0, 100, 600, 84),
		style: { setProperty: () => undefined },
		addEventListener: listen,
		removeEventListener: unlisten,
		contains: () => true,
		querySelectorAll: () => [],
		matches: () => false,
	};
	node.lastElementChild = {
		...rect(0, 142, 600, 42),
		children: [
			{ ...rect(8, 148, 120, 30) },      // the leading controls
			{ ...rect(trailingLeft, 148, 592 - trailingLeft, 34) }, // the trailing group
		],
	};
	node.closest = () => node;
	return node;
};

let preset = [];
let hookIndex = 0;
let refQueue = [];
let cleanups = [];
/** Every state update the component makes, so measurement can be observed rather than assumed. */
const setCalls = [];
const React = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
	// The refs the component asks for are (root, wave); both need to look mounted.
	useRef: (value) => (refQueue.length > 0 ? refQueue.shift() : { current: value }),
	useState: (value) => {
		const given = preset[hookIndex];
		hookIndex += 1;
		const initial = typeof value === 'function' ? value() : value;
		return [given === undefined ? initial : given, (next) => setCalls.push(next)];
	},
	useEffect: (fn) => {
		const cleanup = fn();
		if (typeof cleanup === 'function') cleanups.push(cleanup);
	},
};

//#endregion

//#region capture the component through a stubbed apply

let component = null;
/** Every slot the bundle registers into, by slot name. */
const registrations = new Map();
const scope = {
	effect: (fn) => { fn(); },
	remote: { speech: { catalog: async () => ({ ok: false }), transcribe: async () => ({ ok: false }) } },
	slots: {
		inject: (_name, fn) => fn(),
		register: (meta, registered) => {
			registrations.set(meta.name, { meta, component: registered });
			if (meta.name === 'conversation.input.overlay') component = registered;
		},
	},
};
const ctx = {
	effect: (fn) => { fn(); },
	locale: { register: () => undefined },
	inject: (_deps, fn) => fn(scope),
};

const bundle = loaded.factory((name) => {
	if (name === 'react') return React;
	throw new Error(`unexpected require(${JSON.stringify(name)})`);
});
check(typeof bundle.apply === 'function', 'the factory returns an apply function');
check(JSON.stringify(bundle.inject) === '["slots","locale","remote"]', 'the inject list is unchanged');
bundle.apply(ctx);
check(typeof component === 'function', 'the slot component registers');

//#endregion

//#region tree helpers

const classes = (node, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) classes(child, found);
		return found;
	}
	if (typeof node.props.className === 'string') found.push(node.props.className);
	for (const child of node.children ?? []) classes(child, found);
	return found;
};
const attrs = (node, key, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) attrs(child, key, found);
		return found;
	}
	if (node.props[key] !== undefined) found.push(node.props[key]);
	for (const child of node.children ?? []) attrs(child, key, found);
	return found;
};
/** The copy currently showing: every string inside a `data-on` label variant. */
const litText = (node, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) litText(child, found);
		return found;
	}
	if (typeof node.props.className === 'string' && node.props.className.startsWith('dsh-htt-row')) {
		for (const variant of flatten(node.children ?? [])) {
			if (variant?.props?.['data-on'] === undefined) continue;
			for (const text of flatten(variant.children ?? [])) {
				if (typeof text === 'string') found.push(text);
			}
		}
		return found;
	}
	for (const child of node.children ?? []) litText(child, found);
	return found;
};
const styleText = (node) => {
	if (node === null || node === undefined || typeof node !== 'object') return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = styleText(child);
			if (found !== null) return found;
		}
		return null;
	}
	if (node.type === 'style') return flatten(node.children ?? []).join('');
	for (const child of node.children ?? []) {
		const found = styleText(child);
		if (found !== null) return found;
	}
	return null;
};
/** The declarations of one rule in the injected stylesheet. */
const rule = (css, selector) => {
	const at = css.indexOf(selector);
	if (at === -1) return '';
	const open = css.indexOf('{', at);
	return css.slice(open + 1, css.indexOf('}', open));
};
const hasClass = (node, name) => typeof node.props.className === 'string'
	&& node.props.className.split(' ').includes(name);
/** The first element carrying that exact class token. */
const find = (node, name) => {
	if (node === null || node === undefined || typeof node !== 'object') return null;
	if (Array.isArray(node)) {
		for (const child of node) {
			const hit = find(child, name);
			if (hit !== null) return hit;
		}
		return null;
	}
	if (hasClass(node, name)) return node;
	for (const child of node.children ?? []) {
		const hit = find(child, name);
		if (hit !== null) return hit;
	}
	return null;
};
const findAll = (node, name, found = []) => {
	if (node === null || node === undefined || typeof node !== 'object') return found;
	if (Array.isArray(node)) {
		for (const child of node) findAll(child, name, found);
		return found;
	}
	if (hasClass(node, name)) found.push(node);
	for (const child of node.children ?? []) findAll(child, name, found);
	return found;
};
/** The row for one setting, so a test can address a control without counting positions. */
const settingRow = (tree, key) => findAll(tree, 'dsh-htt-set-row').find((row) => row.props['data-setting'] === key);

//#endregion

//#region render every state

const IDLE = {
	phase: 'idle', notice: '', tone: 'info', leaving: false, cancelled: false, pending: '',
	pendingLeaving: false, bubbleLeaving: false, arm: null, armLeaving: false, retryable: false,
	elapsed: 0,
};
const BOX = { height: 84, rowHeight: 42, hintRight: 220, hintMax: 180 };

/** What the component calls when it wants to write to the draft. */
const inputActions = {
	inserted: [],
	captured: 0,
	captureInsertion() { this.captured += 1; return { start: 0, end: 0, draftRev: 1 }; },
	insertText(text) { this.inserted.push(text); return true; },
};

/**
 * Mount the component once, with a fresh DOM and listener registry, and leave the effect
 * attached so the keyboard path can be driven afterwards.
 */
const render = (hovered, view, box = BOX, props = {}, card = fakeCard()) => {
	for (const cleanup of cleanups) cleanup();
	cleanups = [];
	listeners.clear();
	setCalls.length = 0;
	preset = [hovered, view, box];
	hookIndex = 0;
	refQueue = [{ current: card }, { current: { querySelectorAll: () => [] } }];
	return component({ t: undefined, inputActions, ...props });
};

/** A keyboard event carrying only what the plugin reads. */
const key = (over) => ({
	key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false,
	preventDefault() { this.prevented = true; },
	stopPropagation() { this.stopped = true; },
	...over,
});

// Idle, hovered: the hint exists and is parked in the tool row.
let tree = render(true, IDLE);
let names = classes(tree);
check(names.includes('dsh-htt-layer'), 'the layer renders');
check(names.includes('dsh-htt-hint'), 'the hint renders');
check(attrs(tree, 'data-on').length === 1, 'the hint is the only lit element while idle');
check(!names.includes('dsh-htt-bubble'), 'no recording bubble while idle');
check(!names.includes('dsh-htt-ring'), 'no press ring without a press');

// Idle with a narrow tool row: the hint must not switch on over the controls.
tree = render(true, IDLE, { ...BOX, hintMax: 20 });
check(attrs(tree, 'data-on').length === 0, 'the hint stays off when the tool row has no room');

/*
 * Vertical alignment is the one thing about the hint that cannot be eyeballed from the
 * markup, so it is asserted twice: that the measurement produces a centre, and that the
 * centre -- not the row's box -- is what positions the hint.
 */
const measured = setCalls.find((call) => call !== null && typeof call === 'object' && 'hintCentre' in call);
check(measured?.hintCentre === 65,
	`the hint is centred on the control it sits beside (got ${measured?.hintCentre})`);
const centredHint = find(render(true, IDLE, { ...BOX, hintCentre: 21 }), 'dsh-htt-hint');
check(centredHint.props.style.top === '11px', 'and that centre is what positions it, not the row box');
check(centredHint.props.style.bottom === undefined, 'with no second, conflicting offset');
const unmeasuredHint = find(render(true, IDLE, { ...BOX, hintCentre: null }), 'dsh-htt-hint');
check(unmeasuredHint.props.style.bottom !== undefined && unmeasuredHint.props.style.top === undefined,
	'and it falls back to the row box before anything has been measured');

// A long model label can start left of centre while leaving room for the hint.
const longModelCard = fakeCard(240);
render(false, IDLE, BOX, {}, longModelCard);
const longModelBox = setCalls.find((call) => call && typeof call === 'object' && 'hintMax' in call);
check(longModelBox?.hintMax === 88, 'a long model label still leaves the real 88 px gap');
fire('pointerenter', {});
check(setCalls.includes(true), 'pointer entry enables the hover hint');
check(find(render(true, IDLE, longModelBox, {}, longModelCard), 'dsh-htt-hint').props['data-on'] === '',
	'the hint fades in beside a model label that starts left of centre');

// Slot contents may change width without resizing the card itself.
render(false, IDLE);
setCalls.length = 0;
fire('pointerenter', {});
check(setCalls.some((call) => call && typeof call === 'object' && 'hintMax' in call),
	'pointer entry remeasures the current tool row');

const alreadyHoveredCard = fakeCard();
alreadyHoveredCard.matches = () => true;
render(false, IDLE, BOX, {}, alreadyHoveredCard);
check(setCalls.includes(true), 'mounting under the pointer enables the hint without a second entry');

// Recording: a floating capsule, and the composer itself is left alone.
tree = render(true, { ...IDLE, phase: 'recording' });
names = classes(tree);
check(names.includes('dsh-htt-bubble'), 'the bubble renders while recording');
check(names.includes('dsh-htt-pill'), 'the bubble is one capsule');
check(names.includes('dsh-htt-material'), 'the capsule carries the host material layer');
check(names.includes('dsh-htt-alarm'), 'the capsule carries the discard wash');
check(names.includes('dsh-htt-edge'), "the card's own hairline is drawn for the discard state");
check(names.includes('dsh-htt-wave'), 'the meter renders');
check(names.includes('dsh-htt-slot'), 'the meter sits in a fixed-width slot');
check(names.includes('dsh-htt-cross'), 'the discard cross is present, cross-faded not swapped');
check(names.includes('dsh-htt-dot-core'), 'the mic-is-live dot is present');
check(names.includes('dsh-htt-row'), 'the label row renders');
check(attrs(tree, 'data-on').length === 1, 'exactly one label variant is lit');
check(
	litText(tree).join('|') === '松开完成',
	`recording shows one short word (got ${JSON.stringify(litText(tree))})`,
);
// The whole point of the redesign: nothing here can intercept a click, because the
// bubble floats over the transcript and the old full-bleed panel used to shield the card.
check(!names.includes('dsh-htt-panel'), 'the old full-card panel is gone');
check(attrs(tree, 'strokeWidth').length === 28, `the waveform is 28 bars (got ${attrs(tree, 'strokeWidth').length})`);
check(attrs(tree, 'aria-live').length === 1, 'the capsule is the single live region');

const timed = find(render(false, { ...IDLE, phase: 'recording', elapsed: 65 }), 'dsh-htt-time');
check(timed.children[0] === '01:05', 'elapsed recording time formats across a minute boundary');
check(timed.props['aria-hidden'] === true, 'the clock does not announce every second');

tree = render(false, { ...IDLE, phase: 'complete', elapsed: 65 });
check(classes(tree).includes('dsh-htt-check'), 'completion carries a checkmark');
check(litText(tree).join('|') === '已插入草稿', 'completion clearly confirms draft insertion');
check(find(tree, 'dsh-htt-time').children[0] === '01:05', 'completion keeps the clock space and duration');
check(find(tree, 'dsh-htt-pill').props['aria-label'] === '已插入草稿', 'completion announces the result');

// A retained transcript must really insert, not just render as a clickable chip.
tree = render(false, { ...IDLE, pending: '保留的转写' });
const insertedBefore = inputActions.inserted.length;
find(tree, 'dsh-htt-pending').props.onClick();
check(inputActions.inserted.length === insertedBefore + 1
	&& inputActions.inserted.at(-1) === '保留的转写', 'the retained-transcript button uses the active insertion command');
check(setCalls.some((update) => typeof update === 'function' && update(IDLE).phase === 'complete'),
	'a successful insertion enters completion');
check(timeouts.at(-2)?.ms === 900, 'completion clears itself without waiting for another gesture');
const completionTimer = timeouts.at(-2).id;
fire('keydown', key());
check(clearedTimers.has(completionTimer), 'a new recording cancels the previous completion timer');

tree = render(false, { ...IDLE, phase: 'failed', retryable: true });
for (const button of findAll(tree, 'dsh-htt-action')) button.props.onClick();
check(setCalls.some((update) => typeof update === 'function' && update(IDLE).phase === 'idle'),
	'failure actions use the active commands and dismiss to idle');

const control = new Element();
control.closest = () => ({});
render(false, IDLE);
const timersBeforeControl = timeouts.length;
fire('pointerdown', { button: 0, target: control });
check(timeouts.length === timersBeforeControl, 'plugin controls never arm the capture-phase recording gesture');

// The release spring preserves velocity and has the same result at different frame rates.
const still = bundle.settleLift(0, 0, 1);
check(still.position === 0 && still.velocity === 0, 'the spring stays at rest');
const direct = bundle.settleLift(-8, -20, .2);
let subdivided = { position: -8, velocity: -20 };
for (let frame = 0; frame < 12; frame += 1) {
	subdivided = bundle.settleLift(subdivided.position, subdivided.velocity, 1 / 60);
}
check(Math.abs(direct.position - subdivided.position) < 1e-9
	&& Math.abs(direct.velocity - subdivided.velocity) < 1e-9, 'the spring is independent of frame rate');
const handoff = bundle.settleLift(-8, -20, 0);
check(handoff.position === -8 && handoff.velocity === -20, 'the release starts at the current position and velocity');
check(Math.abs(bundle.settleLift(-8, -20, .24).position) < .1, 'the spring settles before the meter clock stops');

// Return to recording for the following discard-state assertions.

// Recording, discard armed: the copy is the only place text is allowed to appear.
tree = render(true, { ...IDLE, phase: 'recording', cancelled: true });
check(
	litText(tree).join('|') === '松开丢弃',
	`discard shows the discard copy (got ${JSON.stringify(litText(tree))})`,
);
check(attrs(tree, 'data-tone').includes('error'), 'the discard copy is toned as destructive');
check(attrs(tree, 'data-state')[0] === 'recording', 'the state mark still reports recording');

// Transcribing: no hard cut — bubble, meter and label all persist.
tree = render(true, { ...IDLE, phase: 'transcribing' });
names = classes(tree);
check(names.includes('dsh-htt-bubble'), 'the bubble persists through transcribing');
check(names.includes('dsh-htt-wave'), 'the meter persists through transcribing');
check(attrs(tree, 'data-state')[0] === 'transcribing', 'the mark switches to its transcribing state');
check(litText(tree).join('|') === '识别中', `transcribing shows its copy (got ${JSON.stringify(litText(tree))})`);

// Bubble exit: still mounted, marked as leaving.
tree = render(true, { ...IDLE, bubbleLeaving: true });
check(classes(tree).includes('dsh-htt-bubble'), 'the bubble stays mounted during its exit');
check(attrs(tree, 'data-leaving').length === 1, 'the exiting bubble carries data-leaving');

// Notice, and its exit.
tree = render(false, { ...IDLE, phase: 'notice', notice: '已取消', tone: 'muted' });
check(classes(tree).includes('dsh-htt-notice'), 'the notice renders');
check(attrs(tree, 'data-tone')[0] === 'muted', 'the notice carries its tone');
tree = render(false, { ...IDLE, phase: 'notice', notice: '已取消', tone: 'muted', leaving: true });
check(attrs(tree, 'data-leaving').length === 1, 'the leaving notice carries data-leaving');

// Retained transcript, and its exit.
tree = render(false, { ...IDLE, pending: '你好' });
check(classes(tree).includes('dsh-htt-pending'), 'the retained-transcript chip renders');
tree = render(false, { ...IDLE, pending: '你好', pendingLeaving: true });
check(classes(tree).includes('dsh-htt-pending'), 'the chip stays mounted during its exit');
check(attrs(tree, 'data-leaving').length === 1, 'the leaving chip carries data-leaving');

// The press ring, drawing and retracting.
tree = render(false, { ...IDLE, arm: { x: 120, y: 30 } });
names = classes(tree);
check(names.includes('dsh-htt-ring'), 'the press ring renders while arming');
check(names.includes('dsh-htt-ring-arc'), 'the press ring carries its progress arc');
check(attrs(tree, 'aria-hidden').length > 0, 'the decorative layers stay aria-hidden');
tree = render(false, { ...IDLE, arm: { x: 120, y: 30 }, armLeaving: true });
check(attrs(tree, 'data-leaving').length === 1, 'the retracting ring carries data-leaving');

// A failure stays on screen and offers a way out, unlike a notice.
tree = render(false, { ...IDLE, phase: 'failed', notice: '转写失败：boom', tone: 'error', retryable: true });
names = classes(tree);
check(names.includes('dsh-htt-failure'), 'the failure card renders');
check(attrs(tree, 'role').includes('alert'), 'the failure announces itself assertively');
check(classes(tree).filter((name) => name.includes('dsh-htt-action')).length === 2,
	'a retryable failure offers both retry and dismiss');
check(!names.includes('dsh-htt-notice'), 'a failure is not shown as a notice');

// Not everything can be retried: a recording that was too long would fail again.
tree = render(false, { ...IDLE, phase: 'failed', notice: '太长了', tone: 'error', retryable: false });
check(classes(tree).filter((name) => name.includes('dsh-htt-action')).length === 1,
	'a non-retryable failure offers only dismiss');

// The transient notice keeps the polite role, because nothing is being asked of the user.
tree = render(false, { ...IDLE, phase: 'notice', notice: '已取消', tone: 'muted' });
check(attrs(tree, 'role').includes('status'), 'the notice keeps the polite role');

//#endregion

//#region keyboard entry — the chord is the hold, the release is the release

inputActions.captured = 0;
render(true, IDLE);
check(fire('keydown', key()) === 1, 'the chord is listened for');
check(inputActions.captured === 1, 'the chord starts a capture with no pointer involved');

const held = key({ repeat: true });
fire('keydown', held);
check(held.prevented === true, 'a repeated chord keydown is swallowed rather than restarting');

const partial = key({ shiftKey: false });
fire('keydown', partial);
check(partial.prevented === undefined, 'space without the full chord is left alone');

const release = key({ key: 'Control', code: 'ControlLeft' });
fire('keyup', release);
check(release.prevented === true, 'releasing the chord is claimed, which is what ends the recording');

const stray = key({ key: 'Control', code: 'ControlLeft' });
fire('keyup', stray);
check(stray.prevented === undefined, 'a keyup outside a chord is left alone');

const untouched = key({ key: 'a', code: 'KeyA', ctrlKey: false, shiftKey: false });
fire('keydown', untouched);
check(untouched.prevented === undefined, 'unrelated keys are never interfered with');

// The pointer path is still pointer-only: a click that goes nowhere must not record.
inputActions.captured = 0;
render(true, IDLE);
fire('keydown', untouched);
check(inputActions.captured === 0, 'a non-chord key never starts a recording');

//#endregion

//#region the settings page and the configuration behind it

/** Mount the bundle's own page, with the DOM and listener registry reset. */
const mountSettings = () => {
	for (const cleanup of cleanups) cleanup();
	cleanups = [];
	listeners.clear();
	preset = [];
	hookIndex = 0;
	refQueue = [];
	const entry = registrations.get('plugins.bundle.config');
	return entry === undefined ? null : entry.component({ t: undefined });
};

const settingsEntry = registrations.get('plugins.bundle.config');
check(settingsEntry !== undefined, 'the bundle registers a settings page');
check(settingsEntry?.meta.key === '@jryang1997/dsh-hold-to-dictate',
	'the page is keyed by package name, which is what the manager passes down as entryKey');
check(settingsEntry?.meta.locale === 'dsh-hold-to-dictate', 'the page carries its locale namespace');

let page = mountSettings();
check(classes(page).includes('dsh-htt-set'), 'the settings page renders');
check(findAll(page, 'dsh-htt-set-row').length >= 4, 'each setting gets its own row');
check(find(page, 'dsh-htt-set-number').props.value === 300, 'the hold duration starts at its default');
// This harness has no storage at all, so the page below renders the shipped defaults — which
// makes it the one place the documented default can be observed rather than assumed. Live
// dictation is the setting the README promises is off, and it is the one that streams the
// recording to the provider while the user is still talking, so "off" gets an assertion.
check(find(settingRow(page, 'live'), 'dsh-htt-set-toggle').props['aria-pressed'] === 'false',
	'live dictation starts off, as the README promises');

// The field is not a suggestion: a stored or typed value is fitted to the schema.
const typeHold = (value) => find(mountSettings(), 'dsh-htt-set-number').props.onChange({ target: { value } });
typeHold('99999');
check(find(mountSettings(), 'dsh-htt-set-number').props.value === 800, 'a value above the range clamps');
typeHold('10');
check(find(mountSettings(), 'dsh-htt-set-number').props.value === 150, 'a value below the range clamps');
typeHold('nonsense');
check(find(mountSettings(), 'dsh-htt-set-number').props.value === 300, 'a value that is not a number falls back');
typeHold('450');
check(find(mountSettings(), 'dsh-htt-set-number').props.value === 450, 'a value inside the range sticks');

// Motion is a choice, and it reaches the layer as an attribute rather than a re-render.
page = mountSettings();
const chooseIn = (groupKey, text) => {
	const option = findAll(settingRow(page, groupKey), 'dsh-htt-set-segment')
		.find((node) => node.children.includes(text));
	check(option !== undefined, `${groupKey} offers ${JSON.stringify(text)}`);
	option.props.onClick();
};
chooseIn('motion', '精简');
check(find(render(true, IDLE), 'dsh-htt-layer').props['data-motion'] === 'calm',
	'the chosen motion reaches the layer');

// The hint toggle reaches the hint.
page = mountSettings();
find(settingRow(page, 'hint'), 'dsh-htt-set-toggle').props.onClick();
check(attrs(render(true, IDLE), 'data-on').length === 0, 'turning the hint off stops it switching on');
page = mountSettings();
find(settingRow(page, 'hint'), 'dsh-htt-set-toggle').props.onClick();
check(attrs(render(true, IDLE), 'data-on').length === 1, 'and turning it back on brings it back');

// The chord setting has to reach the gesture itself, or it is only a picture of a setting.
page = mountSettings();

/*
 * A missing key renders as the key itself, and this page shipped one: `holdMsLabelHint` reached
 * a released screenshot because the row built its hint key by appending to the *label* key
 * instead of the field's own name. This cannot catch every wrong key, but no string a user is
 * meant to read may look like one.
 */
const rendered = [];
(function walk(node) {
	if (node === null || node === undefined || typeof node === 'boolean') return;
	if (typeof node === 'string' || typeof node === 'number') {
		rendered.push(String(node));
		return;
	}
	if (Array.isArray(node)) {
		for (const child of node) walk(child);
		return;
	}
	for (const child of node.children ?? []) walk(child);
})(page);
const leaked = rendered.filter((text) => /^[a-z]+(?:[A-Z][a-z0-9]+)+$/.test(text));
check(leaked.length === 0,
	`no dictionary key leaks into the settings page (saw ${JSON.stringify(leaked)})`);
check(rendered.some((text) => text.includes('按住多久才开始录音')),
	'and the hold duration shows its real description');

chooseIn('chord', 'Ctrl + Shift + D');
inputActions.captured = 0;
render(true, IDLE);
fire('keydown', key());
check(inputActions.captured === 0, 'the old chord stops working once another is chosen');
fire('keydown', key({ code: 'KeyD', key: 'd' }));
check(inputActions.captured === 1, 'the chosen chord starts a capture');

// Restore defaults puts every one of them back.
page = mountSettings();
find(page, 'dsh-htt-set-reset').props.onClick();
page = mountSettings();
check(find(page, 'dsh-htt-set-number').props.value === 300, 'restore brings the defaults back');
check(find(render(true, IDLE), 'dsh-htt-layer').props['data-motion'] === 'full', 'and the layer follows');
inputActions.captured = 0;
render(true, IDLE);
fire('keydown', key());
check(inputActions.captured === 1, 'and so does the chord');

//#endregion

//#region the microphone glyph

/*
 * The hint's microphone has to be the host's own glyph, not a lookalike: an earlier version
 * drew a filled capsule that sat inches away from the stroked one the host uses in the same
 * row, and the difference was obvious. `MicGlyph` is a function component, so the harness has
 * to invoke it to see what it produces.
 */
const hintNode = find(render(true, IDLE), 'dsh-htt-hint');
const micElement = hintNode.children.find((child) => typeof child?.type === 'function');
const mic = micElement.type(micElement.props);
check(mic.type === 'svg', 'the hint draws a microphone');
check(mic.props.fill === 'none' && mic.props.stroke === 'currentColor',
	'the host draws it stroked, not filled, and this matches');
check(mic.props.strokeWidth === 1, 'at the host stroke weight');
check(mic.children.some((child) => child.type === 'rect') && mic.children.some((child) => child.type === 'path'),
	'as a capsule plus an arc');
check(mic.children.find((child) => child.type === 'path').props.d
	=== 'M2.35 8.675C3.075 11.3 5.2 13.125 8 13.125C10.8 13.125 12.925 11.3 13.65 8.675M8 13.125V15',
	'carrying the host path data verbatim');
// The capsule is expressed in terms of the stroke width, so it must not be frozen at 1 px.
const wide = micElement.type({ size: 16, strokeWidth: 2 });
check(wide.children.find((child) => child.type === 'rect').props.width === 5
	&& wide.children.find((child) => child.type === 'rect').props.rx === 2.5,
	'and its capsule geometry still follows the stroke width');

//#endregion

//#region the injected stylesheet

const css = styleText(render(true, IDLE));
check(typeof css === 'string' && css.length > 1500, 'the component injects a stylesheet');

const count = (text, needle) => text.split(needle).length - 1;
check(count(css, '{') === count(css, '}'), `stylesheet braces balance (${count(css, '{')} blocks)`);
check(count(css, '(') === count(css, ')'), 'stylesheet parens balance');
check(css.includes('stroke-dasharray:97.39'), 'the ring arc carries its real circumference');

// Motion must stay on the host's own vocabulary rather than a parallel one.
check(css.includes('border-radius:var(--dsw-radius-panel)'), 'the panel borrows the composer card radius');
check(css.includes('--dsw-menu-backdrop-filter'), 'the panel borrows the host material recipe');
check(css.includes('--dsw-specific-menu'), 'the panel borrows the host surface fill');
check(css.includes('cubic-bezier(.16,1,.3,1)'), "the entrance uses DSH's own ease-out curve");

// Entry and exit must be transitions, so anything reversed mid-flight retargets.
check(css.includes('@starting-style'), 'entry rides @starting-style');
check(css.includes('[data-leaving]'), 'exit rides a data-leaving transition');
check(!/@keyframes[^{]*\{[^}]*bubble/.test(css), 'the bubble is not animated by keyframes');

// An opacity-animated ancestor creates a backdrop root and clips the glass on entry.
const bubbleRules = [...css.matchAll(/\.dsh-htt-bubble(?:\[data-leaving\])?\{([^}]*)\}/g)];
check(bubbleRules.length > 0 && bubbleRules.every((match) => !/opacity\s*:|(?:transition|will-change):[^;]*opacity/.test(match[1])),
	'the bubble never fades an ancestor of the glass, including calm and reduced motion');
check(rule(css, '.dsh-htt-material{').includes('opacity:1'), 'the glass is visible from its first frame');
check(rule(css, '.dsh-htt-bubble[data-leaving] .dsh-htt-material{').includes('opacity:0'),
	'exit fades the material itself rather than clipping its backdrop');

// Nothing that floats over the transcript may take a click; and a surface that is still
// mounted while it fades must stop accepting input, because `opacity: 0` removes nothing
// from hit testing.
check(rule(css, '.dsh-htt-bubble').includes('pointer-events:none'),
	'the bubble never takes pointer events');
check(rule(css, '.dsh-htt-edge').includes('pointer-events:none'),
	"the card's discard hairline never takes pointer events");
check(rule(css, '.dsh-htt-pending[data-leaving]').includes('pointer-events:none'),
	'the exiting chip does not accept a second click');
check(rule(css, '.dsh-htt-failure').includes('pointer-events:auto'),
	'the failure card accepts the clicks its own buttons need');
check(rule(css, '.dsh-htt-action:focus-visible').includes('outline-style:solid'),
	'the failure actions take keyboard focus visibly');
check(/\.dsh-htt-ring\{[^}]*transition-delay:110ms/.test(css),
	'the press ring waits before appearing, so caret clicks do not flash it');

// The audit's hard rules, enforced rather than remembered.
check(!/transition:[^;]*\bease-in\b/.test(css), 'no transition uses ease-in');
check(!/transition:\s*all/.test(css), 'no transition targets `all`');
check(!/transition:[^;]*\b(width|height|top|left|margin|padding)\b/.test(css), 'no transition animates a layout property');
const loops = (css.match(/animation:(?!none)/g) ?? []).length;
check(loops === 1, `exactly one looping animation, the transcribing dot (found ${loops})`);
check(/\.dsh-htt-mark\[data-state=transcribing\][^{]*\{[^}]*animation/.test(css),
	'that one loop belongs to the transcribing mark, where nothing else is moving');

for (const query of ['prefers-reduced-motion', 'prefers-reduced-transparency', 'prefers-contrast']) {
	check(css.includes(query), `stylesheet honours ${query}`);
}
// Reduced motion keeps opacity and drops movement; it must not delete the feedback.
const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
check(!/transition:none/.test(reduced), 'reduced motion keeps a transition rather than removing it');
check(/opacity 140ms linear/.test(reduced), 'reduced motion still cross-fades');

// The calm setting is the same softening, chosen rather than signalled.
check(css.includes('.dsh-htt-layer[data-motion=calm]'), 'the calm preference has its own rules');
check(rule(css, '.dsh-htt-pill{').includes('var(--dsh-htt-lift,0px)')
	&& !rule(css, '.dsh-htt-pill{').includes('transition:'), 'gesture position follows the pointer without a CSS transition lag');
check(css.includes('var(--dsh-htt-energy,0)'), 'the recording halo responds to microphone energy');
check(rule(css, '.dsh-htt-pill{').includes('max-width:calc(100% - 24px)')
	&& rule(css, '.dsh-htt-row > *').includes('text-overflow:ellipsis'), 'narrow composers constrain and truncate the capsule');
check(css.includes('.dsh-htt-layer[data-motion=calm] .dsh-htt-mark[data-state=transcribing]'),
	'calm also disables the processing loop');

// The hint sits in the tool row, so it has to speak the tool row's typography.
const hintRule = rule(css, '.dsh-htt-hint{');
check(hintRule.includes('font-size:13px') && hintRule.includes('font-weight:400')
	&& hintRule.includes('line-height:20px'),
	'the hint joins the row: 13px / 400 / 20px, exactly what the model selector uses');
check(!hintRule.includes('letter-spacing'), 'and carries no tracking of its own');
// The 500-weight rule in the host's InputBar stylesheet is dead CSS; copying it was a mistake.
check(!hintRule.includes('font-weight:500'), 'and is not weighted like a chip');
check(hintRule.includes('transition:opacity 320ms var(--dsh-htt-in-out)'),
	'the hint softly fades in and out over 320 ms');
check(!rule(css, '.dsh-htt-hint[data-on]{').includes('transition:'),
	'entering and leaving the hint use the same fade duration');
check(find(render(false, IDLE), 'dsh-htt-hint') !== null,
	'the hint stays mounted after pointer leave so its fade can finish');

// The settings page brings its own stylesheet, because it renders in a different slot.
const settingsCss = styleText(mountSettings());
check(typeof settingsCss === 'string' && settingsCss.includes('.dsh-htt-set-row'),
	'the settings page injects its own styles');
check(count(settingsCss, '{') === count(settingsCss, '}'), 'settings stylesheet braces balance');
check(rule(settingsCss, '.dsh-htt-set-number:focus-visible').includes('outline-style:solid'),
	'the settings controls take keyboard focus visibly');

//#endregion

if (failures.length > 0) {
	console.error(`render: ${failures.length} problem(s)`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exit(1);
}
console.log('render: ok (every gesture state mounts; motion rules hold)');
