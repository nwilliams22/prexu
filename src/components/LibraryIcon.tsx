import type { LibraryType } from "../types/library";

interface LibraryIconProps {
  type: LibraryType;
  size?: number;
  color?: string;
}

function LibraryIcon({
  type,
  size = 20,
  color = "currentColor",
}: LibraryIconProps) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (type) {
    case "movie":
      // Film icon
      return (
        <svg {...props}>
          <rect x="2" y="2" width="20" height="20" rx="2" />
          <path d="M7 2v20" />
          <path d="M17 2v20" />
          <path d="M2 12h20" />
          <path d="M2 7h5" />
          <path d="M2 17h5" />
          <path d="M17 7h5" />
          <path d="M17 17h5" />
        </svg>
      );
    case "show":
      // TV icon
      return (
        <svg {...props}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8" />
          <path d="M12 17v4" />
        </svg>
      );
    case "artist":
      // Music icon
      return (
        <svg {...props}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case "photo":
      // Camera icon
      return (
        <svg {...props}>
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
      );
    default:
      // Generic folder icon
      return (
        <svg {...props}>
          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
        </svg>
      );
  }
}

export default LibraryIcon;
