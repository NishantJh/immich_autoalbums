import type { ClusterRecord, RenameSuggestion } from '../shared/types.ts';

interface ParsedTitle {
  raw: string;
  tagPrefix: string; // e.g. "[Auto] " or "Travel • " before YYYY-MM
  datePrefix: string; // e.g. "2026-08 • "
  eventCore: string; // e.g. "Panaji Trip"
  chapterSep: string; // e.g. " — " or ": " or " • "
  chapterPart: string; // e.g. "Beach & Lush Nature"
  trailingSuffix: string; // e.g. " (All)" or " (Aug 2026)"
}

interface CoreDiff {
  kind: 'none' | 'substitution' | 'prefix_add' | 'suffix_add' | 'full_replace';
  removed: string;
  added: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'by',
  'with',
  'all',
  'day',
  'my',
  'our',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSpacing(value: string): string {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([•·—–:])\s+/g, ' $1 ')
    .replace(/^[\s•·—–:-]+/, '')
    .trim();
}

export function parseTitleParts(rawTitle: string): ParsedTitle {
  const raw = rawTitle.trim();
  let rest = raw;
  let tagPrefix = '';
  let datePrefix = '';
  let trailingSuffix = '';
  let chapterSep = '';
  let chapterPart = '';

  // 1. Optional bracket tag prefix like "[Auto] " or custom prefix before YYYY-MM
  const bracketMatch = rest.match(/^(\[[^\]]+\]\s+)/);
  if (bracketMatch) {
    tagPrefix = bracketMatch[1];
    rest = rest.slice(tagPrefix.length);
  } else {
    const customBeforeDate = rest.match(/^([^\d—–]+?\s+)(?=\d{4}-\d{2}\s*[•·\-–—]\s*)/);
    if (customBeforeDate) {
      tagPrefix = customBeforeDate[1];
      rest = rest.slice(tagPrefix.length);
    }
  }

  // 2. Optional YYYY-MM date prefix like "2026-08 • " or "2026-08 - "
  const dateMatch = rest.match(/^(\d{4}-\d{2}\s*[•·\-–—]\s*)/);
  if (dateMatch) {
    datePrefix = dateMatch[1];
    rest = rest.slice(datePrefix.length);
  }

  // 3. Optional trailing "(All)" or "(Aug 2026)"
  const trailingMatch = rest.match(/(\s*\((?:All|[A-Z][a-z]{2}\s+\d{4})\))$/);
  if (trailingMatch) {
    trailingSuffix = trailingMatch[1];
    rest = rest.slice(0, rest.length - trailingSuffix.length);
  }

  // 4. Optional chapter / subtitle separator (" — ", " – ", ": ", or trailing " • ")
  const sepCandidates = [' — ', ' – ', ': ', ' • '];
  for (const sep of sepCandidates) {
    const idx = rest.indexOf(sep);
    if (idx > 0 && idx + sep.length < rest.length) {
      chapterSep = sep;
      chapterPart = rest.slice(idx + sep.length).trim();
      rest = rest.slice(0, idx).trim();
      break;
    }
  }

  return {
    raw,
    tagPrefix,
    datePrefix,
    eventCore: rest.trim(),
    chapterSep,
    chapterPart,
    trailingSuffix,
  };
}

function assembleTitle(parts: {
  tagPrefix: string;
  datePrefix: string;
  eventCore: string;
  chapterSep: string;
  chapterPart: string;
  trailingSuffix: string;
}): string {
  const head = `${parts.tagPrefix}${parts.datePrefix}${parts.eventCore}`.trim();
  const withChapter =
    parts.chapterPart && parts.eventCore
      ? `${head}${parts.chapterSep || ' — '}${parts.chapterPart}`
      : head || parts.chapterPart;
  return normalizeSpacing(`${withChapter}${parts.trailingSuffix}`).slice(0, 140);
}

/**
 * Extracts a clean word-boundary diff between oldCore and newCore.
 */
function extractCoreDiff(oldCore: string, newCore: string): CoreDiff {
  const a = oldCore.trim();
  const b = newCore.trim();
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) {
    return { kind: 'none', removed: '', added: '' };
  }

  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();

  // Check pure prefix insertion: "Japan Autumn — Kyoto Trip" from "Kyoto Trip"
  if (lowerB.endsWith(lowerA)) {
    const prefix = b.slice(0, b.length - a.length);
    if (prefix.trim().length >= 3 && /[\s•·—–:-]$/.test(prefix)) {
      return { kind: 'prefix_add', removed: '', added: prefix };
    }
  }

  // Check pure suffix insertion: "Kyoto Trip 2026" from "Kyoto Trip"
  if (lowerB.startsWith(lowerA)) {
    const suffix = b.slice(a.length);
    if (suffix.trim().length >= 2 && /^[\s•·—–:(-]/.test(suffix)) {
      return { kind: 'suffix_add', removed: '', added: suffix };
    }
  }

  // Word-level common prefix / suffix diff
  const tokensA = a.split(/(\s+)/);
  const tokensB = b.split(/(\s+)/);

  let prefixLen = 0;
  while (
    prefixLen < tokensA.length &&
    prefixLen < tokensB.length &&
    tokensA[prefixLen].toLowerCase() === tokensB[prefixLen].toLowerCase()
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < tokensA.length - prefixLen &&
    suffixLen < tokensB.length - prefixLen &&
    tokensA[tokensA.length - 1 - suffixLen].toLowerCase() ===
      tokensB[tokensB.length - 1 - suffixLen].toLowerCase()
  ) {
    suffixLen++;
  }

  if (prefixLen > 0 || suffixLen > 0) {
    const removed = tokensA
      .slice(prefixLen, tokensA.length - suffixLen)
      .join('')
      .trim();
    const added = tokensB
      .slice(prefixLen, tokensB.length - suffixLen)
      .join('')
      .trim();

    if (
      removed.length >= 3 &&
      added.length >= 2 &&
      !STOP_WORDS.has(removed.toLowerCase())
    ) {
      return { kind: 'substitution', removed, added };
    }
  }

  return { kind: 'full_replace', removed: a, added: b };
}

function replaceWholePhrase(
  haystack: string,
  needle: string,
  replacement: string
): { changed: boolean; value: string } {
  const cleanNeedle = needle.trim();
  if (!cleanNeedle || cleanNeedle.length < 3) {
    return { changed: false, value: haystack };
  }
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(cleanNeedle)})(?=$|[^\\p{L}\\p{N}])`, 'giu');
  let changed = false;
  const value = haystack.replace(re, (_match, lead: string) => {
    changed = true;
    return `${lead}${replacement}`;
  });
  return { changed, value };
}

function computeTimelineGapHours(a: ClusterRecord, b: ClusterRecord): number {
  const aStart = Date.parse(a.startDate);
  const aEnd = Date.parse(a.endDate || a.startDate);
  const bStart = Date.parse(b.startDate);
  const bEnd = Date.parse(b.endDate || b.startDate);

  if (
    Number.isNaN(aStart) ||
    Number.isNaN(aEnd) ||
    Number.isNaN(bStart) ||
    Number.isNaN(bEnd)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  if (aStart <= bEnd && bStart <= aEnd) {
    return 0;
  }

  const gapMs = aEnd < bStart ? bStart - aEnd : aStart - bEnd;
  return Number((gapMs / 3_600_000).toFixed(1));
}

function formatTimelineLabel(sameParent: boolean, gapHours: number): string {
  if (sameParent) return 'Same event';
  if (gapHours <= 0.5) return 'Overlapping';
  if (gapHours < 24) return `${Math.max(1, Math.round(gapHours))}h apart`;
  const days = Math.round(gapHours / 24);
  return days === 1 ? '1 day apart' : `${days} days apart`;
}

function hasSharedNamedPeople(a: ClusterRecord, b: ClusterRecord): boolean {
  const aPeople = new Set(
    (a.signalBreakdown?.namedPeople || []).map((n) => n.trim().toLowerCase()).filter(Boolean)
  );
  if (aPeople.size === 0) return false;
  for (const name of b.signalBreakdown?.namedPeople || []) {
    if (aPeople.has(name.trim().toLowerCase())) return true;
  }
  return false;
}

function isSameLocation(a: ClusterRecord, b: ClusterRecord): boolean {
  const locA = (a.locationLabel || '').trim().toLowerCase();
  const locB = (b.locationLabel || '').trim().toLowerCase();
  if (!locA || !locB || locA === 'unknown location' || locB === 'unknown location') {
    return false;
  }
  return locA === locB;
}

/**
 * Analyzes an album rename (`oldTitle` -> `newTitle`) on `source` and proposes
 * reworked titles for other albums that are part of the same event or close on
 * the timeline (within `timelineWindowDays`).
 */
export function computeNearbyRenameSuggestions(
  source: ClusterRecord,
  oldTitle: string,
  newTitle: string,
  allClusters: ClusterRecord[],
  timelineWindowDays = 14
): RenameSuggestion[] {
  const cleanOld = oldTitle.trim();
  const cleanNew = newTitle.trim();
  if (!cleanOld || !cleanNew || cleanOld === cleanNew) {
    return [];
  }

  const maxGapHours = Math.max(1, timelineWindowDays) * 24;
  const oldParsed = parseTitleParts(cleanOld);
  const rawNewParsed = parseTitleParts(cleanNew);

  // If the original title had no chapter subtitle and the user prepended "Umbrella — <oldCore>"
  // (e.g. "Kalimpong Trip" -> "North Bengal — Kalimpong Trip"), keep it as a core prefix addition
  // instead of misreading "<oldCore>" as a chapter subtitle.
  const isPrependedUmbrella =
    !oldParsed.chapterPart &&
    Boolean(rawNewParsed.chapterPart) &&
    rawNewParsed.chapterPart.toLowerCase() === oldParsed.eventCore.toLowerCase();

  const newParsed: ParsedTitle = isPrependedUmbrella
    ? {
        ...rawNewParsed,
        eventCore: `${rawNewParsed.eventCore}${rawNewParsed.chapterSep}${rawNewParsed.chapterPart}`,
        chapterSep: '',
        chapterPart: '',
      }
    : rawNewParsed;

  const tagPrefixChanged = oldParsed.tagPrefix !== newParsed.tagPrefix;
  const datePrefixRemoved = oldParsed.datePrefix !== '' && newParsed.datePrefix === '';
  const coreChanged =
    oldParsed.eventCore.toLowerCase() !== newParsed.eventCore.toLowerCase() &&
    newParsed.eventCore.length > 0;
  const coreDiff = extractCoreDiff(oldParsed.eventCore, newParsed.eventCore);
  const formattingOnlyChange = !coreChanged && (tagPrefixChanged || datePrefixRemoved);

  const suggestions: RenameSuggestion[] = [];

  for (const cand of allClusters) {
    if (cand.id === source.id) continue;
    if (cand.status === 'discarded') continue;

    const sameParent =
      Boolean(source.parentEventId) &&
      Boolean(cand.parentEventId) &&
      source.parentEventId === cand.parentEventId;
    const gapHours = computeTimelineGapHours(source, cand);

    if (!sameParent && gapHours > maxGapHours) {
      continue;
    }

    const candParsed = parseTitleParts(cand.title);
    let nextTagPrefix = candParsed.tagPrefix;
    let nextDatePrefix = candParsed.datePrefix;
    let nextCore = candParsed.eventCore;
    let nextChapterSep = candParsed.chapterSep;
    let nextChapterPart = candParsed.chapterPart;
    const nextTrailing = candParsed.trailingSuffix;

    const reasons: string[] = [];
    let confidence: 'high' | 'medium' = 'high';
    let coreWasUpdated = false;

    // 1. Tag prefix propagation (e.g. removing "[Auto] " or changing "[Auto] " -> "Travel • ")
    if (
      tagPrefixChanged &&
      oldParsed.tagPrefix !== '' &&
      candParsed.tagPrefix.toLowerCase() === oldParsed.tagPrefix.toLowerCase()
    ) {
      nextTagPrefix = newParsed.tagPrefix;
      reasons.push(
        newParsed.tagPrefix
          ? `Prefix "${oldParsed.tagPrefix.trim()}" → "${newParsed.tagPrefix.trim()}"`
          : `Removed "${oldParsed.tagPrefix.trim()}" prefix`
      );
    }

    // 2. Core / event name propagation
    if (coreChanged) {
      if (sameParent) {
        // Same parent event (master <-> chapters): update event core cleanly while preserving chapter subtitle
        const matchesSourceCore =
          candParsed.eventCore.toLowerCase() === oldParsed.eventCore.toLowerCase() ||
          (cand.parentEventName &&
            candParsed.eventCore.toLowerCase() === cand.parentEventName.toLowerCase()) ||
          (source.parentEventName &&
            candParsed.eventCore.toLowerCase() === source.parentEventName.toLowerCase());

        if (matchesSourceCore) {
          nextCore = newParsed.eventCore;
          coreWasUpdated = true;
          reasons.push('Updated shared event name');
        } else {
          const phraseSub = replaceWholePhrase(
            candParsed.eventCore,
            oldParsed.eventCore,
            newParsed.eventCore
          );
          if (phraseSub.changed) {
            nextCore = phraseSub.value;
            coreWasUpdated = true;
            reasons.push('Updated shared event name');
          }
        }
      } else {
        // Different event within timeline window
        // 2a. Exact whole-core phrase match
        const exactCoreSub = replaceWholePhrase(
          candParsed.eventCore,
          oldParsed.eventCore,
          newParsed.eventCore
        );
        if (exactCoreSub.changed) {
          nextCore = exactCoreSub.value;
          coreWasUpdated = true;
          reasons.push(`Replaced "${oldParsed.eventCore}" → "${newParsed.eventCore}"`);
        } else if (coreDiff.kind === 'substitution') {
          // 2b. Word/phrase substitution (e.g. "Panaji" -> "Goa", "Koramangala" -> "Indiranagar")
          const subCore = replaceWholePhrase(candParsed.eventCore, coreDiff.removed, coreDiff.added);
          const subChapter = candParsed.chapterPart
            ? replaceWholePhrase(candParsed.chapterPart, coreDiff.removed, coreDiff.added)
            : { changed: false, value: candParsed.chapterPart };

          if (subCore.changed || subChapter.changed) {
            nextCore = subCore.value;
            nextChapterPart = subChapter.value;
            coreWasUpdated = true;
            reasons.push(`Replaced "${coreDiff.removed}" → "${coreDiff.added}"`);
          }
        } else if (coreDiff.kind === 'prefix_add') {
          // 2c. Added qualifier prefix (e.g. "Japan Autumn — Kyoto Trip" -> "Japan Autumn — Osaka Trip")
          const cleanAdded = coreDiff.added.trim();
          if (
            cleanAdded.length >= 3 &&
            !candParsed.eventCore.toLowerCase().startsWith(cleanAdded.toLowerCase())
          ) {
            nextCore = `${coreDiff.added}${candParsed.eventCore}`;
            coreWasUpdated = true;
            reasons.push(`Added "${cleanAdded}" prefix`);
            confidence = gapHours <= 7 * 24 || isSameLocation(source, cand) ? 'high' : 'medium';
          }
        } else if (coreDiff.kind === 'suffix_add') {
          // 2d. Added qualifier suffix (e.g. "Kyoto Trip 2026" -> "Osaka Trip 2026")
          const cleanAdded = coreDiff.added.trim();
          if (
            cleanAdded.length >= 2 &&
            !candParsed.eventCore.toLowerCase().endsWith(cleanAdded.toLowerCase())
          ) {
            nextCore = `${candParsed.eventCore}${coreDiff.added}`;
            coreWasUpdated = true;
            reasons.push(`Added "${cleanAdded}" suffix`);
            confidence = gapHours <= 7 * 24 || isSameLocation(source, cand) ? 'high' : 'medium';
          }
        } else if (coreDiff.kind === 'full_replace') {
          // 2e. Same location full rename or very-close-timeline event umbrella
          const sameLoc = isSameLocation(source, cand);
          const sharedPeople = hasSharedNamedPeople(source, cand);
          const locName = (source.locationLabel || '').trim();

          if (
            sameLoc &&
            locName.length >= 3 &&
            oldParsed.eventCore.toLowerCase().includes(locName.toLowerCase()) &&
            candParsed.eventCore.toLowerCase().includes(locName.toLowerCase())
          ) {
            // e.g. renamed "Panaji Trip" -> "Goa Vacation"; nearby album is "Panaji Gathering" or "Panaji — Sunset"
            const candCoreLower = candParsed.eventCore.toLowerCase();
            const locLower = locName.toLowerCase();
            if (
              candCoreLower === locLower ||
              candCoreLower === `${locLower} trip` ||
              candCoreLower === `${locLower} local event`
            ) {
              nextCore = newParsed.eventCore;
              coreWasUpdated = true;
              reasons.push(`Same location (${locName})`);
              confidence = gapHours <= 5 * 24 ? 'high' : 'medium';
            } else {
              // Preserve the candidate's distinct descriptor as a subtitle under the new umbrella name
              const remainder = candParsed.eventCore
                .replace(new RegExp(`^${escapeRegExp(locName)}\\s*`, 'i'), '')
                .trim();
              nextCore = newParsed.eventCore;
              if (remainder && !nextChapterPart) {
                nextChapterSep = ' — ';
                nextChapterPart = remainder;
              }
              coreWasUpdated = true;
              reasons.push(`Same location (${locName})`);
              confidence = 'medium';
            }
          } else if (
            gapHours <= 72 &&
            (sameLoc || sharedPeople) &&
            cand.title === cand.proposedTitle &&
            newParsed.eventCore.toLowerCase() !== candParsed.eventCore.toLowerCase()
          ) {
            // Very close on the timeline (<= 3 days), same location or recognized people,
            // and candidate still has its generic auto-generated name: offer adopting the new event umbrella.
            const preserveDetail =
              candParsed.chapterPart ||
              (cand.occasionLabel &&
              !newParsed.eventCore.toLowerCase().includes(cand.occasionLabel.toLowerCase())
                ? cand.occasionLabel
                : candParsed.eventCore);

            nextCore = newParsed.eventCore;
            if (
              preserveDetail &&
              preserveDetail.toLowerCase() !== newParsed.eventCore.toLowerCase()
            ) {
              nextChapterSep = ' — ';
              nextChapterPart = preserveDetail;
            }
            coreWasUpdated = true;
            reasons.push(sameLoc ? 'Nearby in same location' : 'Nearby with same people');
            confidence = 'medium';
          }
        }
      }
    }

    // 3. Date prefix removal propagation:
    // Apply when same event, formatting-only edit, or when core also matched on this nearby album.
    if (
      datePrefixRemoved &&
      candParsed.datePrefix !== '' &&
      (sameParent || formattingOnlyChange || coreWasUpdated)
    ) {
      nextDatePrefix = '';
      if (!reasons.some((r) => r.includes('date'))) {
        reasons.push('Removed date prefix');
      }
    }

    if (reasons.length === 0) {
      continue;
    }

    const suggestedTitle = assembleTitle({
      tagPrefix: nextTagPrefix,
      datePrefix: nextDatePrefix,
      eventCore: nextCore,
      chapterSep: nextChapterSep,
      chapterPart: nextChapterPart,
      trailingSuffix: nextTrailing,
    });

    if (!suggestedTitle || suggestedTitle === cand.title) {
      continue;
    }

    const timelineLabel = formatTimelineLabel(sameParent, gapHours);
    const selectedByDefault = confidence === 'high' && cand.status !== 'synced';

    suggestions.push({
      clusterId: cand.id,
      currentTitle: cand.title,
      suggestedTitle,
      clusterType: cand.clusterType,
      status: cand.status,
      startDate: cand.startDate,
      endDate: cand.endDate,
      gapHours: sameParent ? 0 : gapHours,
      timelineLabel,
      reason: reasons.slice(0, 2).join(' · '),
      confidence,
      selectedByDefault,
    });
  }

  // Sort: same event first, then high confidence, then closest on timeline
  suggestions.sort((a, b) => {
    const aSame = a.timelineLabel === 'Same event' ? 0 : 1;
    const bSame = b.timelineLabel === 'Same event' ? 0 : 1;
    if (aSame !== bSame) return aSame - bSame;
    if (a.confidence !== b.confidence) return a.confidence === 'high' ? -1 : 1;
    return a.gapHours - b.gapHours;
  });

  return suggestions;
}
