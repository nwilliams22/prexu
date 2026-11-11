import { readFileSync } from 'node:fs';
import { join } from 'node:path';
export const requiredScenarios = ['play', 'seek', 'fullscreen', 'windowed', 'mini', 'restore', 'popout', 'popout-exit', 'fault-detected', 'recovered', 'stop'];
const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

// Independent evidence completeness gate: missing captures/metadata cannot pass
// merely because an action returned successfully through CDP.
export function verifyScenarios(root) {
  const session = json(join(root, 'session.json'));
  if (session.schema !== 'prexu.windows.scenarios.v1' || !(session.sessionId > 0) ||
      session.capture !== 'Win32 CopyFromScreen' || !session.displays?.length ||
      !session.gpu?.length || !session.displays.every(d => Array.isArray(d.bounds) && d.bounds.length === 4 && d.bounds.every(Number.isInteger) && d.bounds[2] > 0 && d.bounds[3] > 0) ||
      !session.gpu.every(g => typeof g.Name === 'string' && g.Name.length > 0) || !session.backend || !Number.isFinite(Date.parse(session.utc))) throw Error('Missing interactive capture metadata');
  const metrics = json(join(root, 'metrics.json'));
  if (!Array.isArray(metrics) || metrics.length !== requiredScenarios.length ||
      new Set(metrics.map(m => m.name)).size !== requiredScenarios.length) throw Error('Incomplete or duplicate scenarios');
  for (const name of requiredScenarios) {
    const metric = metrics.find(m => m.name === name);
    if (metric?.pass !== true) throw Error(`Scenario failed: ${name}`);
    const capture = name === 'fault-detected' ? 'injected-freeze' : name;
    const files = name === 'stop' ? ['stop.png'] : [`${capture}-a.png`, `${capture}-b.png`];
    for (const file of files) {
      const png = readFileSync(join(root, file));
      if (png.length < 100 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          png.readUInt32BE(16) < 640 || png.readUInt32BE(20) < 480) throw Error(`Invalid composed capture: ${file}`);
    }
    if (name !== 'stop' && (!metric.videoPresent || !metric.chrome ||
        !(metric.chromeWhiteFraction > .01) || !(metric.chromeWhiteFractionB > .01) ||
        !Number.isFinite(Date.parse(metric.firstUtc)) || !Number.isFinite(Date.parse(metric.secondUtc)) ||
        Date.parse(metric.secondUtc) - Date.parse(metric.firstUtc) < 1000 ||
        Date.parse(metric.secondUtc) - Date.parse(metric.firstUtc) >= 3000)) throw Error(`Invalid observation: ${name}`);
    if (name === 'fault-detected' && (metric.moving !== false || !(metric.metrics?.[2] < .002))) throw Error('Native freeze not detected');
  }
  return { pass: true, scenarios: requiredScenarios.length, capture: session.capture };
}
