/**
 * Check what `npm publish` would actually ship, against what the READMEs point at.
 *
 * `files` is a whitelist, so a README image that nobody added to it vanishes from the
 * tarball silently: the repository page still shows it, npm rewrites the path to the
 * repository and may still show it, and nobody finds out until a mirror or a docs site
 * renders a broken image. This is the step that would have caught that.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('package.json'));

// Without these two keys the bundle installs and then does nothing: `dsh.bundle.patch` is
// what makes DSH load it at all, and `dsh.client` is what marks the client half as a browser
// module. Both failures are silent on a real install, so they are checked here instead of
// only in CI.
assert.ok(manifest.dsh?.bundle?.patch, 'package.json must declare dsh.bundle.patch');
assert.ok(manifest.dsh?.client, 'package.json must declare dsh.client');

// The READMEs ship as part of the package, so a relative reference in one has to resolve
// inside the tarball. Absolute URLs are somebody else's problem and are skipped.
const referenced = [...new Set([...`${read('README.md')}\n${read('README.en.md')}`.matchAll(/src="([^"]+)"/g)]
	.map((match) => match[1])
	.filter((path) => !/^[a-z]+:/i.test(path)))];

const packed = new Set(
	JSON.parse(execFileSync('npm pack --dry-run --json', {
		encoding: 'utf8',
		// npm is a .cmd shim on Windows and a shell script elsewhere; without a shell Node
		// cannot spawn it on the former. The command is a fixed literal with nothing
		// interpolated, so the shell never sees anything this file did not write itself.
		shell: true,
		stdio: ['ignore', 'pipe', 'ignore'],
	}))[0]
		.files
		.map((file) => file.path.replace(/\\/g, '/')),
);

const missing = referenced.filter((path) => !packed.has(path));
assert.deepEqual(missing, [], `README references files that the package does not ship: ${missing.join(', ')}`);

for (const entry of manifest.files ?? []) {
	if (entry.includes('*')) continue;
	assert.ok(packed.has(entry), `"files" lists ${entry}, which npm pack did not include`);
}

assert.ok(packed.has('client.js') && packed.has('index.js'), 'both halves of the bundle are in the tarball');
for (const leaked of ['tests/', '.github/', '.git/']) {
	assert.ok(![...packed].some((path) => path.startsWith(leaked)), `${leaked} must stay out of the published tarball`);
}

console.log(`package: ok (${packed.size} files, ${referenced.length} README references all present)`);
