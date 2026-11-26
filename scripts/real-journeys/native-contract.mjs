/** The shell handoff accepts only a Plex auth PIN, never an arbitrary URL. */
export function pinCode(value) {
  const url = new URL(value);
  if (url.origin !== 'https://app.plex.tv' || url.pathname !== '/auth' ||
      url.username || url.password || url.search || !url.hash.startsWith('#?')) throw new Error('origin');
  const codes = new URLSearchParams(url.hash.slice(2)).getAll('code');
  if (codes.length !== 1 || !/^[a-zA-Z0-9]{4,64}$/.test(codes[0])) throw new Error('pin');
  return codes[0];
}

export const JOURNEYS = ['download-storage-summary', 'download-storage-warning-cancel', 'native-paused-prepare', 'native-prepared-explicit-start', 'native-solo-autoplay', 'download-queue-first-paused', 'download-queue-search', 'download-queue-second-detail', 'download-card-match', 'download-card-visible', 'download-card-image', 'download-login-button', 'download-login-token', 'download-login-server', 'download-queue-paused', 'download-queue-reordered', 'download-queue-complete', 'download-queue-delete', 'download-queue-settings', 'native-login', 'native-session-restore',
  'native-play-advance', 'native-play-pause', 'native-early-stop-watch-state',
  'native-resume', 'native-resume-completion', 'native-queue-start', 'native-queue-eof', 'native-queue-postplay', 'native-download', 'native-offline', 'native-offline-missing-file', 'native-driver'];
export function validEvent(event) {
  return event && Object.keys(event).length === 2 && JOURNEYS.includes(event.journey) &&
    (['PASS', 'FAIL'].includes(event.status) ||
      (event.journey === 'native-resume' && event.status === 'UNSUPPORTED'));
}
