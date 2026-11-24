import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('public build excludes function sources and protects unrelated output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'studio37-publish-'));
  try {
    await mkdir(path.join(root, 'scripts'));
    await mkdir(path.join(root, 'src', 'netlify', 'functions'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.html'), 'public');
    await writeFile(path.join(root, 'src', 'netlify', 'functions', 'private.mjs'), 'private');
    await copyFile(fileURLToPath(new URL('../scripts/prepare-publish.mjs', import.meta.url)), path.join(root, 'scripts', 'prepare-publish.mjs'));
    const build = () => spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare-publish.mjs')], { encoding: 'utf8' });

    await mkdir(path.join(root, 'dist'));
    await writeFile(path.join(root, 'dist', 'existing.txt'), 'keep');
    assert.notEqual(build().status, 0);
    assert.equal(await readFile(path.join(root, 'dist', 'existing.txt'), 'utf8'), 'keep');
    await rm(path.join(root, 'dist'), { recursive: true });

    assert.equal(build().status, 0);
    assert.equal(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), 'public');
    await assert.rejects(access(path.join(root, 'dist', 'netlify')));
    await writeFile(path.join(root, 'dist', 'stale.txt'), 'stale');
    assert.equal(build().status, 0);
    await assert.rejects(access(path.join(root, 'dist', 'stale.txt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('password change API redirect precedes the 404 fallback', async () => {
  const redirects = await readFile(fileURLToPath(new URL('../src/_redirects', import.meta.url)), 'utf8');
  const routes = redirects.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const changePassword = routes.findIndex((line) => /^\/api\/auth\/change-password\s+\/\.netlify\/functions\/auth-change-password\s+200(?:\s|$)/.test(line));
  const fallback = routes.findIndex((line) => /^\/\*\s+\/404\.html\s+404(?:\s|$)/.test(line));
  assert.ok(changePassword >= 0 && fallback > changePassword);
});
