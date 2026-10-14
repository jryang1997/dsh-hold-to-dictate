/**
 * The live-preview plan, tested on its own: which slice of the take the next preview reads,
 * what the draft shows once it answers, and how long to wait before asking again.
 *
 * No audio, no React, no timers — the plan is pure, so a take is just a sequence of calls.
 *
 * Run with: node tests/plan.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Expose the plan only to this harness, without expanding the plugin API.
const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
	.replace('return { inject, apply };', 'return { inject, apply, createLivePlan };');
let loaded = null;
new Function('window', source)({ __ModuleLoader__: { load(module) { loaded = module; } } });
const { createLivePlan } = loaded.factory(() => ({}));
const none = () => { throw new Error('an unsegmented take never asks for a pause'); };

// A short take is read whole every time, and its transcript is the text.
{
	const plan = createLivePlan();
	assert.equal(plan.wait, 120, 'the first preview comes early');
	const window = plan.next(none);
	assert.deepEqual([window.from, window.to], [0, null], 'an unsegmented take is read from zero to now');
	assert.equal(plan.read(window, '你好', 2), '你好');
	assert.equal(plan.read(plan.next(none), '你好世界', 3), '你好世界', 'a whole-take read replaces, never appends');
}

// The cadence follows the Host: a reply's own round trip sets the next wait.
{
	const plan = createLivePlan();
	assert.equal(Math.round(plan.settle('ok', 400)), 60, 'interval is 1.15 × the round trip, minus the time already spent');
	assert.equal(plan.settle('ok', 100), 150, 'a fast Host is held to the 250 ms floor');
	assert.equal(plan.settle('wait', 10), 120, 'a starved preview retries soon');
}

// A failure backs off, doubling up to a ceiling.
{
	const plan = createLivePlan();
	const waits = [1, 2, 3, 4, 5].map(() => plan.settle('failed', 0));
	assert.deepEqual(waits, [500, 1000, 2000, 2500, 2500]);
	assert.equal(plan.settle('ok', 100), 150, 'one good reply ends the backoff');
}

// Starving is a reason to come back, until it has gone on too long.
{
	const plan = createLivePlan();
	for (let i = 0; i < 12; i++) assert.equal(plan.starve(null), 'wait');
	assert.equal(plan.starve(null), 'stop', 'the thirteenth empty snapshot gives up');
	const fed = createLivePlan();
	for (let i = 0; i < 12; i++) fed.starve(null);
	assert.equal(fed.starve({}), null, 'audio arriving clears the count');
	assert.equal(fed.starve(null), 'wait');
}

// A long take commits at sentence pauses and reads forward from there.
{
	const plan = createLivePlan();
	plan.read(plan.next(none), '第一句', 2);
	plan.settle('ok', 800);

	const early = plan.next(() => 2.5);
	assert.deepEqual([early.from, early.to], [0, null], 'a pause under a second past the anchor is not a commit point');
	assert.equal(plan.read(early, '第一句话', 3), '第一句话');

	const first = plan.next(() => 4.5);
	assert.deepEqual([first.from, first.to], [0, 4.5], 'the first commit still covers the whole take');
	assert.equal(plan.read(first, '第一句话。第二句。', 5), '第一句话。第二句。', 'the first commit replaces');

	const tail = plan.next(() => 4.5);
	assert.deepEqual([tail.from, tail.to], [4.5, null], 'after a commit only the new words are read');
	assert.equal(plan.read(tail, '第三', 6), '第一句话。第二句。第三', 'new words follow the committed ones');

	const second = plan.next(() => 7);
	assert.deepEqual([second.from, second.to], [4.5, 7]);
	assert.equal(plan.read(second, '第三句。', 7), '第一句话。第二句。第三句。', 'a later commit appends');
	const after = plan.next(() => 7);
	assert.deepEqual([after.from, after.to], [7, null]);
}

// A take that stays short is never segmented, however many previews it gets.
{
	const plan = createLivePlan();
	for (let i = 0; i < 5; i++) { plan.read(plan.next(none), 'x', i); plan.settle('ok', 700); }
	assert.deepEqual([plan.next(none).from, plan.next(none).to], [0, null], 'exactly 700 ms is not yet expensive');
}

console.log('plan: ok');
