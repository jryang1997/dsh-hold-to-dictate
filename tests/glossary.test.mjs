/**
 * Project glossary: what `glossaryTerms` mines from GLOSSARY.md / CONTEXT.md / AGENTS.md,
 * and how `loadGlossary` reads, merges and caches the result per session.
 *
 * The parser is pure and the loader is module-level, so this loads client.js exactly the
 * way the DSH module loader does (the same trick as tests/render.test.mjs) and drives the
 * internals through a fake `runtime.workspaceFiles`. No Host, no dependencies.
 *
 * Run with: node tests/glossary.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// Expose the glossary internals only to this harness, without expanding the plugin API.
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
	.replace('return { inject, apply };', 'return { inject, apply, glossaryTerms, loadGlossary, runtime, GLOSSARY_FILES, config };');

let loaded = null;
/** Timers are recorded, never fired: the read deadline is asserted, not waited out. */
const timeouts = [];
const clearedTimers = new Set();
let timerId = 0;
const fakeWindow = {
	__ModuleLoader__: { load: (module) => { loaded = module; } },
	setTimeout: (fn, ms) => {
		timerId += 1;
		timeouts.push({ id: timerId, fn, ms });
		return timerId;
	},
	clearTimeout: (id) => clearedTimers.add(id),
	addEventListener: () => undefined,
	removeEventListener: () => undefined,
};
new Function('window', 'navigator', source)(fakeWindow, { language: 'zh-CN' });

const bundle = loaded.factory((name) => {
	if (name === 'react') return { createElement: () => { throw new Error('nothing renders here'); } };
	throw new Error(`unexpected require(${JSON.stringify(name)})`);
});
const { glossaryTerms, loadGlossary, runtime, GLOSSARY_FILES, config } = bundle;

assert.deepEqual(GLOSSARY_FILES, ['GLOSSARY.md', 'CONTEXT.md', 'AGENTS.md'], 'the candidate files, in priority order');
assert.equal(config.get('glossary'), true, 'the project glossary is on by default');

//#region glossaryTerms

// A Matt-style GLOSSARY.md: a term column plus meanings, over a header and a separator row.
assert.deepEqual(glossaryTerms([
	'# Glossary',
	'',
	'| Term | Meaning |',
	'|---|---|',
	'| **DSH** | DeepSeek Harness, the host app. |',
	'| **Owned range** | The draft range a take writes into. |',
	'| Live preview | An opt-in, provisional transcript shown while the hold continues. |',
].join('\n')), ['DSH', 'Owned range', 'Live preview'], 'the first column only, header and separator filtered');

// The repo's own CONTEXT.md table: bolded first cells, long second cells.
assert.deepEqual(glossaryTerms([
	'| Term | Meaning |',
	'|---|---|',
	'| **Hold** | Press and keep holding inside the composer card. The gesture arms at the hold threshold and disarms if the pointer moves more than 10 px first. |',
	'| **Take** | One recording, from the start of a hold to release or cancel. Every piece of per-recording state belongs to a take. |',
].join('\n')), ['Hold', 'Take'], 'the repo\'s own context table parses');

// AGENTS.md-style bold leads: whatever follows the bold close is ignored.
assert.deepEqual(glossaryTerms([
	'- **Glossary**: terms the project corrects dictation against',
	'* **Vocabulary** — the user\'s own term list',
	'- plain item without a bold lead',
	'1. **Ordered** lists are not a bold lead either',
].join('\n')), ['Glossary', 'Vocabulary'], 'bold list leads only');

// Dedupe is case-insensitive and keeps the first spelling seen.
assert.deepEqual(glossaryTerms('| DSH | host |\n| dsh | again |\n| DSH | once more |'), ['DSH'],
	'case-insensitive dedupe keeps the first spelling');

// The generic header cells never become terms, in either language.
const headerCells = ['Term', 'Word', 'Name', 'Key', '术语', '词语', '名词', '名称']
	.map((cell) => `| ${cell} | x |`).join('\n');
assert.deepEqual(glossaryTerms(headerCells), [], 'generic header cells never become terms');

// Wrappers are stripped, whitespace collapsed, and only 1..40 characters kept.
assert.deepEqual(
	glossaryTerms('| `Backtick` | wrapped |\n| **Bold** | wrapped |\n| Two  spaces | collapsed |'),
	['Backtick', 'Bold', 'Two spaces'], 'backtick and bold wrappers stripped, whitespace collapsed');
assert.deepEqual(glossaryTerms(`| ${'x'.repeat(41)} | too long |`), [], 'a 41-char candidate is dropped, not cut');
assert.deepEqual(glossaryTerms('|   | only the second cell has text |'), [], 'an empty first cell is no term');

// The cap: 40 terms of the parser's own, taken in file order.
{
	const capped = glossaryTerms(Array.from({ length: 45 }, (_, index) => `| term${index} | meaning |`).join('\n'));
	assert.equal(capped.length, 40, 'the parser caps at its own 40 terms');
	assert.deepEqual(capped.slice(0, 2), ['term0', 'term1'], 'capped in file order');
	assert.equal(capped.includes('term44'), false, 'beyond the cap is dropped');
}

//#endregion

//#region loadGlossary

/** A fake workspaceFiles.read serving per-file texts, with optional per-file failures. */
const filesOf = (texts, { reject = [] } = {}) => {
	const calls = [];
	return {
		calls,
		read: async (sessionId, path, options, signal) => {
			calls.push({ sessionId, path, options, signal });
			if (reject.includes(path)) throw new Error('unreadable');
			const text = texts[path];
			return text === undefined ? {} : { text, eof: true };
		},
	};
};

// Success merges in file order, deduped across files.
runtime.workspaceFiles = filesOf({
	'GLOSSARY.md': '| **DSH** | the host |\n| **Shared** | the glossary already lists it |',
	'CONTEXT.md': '| **Shared** | the glossary already has it |',
	'AGENTS.md': '- **Pstack**: model routing',
});
assert.equal(await loadGlossary('session-a'), 'DSH\nShared\nPstack', 'terms merge in file order, deduped');
assert.deepEqual(runtime.workspaceFiles.calls[0].options, { limit: 120 }, 'only the head of each file is asked for');
assert.deepEqual(runtime.workspaceFiles.calls.map((call) => call.path), GLOSSARY_FILES,
	'each candidate file is read once, in order');

// A hit inside the TTL reads nothing again; the cache is per session.
const readsAfterFirst = runtime.workspaceFiles.calls.length;
assert.equal(await loadGlossary('session-a'), 'DSH\nShared\nPstack', 'the cached value repeats');
assert.equal(runtime.workspaceFiles.calls.length, readsAfterFirst, 'a hit inside the TTL reads nothing');
await loadGlossary('session-b');
assert.equal(runtime.workspaceFiles.calls.length, readsAfterFirst + GLOSSARY_FILES.length,
	'another session reads the files again');

// Each read owns a deadline, and each deadline is cleared once its read settles.
const lastTimers = timeouts.slice(-GLOSSARY_FILES.length);
assert.ok(lastTimers.every((entry) => entry.ms === 2000), 'every read carries the 2000 ms deadline');
assert.ok(lastTimers.every((entry) => clearedTimers.has(entry.id)), 'and every deadline is cleared when its read settles');

// A rejecting read is skipped; the files around it still count.
runtime.workspaceFiles = filesOf({
	'GLOSSARY.md': '| **DSH** | the host |',
	'CONTEXT.md': '| **Context term** | x |',
}, { reject: ['GLOSSARY.md'] });
assert.equal(await loadGlossary('session-c'), 'Context term', 'a rejecting file is skipped silently');

// Every read failing yields '' — and is not cached, so the next polish tries again.
runtime.workspaceFiles = filesOf({}, { reject: GLOSSARY_FILES });
assert.equal(await loadGlossary('session-d'), '', 'all reads failing yields the empty string');
const failingReads = runtime.workspaceFiles.calls.length;
assert.equal(await loadGlossary('session-d'), '');
assert.equal(runtime.workspaceFiles.calls.length, failingReads + GLOSSARY_FILES.length,
	'an empty result is re-read rather than cached');

// A read without text is one more way a file says nothing.
runtime.workspaceFiles = { read: async () => ({ eof: true }) };
assert.equal(await loadGlossary('session-e'), '', 'a result without text is skipped');

// No workspace service at all: never a throw, just no glossary.
runtime.workspaceFiles = null;
assert.equal(await loadGlossary('session-f'), '', 'a missing service means no glossary');

// The per-file deadline really cancels its own read, without failing the whole load.
runtime.workspaceFiles = {
	read: (_sessionId, _path, _options, signal) => new Promise((_resolve, reject) => {
		signal.addEventListener('abort', () => reject(signal.reason), { once: true });
	}),
};
const hung = loadGlossary('session-g');
for (let file = 0; file < GLOSSARY_FILES.length; file += 1) {
	timeouts.at(-1).fn();
	for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}
assert.equal(await hung, '', 'a read that never answers is abandoned by its deadline');
runtime.workspaceFiles = null;

//#endregion

//#region the call site, checked in the source

// Like the REASONING_PROBE_MS copy check in tests/polish.test.mjs: the harness above proves
// the helpers work; this proves the polish block still asks for them.
{
	const client = readFileSync(join(here, '..', 'client.js'), 'utf8');
	assert.match(client,
		/if \(config\.get\('glossary'\)[\s\S]{0,400}?await loadGlossary\(latest\.current\.props\.sessionId, abort\.signal\);[\s\S]{0,300}?polishTranscript\(transcript, vocabulary, context, abort\.signal\)/,
		'the polish block reads the project glossary and merges it into the vocabulary');
	assert.match(client, /inject: \(sessionId\) => \(\{[\s\S]{0,200}?sessionId,\s*\}\)/,
		'the slot passes its session id through to the entry');
	assert.match(client, /ctx\.inject\(\['remote\.workspaceFiles'\]/,
		'the workspace service is injected on its own, so its absence stays harmless');
}

//#endregion

console.log('glossary: ok');
