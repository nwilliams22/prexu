/** Required rows are explicit: omission, duplicate success or partial slices cannot pass. */
export const REQUIRED = {
  browser: ['qa-fixture', 'session-restore', 'browse-search-detail', 'settings-persistence', 'cleanup'],
  native: ['native-login', 'native-session-restore', 'native-play-advance', 'native-play-pause', 'native-early-stop-watch-state', 'native-resume', 'native-resume-completion', 'native-download', 'native-queue-start', 'native-queue-eof', 'native-queue-postplay', 'native-offline', 'native-offline-missing-file', 'native-driver', 'service-state-restored', 'cleanup'],
  relay: ['relay-guest-login', 'relay-production-auth', 'relay-identities', 'relay-auth', 'relay-invite', 'relay-join', 'relay-leave', 'relay-disconnect', 'relay-reconnect', 'relay-network-failure', 'relay-service-state-restored', 'cleanup'],
};
const delegated = new Set(['login', 'play-resume-watch-state', 'queue-postplay', 'downloads-offline', 'two-client-relay']);
export function assess(reports) {
  const rows = [];
  for (const [slice, required] of Object.entries(REQUIRED)) {
    const source = reports[slice]?.rows || [];
    for (const journey of required) {
      const matches = source.filter(r => r.journey === journey);
      rows.push({ slice, journey, status: matches.length === 1 && matches[0].status === 'PASS' ? 'PASS' : matches.length === 0 ? 'NOT_RUN' : 'FAIL' });
    }
    // Ignore only known cross-slice placeholders. Unknown failures always fail.
    for (const row of source) if (!required.includes(row.journey) && !(delegated.has(row.journey) && ['NOT_RUN', 'SKIP', 'UNSUPPORTED'].includes(row.status)) && row.status !== 'PASS') rows.push({ slice, journey: 'unexpected-failure', status: 'FAIL' });
  }
  return { schema: 1, scope: 'full required real-service journey gate', status: rows.every(r => r.status === 'PASS') ? 'PASS' : 'FAIL', rows };
}
