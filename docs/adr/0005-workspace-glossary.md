# 5. Polish reads the workspace glossary on the Client, through `remote.workspaceFiles`

Status: accepted

## Context

The manual vocabulary corrects misheard terms, but projects already spell their own terms in `GLOSSARY.md` / `CONTEXT.md` / `AGENTS.md`, and asking users to retype 60 of them per project is the friction an audit called out. The Host-side polish service receives plain strings; it has no idea which session or workspace a call came from. The Client does know: it is mounted per session.

## Decision

Import on the Client. The overlay slot is scope `session`, so the `slots.register` entry's `inject(sessionId)` callback receives the session id — the same idiom `dsh-client-ui-input-trigger` uses for the slash-menu — and `ctx.inject(['remote.workspaceFiles'])` exposes the Host's `read(sessionId, path, range)`, which confines reads to that session's workspace root. At polish time the plugin reads at most the first 120 lines of each of `GLOSSARY.md`, `CONTEXT.md`, `AGENTS.md`, mines only the first cell of table rows and bold list leads, caps at 40 terms with a two-second per-file deadline, and appends them behind the manual vocabulary so the user's spelling wins the Host's 60-term dedupe. A result that found terms is cached per session for five minutes; every failure path resolves to an empty string, which is exactly the polish that ran before.

## Consequences

- No Host-half change: the merged terms ride the existing `vocabulary` wire parameter into `parseVocabulary`.
- `remote.workspaceFiles` is a namespaced service a host may not mount; the injection simply never runs there and polish works without project terms.
- Term spellings, like the transcript itself, reach the polish model's provider. The setting defaults on behind the already-opt-in polish and has its own switch, documented in both READMEs.
- The markdown mining stays deliberately narrow: an invented term actively mis-corrects, so only the file's author — via a table column or a bolded lead — says what a term is.
