# 4. `client.js` stays one file; structure comes from modules inside it

Status: accepted

## Context

The DSH module loader loads `client.js` verbatim. There is no bundler and no build step, so what you edit is what runs (see CONTRIBUTING). The file is about 2,900 lines.

## Decision

Do not split the file, and do not add a build step to make splitting possible. Pull behaviour into pure factories inside the file (`createLivePlan`, `createLiveDraft`, ...) that tests can reach without mounting the gesture.

## Consequences

- Splitting the file alone would add load-order and packaging risk without making any rule easier to test.
- Tests reach the factories the same way `tests/plan.test.mjs` does: by exposing them from the loader's factory.
