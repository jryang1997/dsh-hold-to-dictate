// AI polish: route choice, stream collection, output tidying, fallbacks, and the Remote
// marking done without decorator syntax. Runs against fakes; no DSH Host needed.
import assert from 'node:assert/strict';
import {
	POLISH_PROMPT, POLISH_SERVICE, POLISH_NAMESPACE, MAX_TRANSCRIPT_CHARS,
	pickRoute, rankRoutes, polishCandidates, failureReason, isOfficial, listRoutes, collectText, tidyOutput, polishText, polishUserText, createPolishService,
} from '../polish.js';

const route = (model, modelName = model, modalities) => ({ provider: 'p', providerName: 'P', model, modelName, modalities });

// Route choice: fast beats first, reasoners lose, image-only models are skipped.
assert.equal(pickRoute([route('deepseek-v4-pro', 'DeepSeek-V4-Pro'), route('deepseek-flash', 'DeepSeek-V4.1-Flash')]).model, 'deepseek-flash');
assert.equal(pickRoute([route('o-reasoner'), route('plain')]).model, 'plain');
assert.equal(pickRoute([route('vision-mini', 'v', ['image']), route('x')]).model, 'x');
assert.equal(pickRoute([route('only-pro', 'Pro')]).model, 'only-pro');
assert.equal(pickRoute([]), null);

// Official DeepSeek providers win over third-party gateways serving the same model.
{
	const gateway = { provider: 'bai', providerName: 'B.AI', model: 'deepseek-flash', modelName: 'DeepSeek V4.1 Flash (B.AI)' };
	const official = { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-flash', modelName: 'DeepSeek-V4.1-Flash' };
	const pro = { provider: 'deepseek-official', providerName: 'DeepSeek', model: 'deepseek-v4-pro', modelName: 'DeepSeek-V4-Pro' };
	assert.ok(isOfficial(official) && !isOfficial(gateway));
	assert.equal(pickRoute([gateway, pro, official]), official);
	// Even a slow official model beats a fast gateway: it can switch reasoning off.
	assert.equal(pickRoute([gateway, pro]), pro);
	assert.deepEqual(rankRoutes([gateway, pro, official]), [official, pro, gateway]);
	// Candidates: the user's choice first, then the ranking, capped at two attempts.
	assert.deepEqual(polishCandidates([gateway, pro, official], 'bai/deepseek-flash'), [gateway, official]);
	assert.deepEqual(polishCandidates([gateway, pro, official], ''), [official, pro]);
	assert.deepEqual(polishCandidates([gateway, pro, official], 'gone/model'), [official, pro]);
	assert.deepEqual(polishCandidates([], 'x'), []);
	assert.equal(failureReason(new Error('polish/timeout')), 'timeout');
	assert.equal(failureReason(new Error('401 Unauthorized')), 'model-error');
	assert.equal(failureReason(undefined), 'model-error');
}

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
		// Same rule as the Host's prepared call: stream options must carry the prepared
		// controls unchanged, or the dispatch is refused.
		return { config, stream: (options) => {
			for (const key of ['provider', 'model', 'reasoningEffort', 'temperature', 'maxTokens']) {
				if (options[key] !== config[key]) throw new Error('prepared LLM call config changed before adapter dispatch');
			}
			seen.options = options;
			return reply(options);
		} };
	},
});
const createUserMessage = (message) => ({ role: 'user', ...message });

{
	const seen = {};
	const llm = fakeLlm(() => stream([{ type: 'text-delta', text: '帮我看一下根目录。' }]), { seen });
	const out = await polishText({ llm, createUserMessage }, pickRoute(await listRoutes(llm)), ' 嗯帮我看一下跟目录 ');
	assert.equal(out, '帮我看一下根目录。');
	assert.deepEqual(seen.config, { provider: 'ds', model: 'deepseek-flash', reasoningEffort: 'off', temperature: 0 }, 'cheapest route, reasoning off, temperature pinned in the prepared config');
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
	const about = await service.describe();
	assert.equal(about.provider, 'DeepSeek');
	assert.equal(about.model, 'DeepSeek-V4.1-Flash');
	assert.ok(about.routes.some((route) => route.key === about.key), 'the automatic pick is one of the listed routes');
	assert.deepEqual(await service.polish('um hello'), { text: 'Hello.', model: 'DeepSeek-V4.1-Flash' });
	// The gateway reads plain parameter names from the method source; keep them simple.
	assert.match(Function.prototype.toString.call(Service.prototype.polish), /^async polish\(transcript, vocabulary, context, model, signal\)/);
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

// Lists are laid out by code, not the model: explicit ordinals only, in order.
{
	const { structureList: list, strayed: off } = await import('../polish.js');
	assert.equal(list('明天要确认三件事：第一，预算；第二，接口文档；第三，上线时间。'), '明天要确认三件事：\n1. 预算\n2. 接口文档\n3. 上线时间');
	assert.equal(list('我有两点意见：第一点是预算不够，第二点是时间太紧。其他的明天再说。'), '我有两点意见：\n1. 预算不够\n2. 时间太紧\n\n其他的明天再说。');
	assert.equal(list('首先打开设置，其次找到插件，最后点安装。'), '1. 打开设置\n2. 找到插件\n3. 点安装');
	assert.equal(list('一是成本高，二是周期长。'), '1. 成本高\n2. 周期长');
	assert.equal(list('Two things: first, update the docs; second, bump the version. Thanks.'), 'Two things:\n1. Update the docs\n2. Bump the version\n\nThanks.');
	for (const plain of ['这是我第一次来，第二天就走了。', '他是第一名。', 'First of all I think it works.', '只有第一点重要。']) {
		assert.equal(list(plain), plain, `not a list: ${plain}`);
	}
	// Straying: fixing a word and deleting fillers is fine; rewriting is not.
	assert.equal(off('嗯那个帮我看一下跟目录下面的西克瑞特 key', '帮我看一下根目录下面的 secret key。'), false);
	assert.equal(off('嗯嗯就是那个我觉得还行吧', '我觉得还行吧。'), false);
	assert.equal(off('我们下周三和老王对一下进度', '下周三与王先生同步项目进展情况。'), true);
	// A strayed reply is refused, so the Client inserts the original.
	const llm = fakeLlm(() => stream([{ type: 'text-delta', text: '完全不同的一句话，跟原文毫无关系。' }]));
	await assert.rejects(polishText({ llm, createUserMessage }, route('deepseek-flash'), '我们下周三和老王对一下进度'), /strayed/);
	// The model's ordinals are laid out after it replies, and temperature is pinned.
	const seen = {};
	const lister = fakeLlm(() => stream([{ type: 'text-delta', text: '两件事：第一，预算；第二，文档。' }]), { seen });
	assert.equal(await polishText({ llm: lister, createUserMessage }, route('deepseek-flash'), '两件事第一预算第二文档'), '两件事：\n1. 预算\n2. 文档');
	assert.equal(seen.options.temperature, 0);
}

// Vocabulary: parsed, deduped, capped, and only added to the prompt when given.
{
	const { parseVocabulary, systemPrompt, MAX_VOCAB_TERMS } = await import('../polish.js');
	assert.deepEqual(parseVocabulary('Claude Code， DSH、根目录\nToken; dsh ;; '), ['Claude Code', 'DSH', '根目录', 'Token']);
	assert.deepEqual(parseVocabulary(undefined), []);
	assert.deepEqual(parseVocabulary('x'.repeat(41)), [], 'over-long terms are dropped, not cut');
	assert.equal(parseVocabulary(Array.from({ length: 99 }, (_, i) => `t${i}`).join(',')).length, MAX_VOCAB_TERMS);
	assert.equal(systemPrompt([]), POLISH_PROMPT);
	assert.match(systemPrompt(['Claude Code']), /- Claude Code\n/);
	// The service forwards the user's terms into the system prompt.
	const seen = {};
	const Service = createPolishService({
		TypertRemoteService: class { constructor(ctx) { this.ctx = ctx; } },
		Remote: () => {},
	}, { createUserMessage });
	const service = new Service({ llm: fakeLlm(() => stream([{ type: 'text-delta', text: '用 Claude Code 打开。' }]), { seen }) });
	assert.deepEqual(await service.polish('用克劳德叩打开', 'Claude Code', '', '', undefined), { text: '用 Claude Code 打开。', model: 'DeepSeek-V4.1-Flash' });
	assert.match(seen.options.system, /# The user's vocabulary\n[\s\S]*- Claude Code/);
}

// Draft context: the tail before the cursor goes in its own block, never in the output.
{
	const { draftContext, MAX_CONTEXT_CHARS } = await import('../polish.js');
	assert.equal(draftContext('  上文  '), '上文');
	assert.equal(draftContext(undefined), '');
	const long = `${'旧'.repeat(500)}\n${'新'.repeat(300)}`;
	assert.equal(draftContext(long), '新'.repeat(300), 'cut at a line start when one is near');
	assert.ok(draftContext('字'.repeat(900)).length <= MAX_CONTEXT_CHARS);
	assert.equal(polishUserText('说的话'), '<transcript>\n说的话\n</transcript>');
	assert.equal(polishUserText('说的话', '上文'), '<context>\n上文\n</context>\n<transcript>\n说的话\n</transcript>');
	assert.match(POLISH_PROMPT, /# Context\n[\s\S]*never output anything from it/);
	const seen = {};
	const Service = createPolishService({
		TypertRemoteService: class { constructor(ctx) { this.ctx = ctx; } },
		Remote: () => {},
	}, { createUserMessage: (args) => { seen.message = args; return createUserMessage(args); } });
	const service = new Service({ llm: fakeLlm(() => stream([{ type: 'text-delta', text: '接口已经改好了。' }])) });
	await service.polish('那个接口已经改好了', '', '关于 DSH 的插件：', '', undefined);
	assert.match(seen.message.content[0].text, /^<context>\n关于 DSH 的插件：\n<\/context>\n<transcript>/);
}

// Model choice: a configured pick wins, a stale one falls back to auto.
{
	const { chooseRoute, routeKey } = await import('../polish.js');
	const routes = [
		{ provider: 'ds', providerName: 'DeepSeek', model: 'deepseek-v4-pro', modelName: 'DeepSeek-V4-Pro' },
		{ provider: 'ds', providerName: 'DeepSeek', model: 'deepseek-flash', modelName: 'DeepSeek-V4.1-Flash' },
		{ provider: 'img', providerName: 'Img', model: 'vision', modelName: 'Vision', modalities: ['image'] },
	];
	assert.equal(routeKey(routes[0]), 'ds/deepseek-v4-pro');
	assert.equal(chooseRoute(routes, '').model, 'deepseek-flash');
	assert.equal(chooseRoute(routes, 'ds/deepseek-v4-pro').model, 'deepseek-v4-pro');
	assert.equal(chooseRoute(routes, 'gone/model').model, 'deepseek-flash');
	assert.equal(chooseRoute(routes, 'img/vision').model, 'deepseek-flash', 'a non-text model is never used');
	assert.equal(chooseRoute([], 'ds/x'), null);
	// describe lists text models only, with the automatic pick named.
	const Service = createPolishService({
		TypertRemoteService: class { constructor(ctx) { this.ctx = ctx; } },
		Remote: () => {},
	}, { createUserMessage });
	const service = new Service({ llm: fakeLlm(() => stream([{ type: 'text-delta', text: '好。' }])) });
	const described = await service.describe();
	assert.equal(described.key.length > 0, true);
	assert.ok(Array.isArray(described.routes) && described.routes.every((route) => typeof route.key === 'string' && typeof route.label === 'string'));
}

console.log('polish: ok');
