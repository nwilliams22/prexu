import FixMatchDialog from "../FixMatchDialog";

interface AdminActionsBarProps {
  showFixMatch: boolean;
  ratingKey: string;
  currentTitle: string;
  currentYear?: string;
  mediaType: "movie" | "show";
  onClose: () => void;
  onMatchApplied: () => void;
}

export default function AdminActionsBar({
  showFixMatch,
  ratingKey,
  currentTitle,
  currentYear,
  mediaType,
  onClose,
  onMatchApplied,
}: AdminActionsBarProps) {
  if (!showFixMatch) return null;

  return (
    <FixMatchDialog
      ratingKey={ratingKey}
      currentTitle={currentTitle}
      currentYear={currentYear}
      mediaType={mediaType}
      onClose={onClose}
      onMatchApplied={onMatchApplied}
    />
  );
}
