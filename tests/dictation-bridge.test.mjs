/**
 * The dictation bridge: the cordis service and the degraded DOM channel that another client
 * plugin reads while this one records.
 *
 * No React, no audio and no timers: the mapping is a pure function and the service is a plain
 * store, so a fake context and a fake document are enough to pin the contract. The composer
 * still feeds the store from its own effect, which tests/render.test.mjs and tests/live.test.mjs
 * mount for real.
 *
 * Run with: node tests/dictation-bridge.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Expose the bridge and its mapping only to this harness, without expanding the plugin API.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
	.replace('return { inject, apply };', 'return { inject, apply, createDictationBridge, dictation, dictationFields };');

// The browser has CustomEvent; the harness only needs the payload to be observable.
globalThis.CustomEvent = class CustomEvent {
	constructor(type, init) {
		this.type = type;
		this.detail = init?.detail;
	}
};

//#region a document that dispatches, so the degraded channel is observable

const listeners = new Map();
const dispatched = [];
const fakeDocument = {
	hidden: false,
	addEventListener(type, fn) {
		listeners.set(type, [...listeners.get(type) ?? [], fn]);
	},
	removeEventListener(type, fn) {
		listeners.set(type, (listeners.get(type) ?? []).filter((bound) => bound !== fn));
	},
	dispatchEvent(event) {
		dispatched.push(event);
		for (const fn of [...listeners.get(event.type) ?? []]) fn(event);
		return true;
	},
};
let loaded = null;
const fakeWindow = { __ModuleLoader__: { load(module) { loaded = module; } } };
new Function('window', 'document', 'navigator', source)(fakeWindow, fakeDocument, { language: 'zh-CN' });

const bundle = loaded.factory(() => ({}));
const { createDictationBridge, dictation, dictationFields } = bundle;
const announcements = () => dispatched.filter((event) => event.type === 'dsh:dictation');

assert.equal(
	JSON.stringify(bundle.inject),
	'["slots","locale","remote"]',
	'the hard inject list is unchanged: the service is offered, never required by this plugin',
);

//#endregion

//#region the mapping from the composer's view to the published contract

/** The component's view with every field the mapping reads, so a test names only what it changes. */
const view = (over = {}) => ({
	phase: 'idle', notice: '', tone: 'info', leaving: false, cancelled: false, pending: '',
	pendingLeaving: false, bubbleLeaving: false, arm: null, armLeaving: false, retryable: false,
	elapsed: 0, locked: false, polishing: false, code: null, ...over,
});
const map = (over, sessionId = 'session-1') => dictationFields(view(over), sessionId);

assert.deepEqual(map(), { phase: 'idle', pending: false }, 'an idle composer is idle, and carries no session');
assert.deepEqual(map({ pending: '保留的转写' }), { phase: 'idle', pending: true }, 'a retained transcript is a flag, never the text');
assert.deepEqual(
	map({ arm: { x: 12, y: 20, holdMs: 300 } }),
	{ phase: 'listening', sessionId: 'session-1', pending: false },
	'an armed press is listening before the microphone opens',
);
assert.deepEqual(
	map({ arm: { x: 12, y: 20, holdMs: 300 }, phase: 'recording' }),
	{ phase: 'recording', sessionId: 'session-1', locked: false, cancelArmed: false, pending: false },
	'a live recording outranks the press ring that is still retracting',
);
assert.deepEqual(
	map({ phase: 'recording', locked: true }),
	{ phase: 'recording', sessionId: 'session-1', locked: true, cancelArmed: false, pending: false },
	'hands-free is a recording flag',
);
assert.deepEqual(
	map({ phase: 'recording', cancelled: true }),
	{ phase: 'recording', sessionId: 'session-1', locked: false, cancelArmed: true, pending: false },
	'drag-to-discard is a recording flag',
);
assert.deepEqual(
	map({ phase: 'transcribing' }),
	{ phase: 'processing', sessionId: 'session-1', polishing: false, pending: false },
	'transcribing is processing',
);
assert.deepEqual(
	map({ phase: 'transcribing', polishing: true }),
	{ phase: 'processing', sessionId: 'session-1', polishing: true, pending: false },
	'the polish stage is an extra flag, not a phase',
);
assert.deepEqual(map({ phase: 'complete' }), { phase: 'done', sessionId: 'session-1', pending: false }, 'complete is done');
assert.deepEqual(
	map({ phase: 'notice', code: 'too-short' }),
	{ phase: 'idle', code: 'too-short', pending: false },
	'a notice is idle with a stable code',
);
assert.deepEqual(map({ phase: 'notice' }), { phase: 'idle', code: null, pending: false }, 'a notice without a code is still idle');
assert.deepEqual(
	map({ phase: 'failed', code: 'recognition-failed' }),
	{ phase: 'error', sessionId: 'session-1', code: 'recognition-failed', pending: false },
	'a failure is error with a stable code',
);
assert.deepEqual(map({ phase: 'unknown' }), { phase: 'idle', pending: false }, 'an unknown view phase never reaches the contract');
assert.deepEqual(
	map({ phase: 'recording' }, null),
	{ phase: 'recording', sessionId: null, locked: false, cancelArmed: false, pending: false },
	'an unknown session is null',
);
assert.deepEqual(map({ arm: {} }, ''), { phase: 'listening', sessionId: null, pending: false });

//#endregion

//#region the store behind the service

{
	const bridge = createDictationBridge();
	assert.equal(bridge.schema, 1, 'the bridge states its schema');
	const idle = bridge.getSnapshot();
	assert.equal(idle.schema, 1);
	assert.equal(idle.seq, 0, 'nothing has happened yet');
	assert.equal(idle.phase, 'idle');
	assert.equal(idle.sessionId, null);
	assert.equal(idle.locked, false);
	assert.equal(idle.cancelArmed, false);
	assert.equal(idle.polishing, false);
	assert.equal(idle.pending, false);
	assert.equal(idle.code, null);
	assert.ok(Object.isFrozen(idle), 'the snapshot a consumer reads cannot be mutated');
	assert.equal(bridge.level(), 0, 'nothing is recording');
}

// A transition bumps seq and restarts since; an identical write is a true no-op.
{
	const bridge = createDictationBridge();
	const seen = [];
	bridge.subscribe((snapshot) => seen.push(snapshot));
	const startedAt = Date.now();
	const listening = bridge.update({ phase: 'listening', sessionId: 'session-1' });
	assert.equal(listening.phase, 'listening');
	assert.equal(listening.sessionId, 'session-1');
	assert.equal(listening.seq, 1);
	assert.ok(listening.since >= startedAt && listening.since <= Date.now(), 'the phase clock starts at the transition');
	assert.ok(Object.isFrozen(listening));

	const again = bridge.update({ phase: 'listening', sessionId: 'session-1' });
	assert.equal(again, listening, 'an unchanged write keeps the snapshot reference');
	assert.equal(seen.length, 1, 'and notifies nobody');

	const recording = bridge.update({ phase: 'recording', sessionId: 'session-1', locked: true });
	assert.equal(recording.seq, 2, 'seq counts real transitions only');
	assert.equal(recording.locked, true);
	assert.ok(recording.since >= listening.since);

	const flag = bridge.update({ locked: false });
	assert.equal(flag.phase, 'recording', 'a flag-only write keeps the phase');
	assert.equal(flag.since, recording.since, 'and does not restart its clock');
	assert.equal(seen.length, 3);
}

// level() is a pull: only a recording reads the microphone, and the value is raw.
{
	const bridge = createDictationBridge();
	bridge.bindLevel(() => 0.42);
	bridge.update({ phase: 'listening' });
	assert.equal(bridge.level(), 0, 'no microphone before recording');
	bridge.update({ phase: 'recording' });
	assert.equal(bridge.level(), 0.42);

	bridge.bindLevel(() => 1.7);
	assert.equal(bridge.level(), 1.7, 'the producer does not clamp; the consumer does');
	bridge.update({ phase: 'processing' });
	assert.equal(bridge.level(), 0, 'no level once recording ends');
	bridge.update({ phase: 'recording' });
	assert.equal(bridge.level(), 1.7, 'a later take reads its own microphone again');

	bridge.bindLevel(() => { throw new Error('analyser released'); });
	assert.equal(bridge.level(), 0, 'a released analyser cannot throw into the consumer frame loop');
	bridge.bindLevel(null);
	assert.equal(bridge.level(), 0);
	assert.equal(createDictationBridge().level(), 0, 'an unbound bridge reports silence');
}

// idle() is a transition too, and unsubscribing is safe however often it is called.
{
	const bridge = createDictationBridge();
	const seen = [];
	const unsubscribe = bridge.subscribe((snapshot) => seen.push(snapshot));
	assert.equal(unsubscribe(), true);
	assert.equal(unsubscribe(), false, 'unsubscribing twice is a no-op');
	bridge.update({ phase: 'listening' });
	assert.equal(seen.length, 0, 'an unsubscribed listener is not called');

	const calls = [];
	bridge.subscribe((snapshot) => calls.push(snapshot));
	bridge.update({ phase: 'recording', sessionId: 'session-1' });
	bridge.idle();
	assert.equal(calls.at(-1).phase, 'idle');
	assert.equal(calls.at(-1).sessionId, null, 'idle is not tied to a session');
	const settled = calls.length;
	bridge.idle();
	assert.equal(calls.length, settled, 'an already-idle bridge does not announce again');

	bridge.dispose();
	bridge.update({ phase: 'listening' });
	assert.equal(calls.length, settled, 'a disposed bridge keeps no subscribers');
}

//#endregion

//#region the degraded DOM channel

{
	dispatched.length = 0;
	const bridge = createDictationBridge();
	bridge.update({ phase: 'listening', sessionId: 'session-1' });
	const events = announcements();
	assert.equal(events.length, 1, 'a transition reaches the degraded channel');
	assert.equal(events[0].detail.phase, 'listening');
	assert.equal(events[0].detail.sessionId, 'session-1');
	bridge.update({ phase: 'listening', sessionId: 'session-1' });
	assert.equal(announcements().length, 1, 'an unchanged write is not announced again');
	bridge.announce();
	assert.equal(announcements().length, 2, 'a request answer re-sends the current snapshot');
	assert.equal(announcements()[1].detail, events[0].detail, 'and it is the same frozen object');
}

//#endregion

//#region apply() provides the service and owns the degraded request channel

/**
 * The cordis context this producer actually uses: a service registry and effects. `inject` is
 * left inert because the bridge is provided outside every injection, which is the point.
 */
function makeContext({ foreign } = {}) {
	const services = new Map();
	if (foreign !== undefined) services.set('dictation', foreign);
	const cleanups = [];
	const ctx = {
		get: (name) => services.get(name),
		provide(name, value) {
			if (services.has(name)) throw new Error('service "' + name + '" has been registered');
			services.set(name, value);
			return () => services.delete(name);
		},
		effect(fn) {
			const cleanup = fn();
			if (typeof cleanup === 'function') cleanups.push(cleanup);
			return cleanup;
		},
		inject() { /* the service must not depend on another injection */ },
		locale: { register: () => undefined },
	};
	return { ctx, services, cleanups };
}

{
	const { ctx, services, cleanups } = makeContext();
	bundle.apply(ctx);

	const face = services.get('dictation');
	assert.ok(face !== undefined, 'the service is provided even when no speech injection ran');
	assert.deepEqual(
		Object.keys(face).sort(),
		['getSnapshot', 'level', 'schema', 'subscribe'],
		'the face is exactly the agreed four members',
	);
	assert.equal(face.schema, 1);
	const initial = face.getSnapshot();
	assert.equal(initial.schema, 1);
	assert.equal(initial.phase, 'idle', 'the service starts idle with no composer mounted');
	assert.ok(Object.isFrozen(initial));

	const seen = [];
	face.subscribe((snapshot) => seen.push(snapshot));
	dictation.update(dictationFields(view({ phase: 'recording', locked: true }), 'session-1'));
	assert.equal(seen.length, 1);
	assert.equal(seen[0].phase, 'recording', 'the service carries what the composer publishes');
	assert.equal(face.getSnapshot(), seen[0], 'getSnapshot returns the same reference the listener saw');
	assert.equal(face.level(), 0, 'no capture is bound in this harness');

	dispatched.length = 0;
	fakeDocument.dispatchEvent({ type: 'dsh:dictation:request' });
	assert.deepEqual(
		announcements().map((event) => event.detail.phase),
		['recording'],
		'a degraded consumer asks and gets the current snapshot back',
	);

	// Unload: final idle first, then the service and the request listener go away.
	dispatched.length = 0;
	seen.length = 0;
	for (const cleanup of cleanups) cleanup();
	assert.equal(seen.at(-1)?.phase, 'idle', 'a subscriber still attached during unload sees the final idle');
	assert.equal(face.getSnapshot().phase, 'idle', 'the disposer publishes a final idle snapshot');
	assert.equal(services.has('dictation'), false, 'then removes the service');
	assert.deepEqual(
		announcements().map((event) => event.detail.phase),
		['idle'],
		'and the degraded channel heard that last idle',
	);
	assert.equal(listeners.get('dsh:dictation:request')?.length ?? 0, 0, 'and stops answering the request channel');
}

// A native (or otherwise earlier) implementation wins the name; the bridge only logs once.
{
	const foreign = { schema: 1, getSnapshot: () => ({ phase: 'idle' }), subscribe: () => () => {}, level: () => 0 };
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => warnings.push(args);
	try {
		for (const label of ['first', 'second']) {
			const { ctx, services } = makeContext({ foreign });
			bundle.apply(ctx);
			assert.equal(services.get('dictation'), foreign, 'a foreign implementation is left in place (' + label + ' apply)');
		}
	} finally {
		console.warn = originalWarn;
	}
	const logged = warnings.filter((args) => String(args[0]).includes('another "dictation" service'));
	assert.equal(logged.length, 1, 'a foreign implementation is reported once, not once per apply');
	assert.equal(listeners.get('dsh:dictation:request')?.length ?? 0, 0, 'and no request listener is left behind');
}

//#endregion

console.log('dictation-bridge: ok');
