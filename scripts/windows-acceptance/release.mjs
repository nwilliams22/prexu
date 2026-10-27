import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function releaseAssets(release, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected a release tag vMAJOR.MINOR.PATCH');
  if (release.tag_name !== tag || release.draft !== false || !release.published_at) {
    throw new Error('Expected the requested published release');
  }
  return [`Prexu_${tag.slice(1)}_x64-setup.exe`, `Prexu_${tag.slice(1)}_x64_en-US.msi`].map((name) => {
    const matches = release.assets.filter((asset) => asset.name === name);
    if (matches.length !== 1) throw new Error(`Expected exactly one release asset: ${name}`);
    const asset = matches[0];
    if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || asset.state !== 'uploaded' ||
        !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
      throw new Error(`Missing valid GitHub asset digest/identity: ${name}`);
    }
    return { id: asset.id, name, sha256: asset.digest.slice(7) };
  });
}

export function verifyAsset(bytes, asset) {
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
    throw new Error(`Release asset checksum mismatch: ${asset.name}`);
  }
}

export function downloadRelease() {
  const tag = process.env.RELEASE_TAG;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid release tag');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
  const api = (endpoint) => JSON.parse(execFileSync('gh', ['api', `repos/${repo}/${endpoint}`], { encoding: 'utf8' }));
  const release = api(`releases/tags/${tag}`);
  const assets = releaseAssets(release, tag);
  mkdirSync('candidate'); // Refuse stale or mixed source files.
  mkdirSync('acceptance-logs', { recursive: true });
  const provenance = { repository: repo, tag, releaseId: release.id, publishedAt: release.published_at,
    verification: 'GitHub release API SHA256 digests (not updater signature verification)', assets };
  writeFileSync('acceptance-logs/release-provenance.json', `${JSON.stringify(provenance, null, 2)}\n`);
  for (const asset of assets) {
    // Download by the API-selected immutable asset ID, never a caller-supplied URL.
    const bytes = execFileSync('gh', ['api', `repos/${repo}/releases/assets/${asset.id}`,
      '-H', 'Accept: application/octet-stream'], { maxBuffer: 512 * 1024 * 1024 });
    verifyAsset(bytes, asset);
    writeFileSync(`candidate/${asset.name}`, bytes);
    console.log(`PASS release asset ${asset.id} ${asset.name} SHA256 ${asset.sha256}`);
  }
  writeFileSync('candidate/SHA256SUMS.txt', assets.map((a) => `${a.sha256}  ${a.name}\n`).join(''));
  writeFileSync('candidate/BUILD.txt', readFileSync('acceptance-logs/release-provenance.json'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) downloadRelease();
