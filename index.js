/**
 * Host half of the hold-to-dictate bundle.
 *
 * Almost every behaviour lives in the Client module (`./client`): the composer card, the
 * pointer gesture, the recording meter and the draft insertion are all browser concerns,
 * and transcription goes through the `speech` Remote that the shipped voice-input bundle
 * already mounts.
 *
 * The one Host concern is the optional AI polish: a Remote that runs a finished
 * transcript through a model the user already configured in DSH. Its packages are
 * imported lazily, so a Host without them still loads the plugin — the Client then
 * simply finds no polish Remote and inserts the original words, as it always did.
 */
import { createPolishService } from './polish.js';

export const name = 'dsh-hold-to-dictate';

export async function apply(ctx) {
	let protocol;
	let llmModule;
	try {
		[protocol, llmModule] = await Promise.all([
			import('@deepseek-ai/dsh-typert-protocol'),
			import('@deepseek-ai/dsh-llm'),
		]);
	} catch {
		return;
	}
	if (typeof protocol.TypertRemoteService !== 'function' || typeof protocol.Remote !== 'function') return;
	if (typeof llmModule.createUserMessage !== 'function') return;
	ctx.plugin(createPolishService(protocol, llmModule));
}
