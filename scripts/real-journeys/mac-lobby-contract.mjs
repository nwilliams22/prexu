import { pinCode } from './native-contract.mjs';

export function safariPin(value) {
  const url = new URL(value);
  // Safari follows Plex's canonical trailing-slash redirect.
  if (url.pathname === '/auth/') url.pathname = '/auth';
  return pinCode(url.href);
}

/** Preserve only timestamps and fixed event labels; never copy raw payloads. */
export function macLogExcerpt(logs) {
  return logs.split('\n').flatMap(line => {
    const time = line.match(/^\[\d{4}-\d{2}-\d{2}\]\[\d{2}:\d{2}:\d{2}\]/)?.[0] || '';
    const relay = line.match(/\[watch:sync\] (Connected to relay|Disconnected from relay)/);
    if (relay) return [`${time} ${relay[0]}`.trim()];
    const decision = line.includes('[playback] canDirectPlay ')
      ? line.match(/"canDirectPlay"\s*:\s*(true|false)/) : null;
    return decision ? [`${time} [playback] canDirectPlay {"canDirectPlay":${decision[1]}}`.trim()] : [];
  }).join('\n') + '\n';
}
