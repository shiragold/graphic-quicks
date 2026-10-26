export interface AlbumSummary {
  name: string;
  count: number;
  /** iCloud shared album (as opposed to a regular album in the library). */
  shared: boolean;
}

export interface PhotoSummary {
  uuid: string;
  filename: string;
  /** Capture date as reported by Photos (ISO 8601, with offset). */
  date: string;
  width: number;
  height: number;
  isMovie: boolean;
  favorite: boolean;
  /** Photos' overall aesthetic score, roughly 0..1; null when Photos has not scored it. */
  score: number | null;
  albums: string[];
  persons: string[];
  labels: string[];
  title: string | null;
  description: string | null;
  /** Original file on disk; null when it lives only in iCloud. */
  path: string | null;
  /** Largest Photos-generated preview JPEG, if any. */
  previewPath: string | null;
  missing: boolean;
  shared: boolean;
}

export type SortOrder = 'score' | 'date';

export interface QueryOptions {
  /** Album names (folder paths as `Folder/Album`); multiple values are OR'd. */
  album?: string[];
  /** Names from Photos' People; multiple values are OR'd. */
  person?: string[];
  /** Inclusive start date, `YYYY-MM-DD` or full ISO 8601. */
  from?: string;
  /** Exclusive end date, `YYYY-MM-DD` or full ISO 8601. */
  to?: string;
  /** Centre of a date window, `YYYY-MM-DD`; combined with `days`. Overrides from/to. */
  around?: string;
  /** Half-width of the `around` window in days (default 2). */
  days?: number;
  minScore?: number;
  includeMovies?: boolean;
  sort?: SortOrder;
  limit?: number;
}

export type PhotoVersion = 'original' | 'edited' | 'both';

export interface ExportOptions {
  /** `original`, `edited` (falls back to original when unedited), or `both`. Default `edited`. */
  version?: PhotoVersion;
  convertToJpeg?: boolean;
  /** Ask Photos.app to fetch originals that are only in iCloud (slow; needs Automation permission). */
  downloadMissing?: boolean;
}

export interface Thumbnail {
  uuid: string;
  mimeType: 'image/jpeg';
  data: Buffer;
}
