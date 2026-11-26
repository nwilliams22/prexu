import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const { values, disk, fetchImage, save } = vi.hoisted(() => {
  const values = new Map<string, unknown>();
  const disk = new Map<string, unknown>();
  return { values, disk, fetchImage: vi.fn(), save: vi.fn(async () => {
    disk.clear();
    for (const [key, value] of values) disk.set(key, value);
  }) };
});
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get(key: string) { return Promise.resolve(values.get(key)); }
    set(key: string, value: unknown) { values.set(key, value); return Promise.resolve(); }
    delete(key: string) { values.delete(key); return Promise.resolve(true); }
    keys() { return Promise.resolve([...values.keys()]); }
    save = save;
  },
}));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: fetchImage }));
import { artworkKey, loadDownloadArtwork, deleteDownloadArtwork, pruneDownloadArtwork } from "./download-artwork";
const item = { serverUri: "http://qa.example:32400", ratingKey: "2", thumb: "/library/metadata/2/thumb" };
function imageResponse() {
  return new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
}
beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
  values.clear(); disk.clear(); save.mockClear(); fetchImage.mockReset();
  fetchImage.mockResolvedValue(imageResponse());
});
afterEach(() => { Reflect.deleteProperty(window, "__TAURI_INTERNALS__"); });
describe("download artwork", () => {
  it("saves bytes explicitly and restores them without a network request or credential", async () => {
    const data = await loadDownloadArtwork(item, "test-token");
    expect(data).toBe("data:image/jpeg;base64,/9j/");
    expect(disk.get(artworkKey(item))).toBe(data);
    const [url, options] = fetchImage.mock.calls[0]!;
    expect(url).not.toContain("test-token");
    expect(url).not.toContain("X-Plex-Token");
    expect(options.headers).toEqual({ "X-Plex-Token": "test-token" });
    expect(options.maxRedirections).toBe(0);
    fetchImage.mockRejectedValue(new Error("offline"));
    expect(await loadDownloadArtwork(item)).toBe(data);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    await deleteDownloadArtwork(item);
    expect(disk.size).toBe(0);
  });
  it("keeps the same rating key on different servers separate", async () => {
    await loadDownloadArtwork(item, "test-token");
    expect(await loadDownloadArtwork({ ...item, serverUri: "http://other.example" })).toBeUndefined();
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });
  it("deletes a pending write after it finishes so late responses cannot resurrect artwork", async () => {
    let resolve!: (response: Response) => void;
    fetchImage.mockReturnValue(new Promise<Response>((done) => { resolve = done; }));
    const loading = loadDownloadArtwork(item, "test-token");
    await vi.waitFor(() => expect(fetchImage).toHaveBeenCalledTimes(1));
    const deleting = deleteDownloadArtwork(item);
    resolve(imageResponse());
    await Promise.all([loading, deleting]);
    expect(values.size).toBe(0);
    expect(disk.size).toBe(0);
  });
  it.each([
    ['HTTP failure', () => new Response("failed", { status: 503 })],
    ['HTML response', () => new Response("<html/>", { headers: { "Content-Type": "text/html" } })],
    ['oversized stream', () => new Response(new Uint8Array(256 * 1024 + 1), { headers: { "Content-Type": "image/png" } })],
  ])("does not persist %s and can retry later", async (_label, response) => {
    fetchImage.mockResolvedValueOnce(response());
    await expect(loadDownloadArtwork(item, "test-token")).rejects.toThrow();
    expect(disk.size).toBe(0);
    expect(await loadDownloadArtwork(item, "test-token")).toContain("data:image/jpeg");
  });
});

it("removes orphaned assets after an interrupted delete, preserving current downloads", async () => {
  values.set("orphan", "data:image/jpeg;base64,/9j/");
  await loadDownloadArtwork(item, "test-token");
  await pruneDownloadArtwork([item]);
  expect([...disk.keys()]).toEqual([artworkKey(item)]);
});
