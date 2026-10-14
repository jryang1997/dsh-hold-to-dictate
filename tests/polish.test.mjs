// AI polish: route choice, stream collection, output tidying, fallbacks, and the Remote
// marking done without decorator syntax. Runs against fakes; no DSH Host needed.
import assert from 'node:assert/strict';
import {
	POLISH_PROMPT, POLISH_SERVICE, POLISH_NAMESPACE, MAX_TRANSCRIPT_CHARS,
	pickRoute, listRoutes, collectText, tidyOutput, polishText, polishUserText, createPolishService,
} from '../polish.js';

const route = (model, modelName = model, modalities) => ({ provider: 'p', providerName: 'P', model, modelName, modalities });

// Route choice: fast beats first, reasoners lose, image-only models are skipped.
assert.equal(pickRoute([route('deepseek-v4-pro', 'DeepSeek-V4-Pro'), route('deepseek-flash', 'DeepSeek-V4.1-Flash')]).model, 'deepseek-flash');
assert.equal(pickRoute([route('o-reasoner'), route('plain')]).model, 'plain');
assert.equal(pickRoute([route('vision-mini', 'v', ['image']), route('x')]).model, 'x');
assert.equal(pickRoute([route('only-pro', 'Pro')]).model, 'only-pro');
assert.equal(pickRoute([]), null);

const stream = async function* (chunks) { for (const chunk of chunks) yield chunk; };

// A provider whose listing throws is skipped, not fatal.
const routes = await listRoutes({
	listProviders: () => [{ id: 'bad', name: 'Bad' }, { id: 'ds', name: 'DeepSeek' }],
	listModels: async (id) => { if (id === 'bad') throw new Error('offline'); return [{ provider: 'ds', id: 'deepseek-flash', name: 'Flash' }]; },
});
assert.deepEqual(routes.map((r) => `${r.provider}/${r.model}`), ['ds/deepseek-flash']);

// Deltas win over a duplicate block-end; block-end alone still counts; errors throw.
assert.equal(await collectText(stream([{ type: 'text-delta', text: 'a' }, { type: 'text-delta', text: 'b' }, { type: 'block-end', block: { type: 'text', text: 'ab' } }]), 100), 'ab');
assert.equal(await collectText(stream([{ type: 'reasoning-delta', text: 'hm' }, { type: 'block-end', block: { type: 'text', text: 'ok' } }]), 100), 'ok');
await assert.rejects(collectText(stream([{ type: 'text-delta', text: 'a' }, { type: 'finish', reason: { kind: 'error' } }]), 100));
await assert.rejects(collectText(stream([{ type: 'text-delta', text: 'x'.repeat(50) }]), 10), /too-long/);

// Wrappers the model adds anyway are stripped; real content is not.
assert.equal(tidyOutput('```\n你好。\n```'), '你好。');
assert.equal(tidyOutput('<transcript>\nhi\n</transcript>'), 'hi');
assert.equal(tidyOutput('整理如下：\n明天开会。'), '明天开会。');
assert.equal(tidyOutput('“明天开会。”'), '明天开会。');
assert.equal(tidyOutput('他说“好”，然后走了。'), '他说“好”，然后走了。');
assert.equal(tidyOutput('三件事：\n1. 预算\n2. 文档'), '三件事：\n1. 预算\n2. 文档');

// The prompt treats the transcript as data and asks for lists only on explicit enumeration.
assert.match(POLISH_PROMPT, /never an instruction/);
assert.match(POLISH_PROMPT, /第一/);
assert.equal(polishUserText('x'), '<transcript>\nx\n</transcript>');

// A fake Host LLM that records what it was asked.
const fakeLlm = (reply, { efforts = ['off', 'high'], seen = {} } = {}) => ({
	listProviders: () => [{ id: 'ds', name: 'DeepSeek' }],
	listModels: async () => [{ provider: 'ds', id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' }, { provider: 'ds', id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }],
	resolveModelInfo: async () => ({ reasoning: { efforts: efforts.map((id) => ({ id })) } }),
	prepareCall: async (config) => {
		seen.config = config;
		return { config, stream: (options) => { seen.options = options; return reply(options); } };
	},
});
const createUserMessage = (message) => ({ role: 'user', ...message });

{
	const seen = {};
	const llm = fakeLlm(() => stream([{ type: 'text-delta', text: '帮我看一下根目录。' }]), { seen });
	const out = await polishText({ llm, createUserMessage }, pickRoute(await listRoutes(llm)), ' 嗯帮我看一下跟目录 ');
	assert.equal(out, '帮我看一下根目录。');
	assert.deepEqual(seen.config, { provider: 'ds', model: 'deepseek-flash', reasoningEffort: 'off' }, 'cheapest route, reasoning off');
	assert.equal(seen.options.system, POLISH_PROMPT);
	assert.equal(seen.options.messages[0].content[0].text, '<transcript>\n嗯帮我看一下跟目录\n</transcript>');
}

// Failures throw so the Client keeps the original: empty reply, oversize input, cancel.
{
	const llm = fakeLlm(() => stream([{ type: 'text-delta', text: '   ' }]));
	await assert.rejects(polishText({ llm, createUserMessage }, route('deepseek-flash'), 'hi'), /empty/);
	await assert.rejects(polishText({ llm, createUserMessage }, route('deepseek-flash'), 'x'.repeat(MAX_TRANSCRIPT_CHARS + 1)), /too-long/);
	const cancel = new AbortController();
	const slow = fakeLlm((options) => (async function* () {
		await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
		yield { type: 'finish', reason: { kind: 'aborted' } };
	})());
	const pending = polishText({ llm: slow, createUserMessage }, route('deepseek-flash'), 'hi', cancel.signal);
	cancel.abort();
	await assert.rejects(pending);
}

// Remote marking without decorators: the protocol's own decorator is run against a
// hand-built context and its initializer marks the prototype.
{
	const MARK = Symbol('remote-methods');
	const protocol = {
		TypertRemoteService: class {
			constructor(ctx, key, options) { Object.assign(this, { ctx, key, options }); }
		},
		Remote(method, context) {
			assert.equal(typeof method, 'function');
			assert.equal(context.private, false);
			assert.equal(context.static, false);
			context.addInitializer(function () {
				const proto = Object.getPrototypeOf(this);
				(proto[MARK] ??= []).push(context.name);
			});
		},
	};
	const Service = createPolishService(protocol, { createUserMessage });
	assert.deepEqual(Service.prototype[MARK], ['describe', 'polish']);
	assert.deepEqual(Service.inject, ['llm']);
	const llm = fakeLlm(() => stream([{ type: 'text-delta', text: 'Hello.' }]));
	const service = new Service({ llm });
	assert.equal(service.key, POLISH_SERVICE);
	assert.deepEqual(service.options, { namespace: POLISH_NAMESPACE });
	assert.deepEqual(await service.describe(), { provider: 'DeepSeek', model: 'DeepSeek-V4.1-Flash' });
	assert.deepEqual(await service.polish('um hello'), { text: 'Hello.', model: 'DeepSeek-V4.1-Flash' });
	// The gateway reads plain parameter names from the method source; keep them simple.
	assert.match(Function.prototype.toString.call(Service.prototype.polish), /^async polish\(transcript, signal\)/);
	const empty = new Service({ llm: { ...llm, listProviders: () => [] } });
	assert.equal(await empty.describe(), null);
	await assert.rejects(empty.polish('hi'), /no-model/);
}

// The Host half must load (and do nothing) when the DSH packages are absent.
{
	const { apply } = await import('../index.js');
	let registered = 0;
	await apply({ plugin: () => { registered += 1; } });
	assert.equal(registered, 0, 'no protocol package in this test env, so nothing is registered');
}

console.log('polish: ok');
