import { it, expect } from "vitest";
import { saveDownloadItems, getDownloadItems } from "./downloads";
import type { DownloadItem } from "../../types/downloads";

it("keeps artwork bytes out of localStorage download metadata", async () => {
  const item: DownloadItem = {
    ratingKey: "2", title: "QA", subtitle: "2026", type: "movie", thumb: "/thumb",
    partKey: "/part", fileName: "qa.mp4", fileSize: 1, serverUri: "http://qa.example",
    status: "complete", bytesDownloaded: 1, artworkDataUrl: "data:image/jpeg;base64,/9j/",
  };
  await saveDownloadItems([item]);
  expect((await getDownloadItems())[0]).toEqual(expect.objectContaining({ ratingKey: "2" }));
  expect((await getDownloadItems())[0]).not.toHaveProperty("artworkDataUrl");
});
