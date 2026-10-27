import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { releaseAssets, verifyAsset } from './release.mjs';

const bytes = Buffer.from('installer fixture');
const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fixture = () => ({ tag_name: 'v0.8.1', draft: false, published_at: '2026-10-27T17:47:14Z', assets: [
  { id: 1, name: 'Prexu_0.8.1_x64-setup.exe', state: 'uploaded', digest },
  { id: 2, name: 'Prexu_0.8.1_x64_en-US.msi', state: 'uploaded', digest },
] });

test('published release selects both exact installers and verifies bytes', () => {
  const assets = releaseAssets(fixture(), 'v0.8.1');
  assert.equal(assets.length, 2);
  for (const asset of assets) verifyAsset(bytes, asset);
  assert.throws(() => verifyAsset(Buffer.from('tampered'), assets[0]), /checksum mismatch/);
});

test('rejects URLs, drafts, wrong tags, missing publication and missing/duplicate installers', () => {
  assert.throws(() => releaseAssets(fixture(), 'https://example.com/installer'));
  for (const mutate of [
    (r) => { r.draft = true; }, (r) => { r.tag_name = 'v0.8.0'; },
    (r) => { r.published_at = null; }, (r) => { r.assets.pop(); },
    (r) => { r.assets.push(r.assets[0]); },
  ]) { const r = fixture(); mutate(r); assert.throws(() => releaseAssets(r, 'v0.8.1')); }
});

test('fails closed on absent/malformed digest or asset identity', () => {
  for (const patch of [{ digest: null }, { digest: 'sha256:bad' }, { digest: 'sha512:' + 'a'.repeat(64) },
    { id: '../other' }, { id: 0 }, { state: 'new' }]) {
    const r = fixture(); Object.assign(r.assets[0], patch);
    assert.throws(() => releaseAssets(r, 'v0.8.1'));
  }
});
