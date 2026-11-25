/** Sequential service runs prevent one slice from invalidating another's state. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { assess } from './full-contract.mjs';
const root = await mkdtemp(`${tmpdir()}/prexu-full-journeys-`);
const reports = {};
try {
  for (const [slice, file] of [['browser','run.mjs'], ['native','native.mjs'], ['relay','relay.mjs']]) {
    const path = `${root}/${slice}.json`;
    const env = { ...process.env, PREXU_JOURNEY_REPORT: path };
    delete env.PREXU_JOURNEY_OFFLINE_ONLY; delete env.PREXU_JOURNEY_QUEUE_ONLY;
    const child = spawn(process.execPath, [`scripts/real-journeys/${file}`], { env, stdio: ['ignore','ignore','inherit'] });
    await new Promise(resolve => { child.once('error', resolve); child.once('close', resolve); });
    try { reports[slice] = JSON.parse(await readFile(path, 'utf8')); } catch { reports[slice] = { rows: [] }; }
  }
} finally { await rm(root, { recursive: true, force: true }); }
const report = { ...assess(reports), sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), reports };
const output = JSON.stringify(report, null, 2) + '\n';
if (process.env.PREXU_JOURNEY_REPORT) await writeFile(process.env.PREXU_JOURNEY_REPORT, output, { mode: 0o600 });
process.stdout.write(output);
process.exitCode = report.status === 'PASS' ? 0 : 1;
