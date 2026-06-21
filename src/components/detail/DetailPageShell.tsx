/**
 * Shared layout shell for container detail pages (collections, playlists).
 *
 * Owns the cross-cutting flow both pages share: deciding when to show the
 * error / empty / loading / body states and where overlays mount. Page-specific
 * markup (hero vs compact header, row list vs poster grid) is injected via
 * slots so the shell never branches on page type — composition over config,
 * per the react:components guidance.
 */

import type { ReactNode } from "react";

export interface DetailPageShellProps {
  /** Optional className for the outer container. */
  className?: string;
  /** Inline style for the outer container (pages own their own layout). */
  style?: React.CSSProperties;
  /** Background layer (e.g. blurred art); rendered first, before the header. */
  background?: ReactNode;
  /** Header / hero region. Rendered whenever provided. */
  header?: ReactNode;
  /** Toolbar region (play-all/shuffle/edit actions), rendered after header. */
  toolbar?: ReactNode;
  /** Whether the items query failed. */
  isError: boolean;
  /** Error UI to render when isError is true. */
  errorSlot?: ReactNode;
  /** Whether items are still loading (first load). */
  isLoading: boolean;
  /** Skeleton/loading UI to render while loading. */
  loadingSlot?: ReactNode;
  /** Whether the container has zero items (after loading, no error). */
  isEmpty: boolean;
  /** Empty-state UI to render when isEmpty is true. */
  emptySlot?: ReactNode;
  /** Main body (item rows / grid). Rendered when not loading/error/empty. */
  children?: ReactNode;
  /** Overlays (context menus, play overlay) rendered at the end. */
  overlays?: ReactNode;
}

/**
 * Renders detail-page chrome and routes between body/loading/error/empty.
 *
 * State precedence mirrors the original pages:
 *  1. error (if present) is always shown
 *  2. loading skeletons while first load is in flight
 *  3. empty state once loaded with no items
 *  4. body otherwise
 */
export default function DetailPageShell({
  className,
  style,
  background,
  header,
  toolbar,
  isError,
  errorSlot,
  isLoading,
  loadingSlot,
  isEmpty,
  emptySlot,
  children,
  overlays,
}: DetailPageShellProps) {
  return (
    <div className={className} style={style}>
      {background}
      {header}
      {toolbar}

      {isError && errorSlot}

      {!isError && isLoading && loadingSlot}

      {!isError && !isLoading && isEmpty && emptySlot}

      {!isError && !isLoading && !isEmpty && children}

      {overlays}
    </div>
  );
}
