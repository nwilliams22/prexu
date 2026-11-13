/** The shell handoff accepts only a Plex auth PIN, never an arbitrary URL. */
export function pinCode(value) {
  const url = new URL(value);
  if (url.origin !== 'https://app.plex.tv' || url.pathname !== '/auth' ||
      url.username || url.password || url.search || !url.hash.startsWith('#?')) throw new Error('origin');
  const codes = new URLSearchParams(url.hash.slice(2)).getAll('code');
  if (codes.length !== 1 || !/^[a-zA-Z0-9]{4,64}$/.test(codes[0])) throw new Error('pin');
  return codes[0];
}

export const JOURNEYS = ['native-login', 'native-session-restore',
  'native-play-advance', 'native-play-pause', 'native-early-stop-watch-state',
  'native-resume', 'native-resume-completion', 'native-queue-start', 'native-queue-eof', 'native-queue-postplay', 'native-download', 'native-offline', 'native-offline-missing-file', 'native-driver'];
export function validEvent(event) {
  return event && Object.keys(event).length === 2 && JOURNEYS.includes(event.journey) &&
    (['PASS', 'FAIL'].includes(event.status) ||
      (event.journey === 'native-resume' && event.status === 'UNSUPPORTED'));
}
