import type { SearchLanguage } from "./types.ts";

function common(value: string): string {
  return value.normalize("NFC").trim().toLowerCase()
    .replace(/[’‘ʼ＇`´]/g, "'")
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\u0140l/g, "l·l")
    .replace(/l[•∙⋅‧]l/g, "l·l")
    .replace(/\s+/g, " ");
}

export function normalizeSearchInput(value: string, language: SearchLanguage = "auto"): string {
  return common(language === "zh" || /\p{Script=Han}/u.test(value) ? value.normalize("NFKC") : value);
}

export function normalizeSearchKey(value: string, language: "es" | "zh"): string {
  const normalized = normalizeSearchInput(value, language);
  if (language === "zh") return normalized;
  // Spanish ñ is a distinct letter; accents and diaereses can be omitted.
  return normalized.normalize("NFD")
    .replace(/n\u0303/g, "ñ")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC");
}

export function searchCacheKey(value: string, language: SearchLanguage = "auto"): string {
  return `${language}:${normalizeSearchInput(value, language)}`;
}
