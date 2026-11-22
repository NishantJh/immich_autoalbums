export interface PaletteSwatch {
  hex: string;
  l: number; // 0..100
  a: number; // -128..127
  b: number; // -128..127
  weight: number; // 0..1
}

export interface LabHistogram {
  l: number[]; // 12 bins
  a: number[]; // 12 bins
  b: number[]; // 12 bins
}

export interface LabMean {
  l: number;
  a: number;
  b: number;
  chroma: number;
}

export type AestheticMood =
  | 'Golden Hour'
  | 'Lush Nature'
  | 'Vibrant Night'
  | 'Monochrome'
  | 'Coastal Daylight'
  | 'Warm Indoor'
  | 'Balanced Daylight';

export interface AssetRecord {
  id: string;
  source: 'upload' | 'immich';
  fileName: string;
  originalPath: string;
  localDateTime: string;
  city: string | null;
  state: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  exifMake: string | null;
  exifModel: string | null;
  lensModel: string | null;
  focalLength: number | null;
  iso: number | null;
  isFavorite: boolean;
  width: number;
  height: number;
  isArchived: boolean;
  isTrashed: boolean;
  isAlreadyAlbumed: boolean;
  isScreenshot: boolean;
  excludedReason: string | null;
  peopleIds: string[];
  peopleNames: string[];
  smartTags: string[];
  thumbnailUrl: string;
  avgLab: LabMean | null;
  palette: PaletteSwatch[];
  cachedFeature: boolean;
}

export interface EmdTimelinePoint {
  index: number;
  assetId: string;
  fileName: string;
  timestamp: string;
  emdScore: number;
  compositeScore?: number;
  gpsShift?: number;
  semanticShift?: number;
  peopleShift?: number;
  exifShift?: number;
  splitSignals?: string[];
  gapMinutes: number;
  labL: number;
  labB: number; // warm (+) vs cool (-)
  isSplitBoundary: boolean;
  chapterIndex: number;
}

export type ClusterStatus = 'pending' | 'approved' | 'synced' | 'discarded';
export type ClusterType = 'trip' | 'local_event' | 'chapter';

export interface ClusterSignalBreakdown {
  gps: boolean;
  immichMl: boolean;
  chroma: boolean;
  faces: boolean;
  exif: boolean;
  favoriteCount: number;
  topTags: string[];
  namedPeople: string[];
}

export interface ClusterRecord {
  id: string;
  clusterHash: string;
  parentEventId: string | null;
  parentEventName: string | null;
  clusterType: ClusterType;
  title: string;
  proposedTitle: string;
  locationLabel: string;
  moodLabel: AestheticMood;
  occasionLabel: string | null;
  startDate: string;
  endDate: string;
  palette: PaletteSwatch[];
  avgLab: LabMean;
  emdBoundaryScore: number;
  signalBreakdown?: ClusterSignalBreakdown;
  status: ClusterStatus;
  immichAlbumId: string | null;
  syncedAssetCount: number;
  assetIds: string[];
  assets?: AssetRecord[];
  emdSeries?: EmdTimelinePoint[];
  updatedAt: string;
}

export type HomeBaseMode = 'auto' | 'manual' | 'disabled';

export interface CandidateHomeBase {
  city: string;
  country: string | null;
  geohash: string;
  lat: number;
  lng: number;
  assetCount: number;
  distinctDays: number;
}

export interface OrganizerSettings {
  homeRadiusKm: number;
  tripGapHours: number;
  localEventRadiusMeters: number;
  localEventGapHours: number;
  sceneSplitGapMins: number;
  emdThreshold: number;
  minPhotosPerAlbum: number;
  titlePrefix: string;
  useStructuredPrefix: boolean;
  createMasterAlbum: boolean;
  createMoodSubalbums: boolean;
  ignoreScreenshots: boolean;
  excludedPaths: string[];
  homeBaseMode: HomeBaseMode;
  homeBaseCityOverride: string;
  homeBaseLatOverride: number | null;
  homeBaseLngOverride: number | null;
  scanIntervalHours: number;
  maxAssetsPerPull: number; // 0 = All Photos
  lastScanAt: string | null;
}

export interface Stage1Stats {
  totalAssets: number;
  excludedArchivedOrTrashed: number;
  excludedAlreadyAlbumed: number;
  excludedScreenshots: number;
  excludedByPathRule: number;
  eligibleAssets: number;
  cacheHits: number;
  newlyExtracted: number;
}

export interface Stage2Stats {
  homeBaseCity: string;
  homeBaseCountry: string | null;
  homeBaseGeohash: string;
  homeBaseLat: number;
  homeBaseLng: number;
  homeBaseAssetCount: number;
  homeBaseDistinctDays: number;
  homeBaseSource: HomeBaseMode;
  candidateHomeBases: CandidateHomeBase[];
  householdPeopleIds: string[];
  macroTripCount: number;
  localEventCount: number;
  bridgedNoGpsCount?: number;
  gpsTaggedCount?: number;
  mlTaggedCount?: number;
  faceTaggedCount?: number;
  unclusteredNoiseCount: number;
}

export interface Stage3Stats {
  eventsEvaluated: number;
  sceneSplitsDetected: number;
  totalChaptersCreated: number;
  moodDistribution: Record<string, number>;
  signalUsage?: {
    chroma: number;
    immichMl: number;
    gps: number;
    faces: number;
    exif: number;
  };
}

export interface PipelineRunSummary {
  runAt: string;
  durationMs: number;
  stage1: Stage1Stats;
  stage2: Stage2Stats;
  stage3: Stage3Stats;
  totalProposedAlbums: number;
  eventTimelines: Array<{
    eventId: string;
    eventName: string;
    locationLabel: string;
    clusterType: 'trip' | 'local_event';
    photoCount: number;
    chapterCount: number;
    points: EmdTimelinePoint[];
  }>;
}

export interface SyncHistoryRecord {
  id: string;
  clusterId: string;
  clusterHash: string;
  immichAlbumId: string;
  albumTitle: string;
  action: 'created' | 'appended';
  addedCount: number;
  totalInAlbum: number;
  mode: 'live_immich' | 'local_ledger';
  syncedAt: string;
}

export interface ImmichStatus {
  configured: boolean;
  reachable: boolean;
  source: 'env' | 'saved' | null;
  baseUrl: string | null;
  hostLabel: string | null;
  maskedApiKey: string | null;
  serverVersion: string | null;
  lastError: string | null;
}

export interface DashboardBootstrap {
  immichStatus: ImmichStatus;
  settings: OrganizerSettings;
  clusters: ClusterRecord[];
  assets: AssetRecord[];
  pipelineSummary: PipelineRunSummary | null;
  syncHistory: SyncHistoryRecord[];
}

export type PullPhase =
  | 'idle'
  | 'connecting'
  | 'albums'
  | 'metadata'
  | 'smart_search'
  | 'thumbnails'
  | 'saving'
  | 'clustering'
  | 'done'
  | 'error';

export interface PullProgressState {
  active: boolean;
  phase: PullPhase;
  percent: number;
  label: string;
  detail: string;
  current: number;
  total: number;
  cachedCount: number;
  ingestedCount: number;
  cancelRequested: boolean;
  startedAt: string | null;
  updatedAt: string;
  error: string | null;
}

export interface RenameSuggestion {
  clusterId: string;
  currentTitle: string;
  suggestedTitle: string;
  clusterType: ClusterType;
  status: ClusterStatus;
  startDate: string;
  endDate: string;
  gapHours: number;
  timelineLabel: string;
  reason: string;
  confidence: 'high' | 'medium';
  selectedByDefault: boolean;
}
