const CYRILLIC_RE = /[\u0400-\u04FF]/;
const LATIN_WORD_RE = /[A-Za-z\u00C0-\u024F]{2,}/;
export const CYRILLIC_COUNTRY_RE =
  /russia|belarus|ukraine|kazakhstan|kyrgyzstan|bulgaria|serbia|macedonia|mongolia|tajikistan|uzbekistan|montenegro|bosnia/i;

export function hasCyrillic(text: string): boolean {
  return CYRILLIC_RE.test(text);
}

export function isCyrillicCountry(country: string | null | undefined): boolean {
  return Boolean(country && CYRILLIC_COUNTRY_RE.test(country.trim()));
}

/**
 * Sanitizes reverse-geocoded place names (city/state) against stray Cyrillic/Russian
 * GeoNames labels attached to non-Cyrillic regions (e.g. "Kalimpong, Крукети" -> "Kalimpong",
 * or purely Cyrillic "Крукети" -> null).
 *
 * Preserves authentic Cyrillic names when the asset's country is a Cyrillic-script country.
 */
export function sanitizePlaceName(
  rawPlace: string | null | undefined,
  country: string | null | undefined
): string | null {
  const place = (rawPlace || '').trim();
  if (!place) return null;

  if (!CYRILLIC_RE.test(place)) {
    return place;
  }

  if (isCyrillicCountry(country)) {
    return place;
  }

  // Mixed-script string like "Kalimpong, Крукети" or "Kalimpong (Крукети)":
  // strip Cyrillic segments while preserving clean Latin place names.
  const segments = place
    .split(/[,/;|()]+/)
    .map((seg) => seg.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, '').trim())
    .filter((seg) => seg.length > 0 && !CYRILLIC_RE.test(seg) && LATIN_WORD_RE.test(seg));

  if (segments.length > 0) {
    const deduped = Array.from(new Set(segments));
    return deduped.join(', ');
  }

  // Purely Cyrillic string outside a Cyrillic-script country (or with unknown country)
  return null;
}
