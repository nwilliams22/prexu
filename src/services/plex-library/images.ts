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

/**
 * Generate a tiny placeholder URL for blur-up progressive loading.
 * Returns a 20px-wide version of the image that loads almost instantly.
 */
export function getPlaceholderUrl(
  serverUri: string,
  serverToken: string,
  imagePath: string,
  aspectRatio = 1.5,
): string {
  if (!imagePath) return "";
  const width = 20;
  const height = Math.round(width * aspectRatio);
  return getImageUrl(serverUri, serverToken, imagePath, width, height);
}

/**
 * Generate a srcSet string for responsive poster images.
 * Provides 1x, 1.5x, and 2x resolution variants.
 */
export function getImageSrcSet(
  serverUri: string,
  serverToken: string,
  imagePath: string,
  baseWidth: number,
  aspectRatio = 1.5,
): string {
  if (!imagePath) return "";
  const sizes = [1, 1.5, 2];
  return sizes
    .map((scale) => {
      const w = Math.round(baseWidth * scale);
      const h = Math.round(w * aspectRatio);
      const url = getImageUrl(serverUri, serverToken, imagePath, w, h);
      return `${url} ${w}w`;
    })
    .join(", ");
}
