/**
 * Runtime response validation using Zod.
 * Validates critical Plex API response shapes at service boundaries.
 * On validation failure, logs a warning but returns the data as-is
 * to avoid breaking the app on unexpected API changes.
 */

import { z } from "zod";

// ── Validation Helper ──

export function validateResponse<T>(
  schema: z.ZodType<T>,
  data: unknown,
  label: string,
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(
      `[validation] ${label}: response shape mismatch`,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
    return data as T;
  }
  return result.data;
}

// ── Library Sections Response ──

const librarySectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  type: z.string(),
}).passthrough();

export const librarySectionsResponseSchema = z.object({
  MediaContainer: z.object({
    Directory: z.array(librarySectionSchema).optional(),
  }).passthrough(),
});

// ── Item Metadata Response ──

const mediaItemSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  type: z.string(),
  title: z.string(),
}).passthrough();

export const metadataResponseSchema = z.object({
  MediaContainer: z.object({
    Metadata: z.array(mediaItemSchema).optional(),
  }).passthrough(),
});

// ── Paginated Library Items Response ──

export const paginatedResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    totalSize: z.number().optional(),
    offset: z.number().optional(),
    Metadata: z.array(mediaItemSchema).optional(),
  }).passthrough(),
});

// ── Plex User Response ──

export const plexUserResponseSchema = z.object({
  id: z.number(),
  username: z.string().optional(),
  email: z.string().optional(),
  title: z.string().optional(),
  friendlyName: z.string().optional(),
  thumb: z.string().optional(),
}).passthrough();

// ── Plex Resources (Server Discovery) Response ──

const plexConnectionSchema = z.object({
  uri: z.string(),
  local: z.boolean(),
  relay: z.boolean(),
}).passthrough();

const plexResourceSchema = z.object({
  name: z.string(),
  clientIdentifier: z.string(),
  accessToken: z.string(),
  provides: z.string(),
  owned: z.boolean(),
  connections: z.array(plexConnectionSchema),
}).passthrough();

export const plexResourcesResponseSchema = z.array(plexResourceSchema);
