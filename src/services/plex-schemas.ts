/**
 * Zod 4 schemas for the Plex API service boundary.
 *
 * Plex responses vary by server version and item type, so every schema here is
 * deliberately permissive:
 *   - genuinely-optional fields are `.optional()`
 *   - fields that may be missing/malformed use `.catch(default)`
 *   - objects are NOT `.strict()` — unknown extra keys pass through untouched
 *
 * The goal is to give call sites a *trusted, fully-typed* shape so they no
 * longer need `as unknown as` casts — NOT to reject real Plex data. Parse with
 * {@link safeParsePlex}, never a bare `.parse()`, so a schema mismatch degrades
 * gracefully (logged + best-effort fallback) instead of crashing the UI.
 */

import { z } from "zod";
import { logger } from "./logger";

/* ------------------------------------------------------------------ */
/*  Safe-parse helper                                                  */
/* ------------------------------------------------------------------ */

/**
 * Run `schema.safeParse(data)`; on failure log (tag "api") and return the
 * provided fallback. The UI must never crash on a schema mismatch, so callers
 * pass a best-effort fallback (the raw coerced value or an empty result).
 *
 * `label` identifies the call site in logs. No tokens/URLs are logged here —
 * only the field paths and Zod messages from the issues.
 */
export function safeParsePlex<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
  fallback: T,
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  void logger.warn(
    "api",
    `${label}: Plex response shape mismatch (using fallback)`,
    result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
  );
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Shared sub-schemas                                                 */
/* ------------------------------------------------------------------ */

export const plexTagSchema = z
  .object({
    tag: z.string().catch(""),
  })
  .loose();
export type PlexTag = z.infer<typeof plexTagSchema>;

export const plexRoleSchema = z
  .object({
    tag: z.string().catch(""),
    role: z.string().catch(""),
    thumb: z.string().optional(),
    id: z.number().optional(),
    tagKey: z.string().optional(),
  })
  .loose();
export type PlexRole = z.infer<typeof plexRoleSchema>;

export const plexRatingSchema = z
  .object({
    image: z.string().catch(""),
    value: z.number().catch(0),
    type: z.string().catch(""),
  })
  .loose();
export type PlexRating = z.infer<typeof plexRatingSchema>;

export const plexStreamSchema = z
  .object({
    id: z.number().catch(0),
    streamType: z.number().catch(0),
    codec: z.string().catch(""),
    index: z.number().catch(0),
    displayTitle: z.string().catch(""),
    title: z.string().optional(),
    language: z.string().optional(),
    languageCode: z.string().optional(),
    selected: z.boolean().optional(),
    default: z.boolean().optional(),
    forced: z.boolean().optional(),
    key: z.string().optional(),
    format: z.string().optional(),
    hearingImpaired: z.boolean().optional(),
    channels: z.number().optional(),
    audioChannelLayout: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    bitrate: z.number().optional(),
    bitDepth: z.number().optional(),
    colorSpace: z.string().optional(),
    DOVIPresent: z.boolean().optional(),
    extendedDisplayTitle: z.string().optional(),
  })
  .loose();
export type PlexStream = z.infer<typeof plexStreamSchema>;

export const plexMarkerSchema = z
  .object({
    id: z.number().catch(0),
    type: z.enum(["intro", "credits"]).catch("intro"),
    startTimeOffset: z.number().catch(0),
    endTimeOffset: z.number().catch(0),
  })
  .loose();
export type PlexMarker = z.infer<typeof plexMarkerSchema>;

export const plexChapterSchema = z
  .object({
    id: z.number().catch(0),
    index: z.number().catch(0),
    startTimeOffset: z.number().catch(0),
    endTimeOffset: z.number().catch(0),
    tag: z.string().catch(""),
  })
  .loose();
export type PlexChapter = z.infer<typeof plexChapterSchema>;

export const plexMediaPartSchema = z
  .object({
    id: z.number().catch(0),
    key: z.string().catch(""),
    duration: z.number().catch(0),
    file: z.string().catch(""),
    size: z.number().catch(0),
    container: z.string().catch(""),
    Stream: z.array(plexStreamSchema).optional(),
    Chapter: z.array(plexChapterSchema).optional(),
  })
  .loose();
export type PlexMediaPart = z.infer<typeof plexMediaPartSchema>;

export const plexMediaInfoSchema = z
  .object({
    id: z.number().catch(0),
    duration: z.number().catch(0),
    bitrate: z.number().catch(0),
    videoResolution: z.string().catch(""),
    videoCodec: z.string().catch(""),
    audioCodec: z.string().catch(""),
    audioChannels: z.number().catch(0),
    videoProfile: z.string().optional(),
    audioProfile: z.string().optional(),
    videoFrameRate: z.string().optional(),
    Part: z.array(plexMediaPartSchema).optional(),
  })
  .loose();
export type PlexMediaInfo = z.infer<typeof plexMediaInfoSchema>;

/* ------------------------------------------------------------------ */
/*  Plex Metadata                                                      */
/* ------------------------------------------------------------------ */

/**
 * Fields shared by every metadata item regardless of `type`. These are the
 * identity/display fields the UI always reads, so they get safe defaults
 * rather than being optional — a metadata item with no `ratingKey` is unusable
 * anyway, and `.catch` keeps a malformed entry from poisoning the whole array.
 */
const metadataBaseFields = {
  ratingKey: z.string().catch(""),
  key: z.string().catch(""),
  title: z.string().catch(""),
  summary: z.string().catch(""),
  thumb: z.string().catch(""),
  art: z.string().catch(""),
  addedAt: z.number().catch(0),
  updatedAt: z.number().catch(0),
  playlistItemID: z.number().optional(),

  // Commonly read across multiple item types — kept optional so the base
  // (catch-all) variant and the typed variants all expose them, which is what
  // lets call sites drop their `as unknown as { year?: number }` casts.
  year: z.number().optional(),
  rating: z.number().optional(),
  audienceRating: z.number().optional(),
  ratingImage: z.string().optional(),
  audienceRatingImage: z.string().optional(),
  contentRating: z.string().optional(),
  duration: z.number().optional(),
  studio: z.string().optional(),
  tagline: z.string().optional(),
  subtype: z.string().optional(),
  originallyAvailableAt: z.string().optional(),

  // Watch state (movies/episodes use viewCount; shows/seasons use leaf counts)
  viewOffset: z.number().optional(),
  viewCount: z.number().optional(),
  lastViewedAt: z.number().optional(),
  viewedLeafCount: z.number().optional(),
  leafCount: z.number().optional(),
  childCount: z.number().optional(),

  // Hierarchy (seasons/episodes/albums)
  index: z.number().optional(),
  parentIndex: z.number().optional(),
  parentRatingKey: z.string().optional(),
  parentTitle: z.string().optional(),
  parentThumb: z.string().optional(),
  grandparentRatingKey: z.string().optional(),
  grandparentTitle: z.string().optional(),
  grandparentThumb: z.string().optional(),
  grandparentArt: z.string().optional(),

  // Rich sub-collections
  Genre: z.array(plexTagSchema).optional(),
  Director: z.array(plexTagSchema).optional(),
  Writer: z.array(plexTagSchema).optional(),
  Collection: z.array(plexTagSchema).optional(),
  Role: z.array(plexRoleSchema).optional(),
  Rating: z.array(plexRatingSchema).optional(),
  Media: z.array(plexMediaInfoSchema).optional(),
  Marker: z.array(plexMarkerSchema).optional(),
};

/**
 * A single permissive metadata schema covering every Plex item type. `type` is
 * a string literal union with a catch (unknown future types coerce to the
 * harmless "clip") so parsing never fails on an unexpected `type` value.
 *
 * This is the type call sites receive; because all type-specific fields are
 * present (optional), narrowing on `item.type === "movie"` lets TypeScript
 * read `item.year` etc. without any cast.
 */
export const plexMetadataSchema = z
  .object({
    type: z
      .enum([
        "movie",
        "show",
        "season",
        "episode",
        "artist",
        "album",
        "track",
        "collection",
        "playlist",
        "clip",
        "photo",
      ])
      .catch("clip"),
    ...metadataBaseFields,
  })
  .loose();
export type PlexMetadata = z.infer<typeof plexMetadataSchema>;

/**
 * Discriminated union keyed on `type`. Each variant is the same permissive base
 * with a `z.literal` discriminant; a catch-all `clip` variant absorbs any other
 * value. Use this where a call site benefits from exhaustive narrowing; the
 * single {@link plexMetadataSchema} is sufficient for most boundary parsing.
 */
const variant = (
  t:
    | "movie"
    | "show"
    | "season"
    | "episode"
    | "artist"
    | "album"
    | "track"
    | "collection"
    | "playlist"
    | "clip",
) => z.object({ type: z.literal(t), ...metadataBaseFields }).loose();

export const plexMetadataUnionSchema = z.discriminatedUnion("type", [
  variant("movie"),
  variant("show"),
  variant("season"),
  variant("episode"),
  variant("artist"),
  variant("album"),
  variant("track"),
  variant("collection"),
  variant("playlist"),
  variant("clip"),
]);
export type PlexMetadataUnion = z.infer<typeof plexMetadataUnionSchema>;

/* ------------------------------------------------------------------ */
/*  Containers                                                         */
/* ------------------------------------------------------------------ */

export const librarySectionSchema = z
  .object({
    key: z.string().catch(""),
    title: z.string().catch(""),
    type: z.string().catch(""),
    agent: z.string().optional(),
    scanner: z.string().optional(),
    thumb: z.string().optional(),
    art: z.string().optional(),
    updatedAt: z.number().optional(),
  })
  .loose();
export type LibrarySection = z.infer<typeof librarySectionSchema>;

export const plexHubSchema = z
  .object({
    hubKey: z.string().catch(""),
    key: z.string().catch(""),
    title: z.string().catch(""),
    type: z.string().catch(""),
    hubIdentifier: z.string().catch(""),
    size: z.number().catch(0),
    more: z.boolean().catch(false),
    Metadata: z.array(plexMetadataSchema).optional(),
  })
  .loose();
export type PlexHub = z.infer<typeof plexHubSchema>;

/**
 * `MediaContainer` wrapper, parameterised over the item schema so callers reuse
 * it for metadata, directories, or hubs. `size`/`totalSize`/`offset` are
 * `.catch`ed because some endpoints omit them.
 */
export function mediaContainerSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      MediaContainer: z
        .object({
          size: z.number().catch(0),
          totalSize: z.number().optional(),
          offset: z.number().optional(),
          Metadata: z.array(item).optional(),
          Directory: z.array(librarySectionSchema).optional(),
          Hub: z.array(plexHubSchema).optional(),
        })
        .loose(),
    })
    .loose();
}

/** Standard metadata container: `{ MediaContainer: { Metadata: PlexMetadata[] } }`. */
export const metadataContainerSchema = mediaContainerSchema(plexMetadataSchema);
export type MetadataContainer = z.infer<typeof metadataContainerSchema>;

/** Directory container: `{ MediaContainer: { Directory: ... } }` with raw entries. */
export const directoryEntrySchema = z
  .object({
    key: z.string().catch(""),
    title: z.string().optional(),
    size: z.union([z.string(), z.number()]).optional(),
  })
  .loose();
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const directoryContainerSchema = z
  .object({
    MediaContainer: z
      .object({
        Directory: z.array(directoryEntrySchema).optional(),
      })
      .loose(),
  })
  .loose();
export type DirectoryContainer = z.infer<typeof directoryContainerSchema>;
