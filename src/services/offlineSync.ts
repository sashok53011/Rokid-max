export type DeviceProfile = 'desktop' | 'mobile' | 'vr_headset' | 'rokid_max';

export interface OfflineAnalyticsItem {
  id: string;
  moduleId: 'turbine' | 'gearbox' | 'robotarm' | 'spectrometer' | 'custom';
  actionType:
    | 'session_started'
    | 'part_snapped'
    | 'module_completed'
    | 'qr_imported'
    | 'physics_drop'
    | 'gesture_triggered';
  accuracyPct: number;
  durationMs: number;
  collisions: number;
  deviceMode: DeviceProfile;
  createdAtMs: number;
}

export interface PartTransformRecord {
  id: string;
  x: number;
  y: number;
  z: number;
  snapped: boolean;
}

export interface RoomBoundsSpec {
  width: number;
  depth: number;
  height: number;
  originX: number;
  originY: number;
  originZ: number;
  yawDeg?: number;
  markerId?: string;
  name?: string;
}

export interface RokidProfileSpec {
  fov: number;
  ipdMm: number;
  sbsMode: boolean;
  additiveDimming: number;
}

export interface SavedSpatialMapping {
  id: string;
  ownerId: string;
  name: string;
  moduleId: string;
  roomBounds: RoomBoundsSpec;
  partTransforms: PartTransformRecord[];
  rokidProfile: RokidProfileSpec;
  isShared: boolean;
  updatedAtMs: number;
  syncedToCloud: boolean;
}

export interface SpatialFramePartPose {
  id: string;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  snapped: boolean;
}

export interface SpatialRecordingFrame {
  t: number;
  exploded: number;
  parts: SpatialFramePartPose[];
}

export type SpatialRecordingEventType =
  | 'grab'
  | 'release'
  | 'snap'
  | 'collision'
  | 'exploded'
  | 'complete';

export interface SpatialRecordingEvent {
  t: number;
  type: SpatialRecordingEventType;
  partId: string;
  partLabel: string;
  accuracyPct: number;
  x: number;
  y: number;
  z: number;
}

export interface SpatialRecording {
  id: string;
  ownerId: string;
  name: string;
  moduleId: string;
  deviceMode: DeviceProfile;
  durationMs: number;
  frameCount: number;
  snapCount: number;
  collisionCount: number;
  avgAccuracyPct: number;
  frames: SpatialRecordingFrame[];
  events: SpatialRecordingEvent[];
  isShared: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  syncedToCloud: boolean;
}

const ANALYTICS_KEY = 'aerolab_xr_offline_analytics_v1';
const ANALYTICS_HISTORY_KEY = 'aerolab_xr_local_analytics_history_v1';
const MAPPINGS_KEY = 'aerolab_xr_local_mappings_v1';
const MAPPING_QUEUE_KEY = 'aerolab_xr_pending_mappings_v1';
const RECORDINGS_KEY = 'aerolab_xr_local_recordings_v1';
const RECORDING_QUEUE_KEY = 'aerolab_xr_pending_recordings_v1';
const FIELD_OFFLINE_KEY = 'aerolab_xr_field_offline_mode';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class OfflineSyncStore {
  private fieldOfflineMode = readJson<boolean>(FIELD_OFFLINE_KEY, false);

  isFieldOfflineMode(): boolean {
    return this.fieldOfflineMode;
  }

  setFieldOfflineMode(enabled: boolean) {
    this.fieldOfflineMode = enabled;
    writeJson(FIELD_OFFLINE_KEY, enabled);
  }

  isEffectivelyOffline(): boolean {
    return this.fieldOfflineMode || (typeof navigator !== 'undefined' && !navigator.onLine);
  }

  queueAnalytics(item: OfflineAnalyticsItem) {
    const queue = readJson<OfflineAnalyticsItem[]>(ANALYTICS_KEY, []);
    queue.push(item);
    writeJson(ANALYTICS_KEY, queue.slice(-200));

    const history = readJson<OfflineAnalyticsItem[]>(ANALYTICS_HISTORY_KEY, []);
    history.unshift(item);
    writeJson(ANALYTICS_HISTORY_KEY, history.slice(0, 60));
  }

  recordLocalAnalyticsHistory(item: OfflineAnalyticsItem) {
    const history = readJson<OfflineAnalyticsItem[]>(ANALYTICS_HISTORY_KEY, []);
    history.unshift(item);
    writeJson(ANALYTICS_HISTORY_KEY, history.slice(0, 60));
  }

  getLocalAnalyticsHistory(): OfflineAnalyticsItem[] {
    return readJson<OfflineAnalyticsItem[]>(ANALYTICS_HISTORY_KEY, []);
  }

  getPendingAnalytics(): OfflineAnalyticsItem[] {
    return readJson<OfflineAnalyticsItem[]>(ANALYTICS_KEY, []);
  }

  clearPendingAnalytics(syncedIds: Set<string>) {
    const remaining = this.getPendingAnalytics().filter((item) => !syncedIds.has(item.id));
    writeJson(ANALYTICS_KEY, remaining);
  }

  saveLocalMapping(mapping: SavedSpatialMapping, enqueueCloudSync: boolean) {
    const list = this.getLocalMappings().filter((m) => m.id !== mapping.id);
    list.unshift(mapping);
    writeJson(MAPPINGS_KEY, list.slice(0, 30));

    if (enqueueCloudSync) {
      const queue = readJson<SavedSpatialMapping[]>(MAPPING_QUEUE_KEY, []).filter(
        (m) => m.id !== mapping.id,
      );
      queue.push(mapping);
      writeJson(MAPPING_QUEUE_KEY, queue.slice(-30));
    }
  }

  deleteLocalMapping(id: string) {
    const list = this.getLocalMappings().filter((m) => m.id !== id);
    writeJson(MAPPINGS_KEY, list);
    const queue = readJson<SavedSpatialMapping[]>(MAPPING_QUEUE_KEY, []).filter((m) => m.id !== id);
    writeJson(MAPPING_QUEUE_KEY, queue);
  }

  getLocalMappings(): SavedSpatialMapping[] {
    return readJson<SavedSpatialMapping[]>(MAPPINGS_KEY, []);
  }

  getPendingMappings(): SavedSpatialMapping[] {
    return readJson<SavedSpatialMapping[]>(MAPPING_QUEUE_KEY, []);
  }

  markMappingsSynced(syncedIds: Set<string>) {
    const queue = this.getPendingMappings().filter((m) => !syncedIds.has(m.id));
    writeJson(MAPPING_QUEUE_KEY, queue);
    const list = this.getLocalMappings().map((m) =>
      syncedIds.has(m.id) ? { ...m, syncedToCloud: true } : m,
    );
    writeJson(MAPPINGS_KEY, list);
  }

  saveLocalRecording(recording: SpatialRecording, enqueueCloudSync: boolean) {
    let list = this.getLocalRecordings().filter((r) => r.id !== recording.id);
    list.unshift(recording);
    list = list.slice(0, 12);
    while (list.length > 1 && !writeJson(RECORDINGS_KEY, list)) {
      list = list.slice(0, list.length - 1);
    }
    if (list.length === 1) {
      writeJson(RECORDINGS_KEY, list);
    }

    if (enqueueCloudSync) {
      let queue = this.getPendingRecordings().filter((r) => r.id !== recording.id);
      queue.push(recording);
      queue = queue.slice(-12);
      while (queue.length > 1 && !writeJson(RECORDING_QUEUE_KEY, queue)) {
        queue = queue.slice(1);
      }
      if (queue.length === 1) {
        writeJson(RECORDING_QUEUE_KEY, queue);
      }
    }
  }

  deleteLocalRecording(id: string) {
    const list = this.getLocalRecordings().filter((r) => r.id !== id);
    writeJson(RECORDINGS_KEY, list);
    const queue = this.getPendingRecordings().filter((r) => r.id !== id);
    writeJson(RECORDING_QUEUE_KEY, queue);
  }

  getLocalRecordings(): SpatialRecording[] {
    return readJson<SpatialRecording[]>(RECORDINGS_KEY, []);
  }

  getPendingRecordings(): SpatialRecording[] {
    return readJson<SpatialRecording[]>(RECORDING_QUEUE_KEY, []);
  }

  markRecordingsSynced(syncedIds: Set<string>) {
    const queue = this.getPendingRecordings().filter((r) => !syncedIds.has(r.id));
    writeJson(RECORDING_QUEUE_KEY, queue);
    const list = this.getLocalRecordings().map((r) =>
      syncedIds.has(r.id) ? { ...r, syncedToCloud: true } : r,
    );
    writeJson(RECORDINGS_KEY, list);
  }

  getPendingCount(): number {
    return (
      this.getPendingAnalytics().length +
      this.getPendingMappings().length +
      this.getPendingRecordings().length
    );
  }
}

export const offlineStore = new OfflineSyncStore();
