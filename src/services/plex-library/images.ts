/**
 * Image URL construction for Plex transcoded images.
 */

export function getImageUrl(
  serverUri: string,
  serverToken: string,
  imagePath: string,
  width: number,
  height: number
): string {
  if (!imagePath) return "";
  const params = new URLSearchParams({
    url: imagePath,
    width: String(width),
    height: String(height),
    minSize: "1",
    upscale: "1",
    "X-Plex-Token": serverToken,
  });
  return `${serverUri}/photo/:/transcode?${params.toString()}`;
}
