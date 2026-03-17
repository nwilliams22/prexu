/**
 * ISO 639-2/B language codes used for audio/subtitle preferences.
 */
export const LANGUAGES = [
  { code: "", label: "None" },
  { code: "eng", label: "English" },
  { code: "spa", label: "Spanish" },
  { code: "fra", label: "French" },
  { code: "deu", label: "German" },
  { code: "ita", label: "Italian" },
  { code: "por", label: "Portuguese" },
  { code: "rus", label: "Russian" },
  { code: "jpn", label: "Japanese" },
  { code: "kor", label: "Korean" },
  { code: "zho", label: "Chinese" },
  { code: "ara", label: "Arabic" },
  { code: "hin", label: "Hindi" },
  { code: "nld", label: "Dutch" },
  { code: "pol", label: "Polish" },
  { code: "swe", label: "Swedish" },
  { code: "nor", label: "Norwegian" },
  { code: "dan", label: "Danish" },
  { code: "fin", label: "Finnish" },
  { code: "tur", label: "Turkish" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];
