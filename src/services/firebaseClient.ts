import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  offlineStore,
  type DeviceProfile,
  type OfflineAnalyticsItem,
  type SavedSpatialMapping,
  type SpatialRecording,
  type SpatialRecordingEventType,
} from './offlineSync.ts';
import type { SupportedLang } from '../i18n/translations.ts';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function sanitizeId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return clean || `id_${Date.now()}`;
}

export async function signInWithGoogle(): Promise<User | null> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export function subscribeAuth(cb: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, cb);
}

export async function syncUserProfile(
  user: User,
  preferredLang: SupportedLang,
  deviceProfile: DeviceProfile,
): Promise<void> {
  if (offlineStore.isEffectivelyOffline() || !user.emailVerified) return;
  const uid = sanitizeId(user.uid);
  const displayName = (user.displayName || 'Operator').slice(0, 64);

  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    const existingUser = await getDoc(userRef);
    if (!existingUser.exists()) {
      await setDoc(userRef, {
        uid,
        displayName,
        preferredLang,
        deviceProfile,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        preferredLang,
        deviceProfile,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (user.email) {
    const privatePath = `users/${uid}/private/info`;
    const privateRef = doc(db, 'users', uid, 'private', 'info');
    try {
      const existingPrivate = await getDoc(privateRef);
      const email = user.email.slice(0, 160);
      if (!existingPrivate.exists()) {
        await setDoc(privateRef, {
          uid,
          email,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

export async function logAnalyticsEvent(
  event: Omit<OfflineAnalyticsItem, 'id' | 'createdAtMs'>,
): Promise<void> {
  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const item: OfflineAnalyticsItem = {
    ...event,
    id,
    accuracyPct: Math.max(0, Math.min(100, Math.round(event.accuracyPct * 10) / 10)),
    durationMs: Math.max(0, Math.min(86400000, Math.round(event.durationMs))),
    collisions: Math.max(0, Math.min(10000, Math.round(event.collisions))),
    createdAtMs: Date.now(),
  };

  const user = auth.currentUser;
  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) {
    offlineStore.queueAnalytics(item);
    return;
  }

  offlineStore.recordLocalAnalyticsHistory(item);
  const path = `analyticsEvents/${id}`;
  try {
    await setDoc(doc(db, 'analyticsEvents', id), {
      userId: user.uid,
      moduleId: item.moduleId,
      actionType: item.actionType,
      accuracyPct: item.accuracyPct,
      durationMs: item.durationMs,
      collisions: item.collisions,
      deviceMode: item.deviceMode,
      offlineSynced: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    offlineStore.queueAnalytics(item);
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeAnalyticsEvents(
  userId: string,
  onUpdate: (events: OfflineAnalyticsItem[]) => void,
): Unsubscribe {
  const path = 'analyticsEvents';
  const q = query(
    collection(db, path),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(40),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: OfflineAnalyticsItem[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
        return {
          id: d.id,
          moduleId: data.moduleId,
          actionType: data.actionType,
          accuracyPct: Number(data.accuracyPct ?? 0),
          durationMs: Number(data.durationMs ?? 0),
          collisions: Number(data.collisions ?? 0),
          deviceMode: data.deviceMode,
          createdAtMs: ts,
        };
      });
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function saveSpatialMapping(mapping: Omit<SavedSpatialMapping, 'id' | 'ownerId' | 'updatedAtMs' | 'syncedToCloud'> & { id?: string }): Promise<SavedSpatialMapping> {
  const user = auth.currentUser;
  const id = sanitizeId(mapping.id || `map_${Date.now().toString(36)}`);
  const ownerId = user?.uid || 'offline_operator';
  const clampedTransforms = mapping.partTransforms.slice(0, 24).map((p) => ({
    id: String(p.id).slice(0, 64),
    x: Number(p.x.toFixed(4)),
    y: Number(p.y.toFixed(4)),
    z: Number(p.z.toFixed(4)),
    snapped: Boolean(p.snapped),
  }));

  const localRecord: SavedSpatialMapping = {
    id,
    ownerId,
    name: mapping.name.trim().slice(0, 80) || 'Workbench Calibration',
    moduleId: sanitizeId(mapping.moduleId).slice(0, 40),
    roomBounds: {
      width: Math.max(0.5, Math.min(50, mapping.roomBounds.width)),
      depth: Math.max(0.5, Math.min(50, mapping.roomBounds.depth)),
      height: Math.max(1, Math.min(20, mapping.roomBounds.height)),
      originX: Math.max(-25, Math.min(25, mapping.roomBounds.originX)),
      originY: Math.max(-10, Math.min(10, mapping.roomBounds.originY)),
      originZ: Math.max(-25, Math.min(25, mapping.roomBounds.originZ)),
    },
    partTransforms: clampedTransforms,
    rokidProfile: {
      fov: Math.max(30, Math.min(120, mapping.rokidProfile.fov)),
      ipdMm: Math.max(50, Math.min(78, mapping.rokidProfile.ipdMm)),
      sbsMode: Boolean(mapping.rokidProfile.sbsMode),
      additiveDimming: Math.max(0, Math.min(1, mapping.rokidProfile.additiveDimming)),
    },
    isShared: Boolean(mapping.isShared),
    updatedAtMs: Date.now(),
    syncedToCloud: false,
  };

  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) {
    offlineStore.saveLocalMapping(localRecord, true);
    return localRecord;
  }

  const path = `spatialMappings/${id}`;
  try {
    await setDoc(doc(db, 'spatialMappings', id), {
      ownerId: user.uid,
      name: localRecord.name,
      moduleId: localRecord.moduleId,
      roomBounds: localRecord.roomBounds,
      partTransforms: localRecord.partTransforms,
      rokidProfile: localRecord.rokidProfile,
      isShared: localRecord.isShared,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    localRecord.syncedToCloud = true;
    offlineStore.saveLocalMapping(localRecord, false);
    return localRecord;
  } catch (error) {
    offlineStore.saveLocalMapping(localRecord, true);
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeSpatialMappings(
  userId: string,
  onUpdate: (mappings: SavedSpatialMapping[]) => void,
): Unsubscribe {
  const path = 'spatialMappings';
  const q = query(
    collection(db, path),
    where('ownerId', '==', userId),
    orderBy('updatedAt', 'desc'),
    limit(20),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: SavedSpatialMapping[] = snap.docs.map((d) => {
        const data = d.data();
        const ts = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : Date.now();
        return {
          id: d.id,
          ownerId: data.ownerId,
          name: data.name,
          moduleId: data.moduleId,
          roomBounds: data.roomBounds,
          partTransforms: data.partTransforms || [],
          rokidProfile: data.rokidProfile,
          isShared: Boolean(data.isShared),
          updatedAtMs: ts,
          syncedToCloud: true,
        };
      });
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function deleteSpatialMapping(id: string): Promise<void> {
  offlineStore.deleteLocalMapping(id);
  const user = auth.currentUser;
  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) return;
  const path = `spatialMappings/${id}`;
  try {
    await deleteDoc(doc(db, 'spatialMappings', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

const VALID_RECORDING_EVENT_TYPES = new Set<SpatialRecordingEventType>([
  'grab',
  'release',
  'snap',
  'collision',
  'exploded',
  'complete',
]);

function clampSpatialRecordingPayload(
  recording: Omit<SpatialRecording, 'id' | 'ownerId' | 'createdAtMs' | 'updatedAtMs' | 'syncedToCloud'> & {
    id?: string;
    createdAtMs?: number;
  },
  ownerId: string,
): SpatialRecording {
  const id = sanitizeId(recording.id || `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
  const rawFrames = Array.isArray(recording.frames) ? recording.frames : [];
  // Downsample frames to at most 450 while keeping first and last keyframes
  let sampledFrames = rawFrames;
  if (rawFrames.length > 450) {
    sampledFrames = [];
    const step = (rawFrames.length - 1) / 449;
    for (let i = 0; i < 450; i++) {
      const idx = Math.min(rawFrames.length - 1, Math.round(i * step));
      sampledFrames.push(rawFrames[idx]);
    }
  }
  const cleanFrames = (
    sampledFrames.length > 0
      ? sampledFrames
      : [{ t: 0, exploded: 0, parts: [] }]
  ).map((frame) => ({
    t: Math.max(0, Math.min(86400000, Math.round(Number(frame.t) || 0))),
    exploded: Math.max(0, Math.min(1, Number((Number(frame.exploded) || 0).toFixed(3)))),
    parts: (Array.isArray(frame.parts) ? frame.parts : []).slice(0, 24).map((p) => ({
      id: String(p.id || 'part').slice(0, 64),
      x: Number((Number(p.x) || 0).toFixed(4)),
      y: Number((Number(p.y) || 0).toFixed(4)),
      z: Number((Number(p.z) || 0).toFixed(4)),
      qx: Number((Number(p.qx) || 0).toFixed(4)),
      qy: Number((Number(p.qy) || 0).toFixed(4)),
      qz: Number((Number(p.qz) || 0).toFixed(4)),
      qw: Number((Number.isFinite(Number(p.qw)) ? Number(p.qw) : 1).toFixed(4)),
      snapped: Boolean(p.snapped),
    })),
  }));

  const cleanEvents = (Array.isArray(recording.events) ? recording.events : [])
    .slice(0, 200)
    .map((ev) => ({
      t: Math.max(0, Math.min(86400000, Math.round(Number(ev.t) || 0))),
      type: VALID_RECORDING_EVENT_TYPES.has(ev.type) ? ev.type : 'grab',
      partId: String(ev.partId || '').slice(0, 64),
      partLabel: String(ev.partLabel || '').slice(0, 80),
      accuracyPct: Math.max(0, Math.min(100, Number((Number(ev.accuracyPct) || 0).toFixed(1)))),
      x: Number((Number(ev.x) || 0).toFixed(4)),
      y: Number((Number(ev.y) || 0).toFixed(4)),
      z: Number((Number(ev.z) || 0).toFixed(4)),
    }));

  const now = Date.now();
  const durationMs = Math.max(
    0,
    Math.min(86400000, Math.round(Number(recording.durationMs) || cleanFrames[cleanFrames.length - 1]?.t || 0)),
  );

  return {
    id,
    ownerId,
    name: recording.name.trim().slice(0, 80) || 'Spatial Assembly Replay',
    moduleId: sanitizeId(recording.moduleId).slice(0, 40),
    deviceMode: recording.deviceMode,
    durationMs,
    frameCount: cleanFrames.length,
    snapCount: Math.max(0, Math.min(500, Math.round(Number(recording.snapCount) || 0))),
    collisionCount: Math.max(0, Math.min(10000, Math.round(Number(recording.collisionCount) || 0))),
    avgAccuracyPct: Math.max(0, Math.min(100, Number((Number(recording.avgAccuracyPct) || 100).toFixed(1)))),
    frames: cleanFrames,
    events: cleanEvents,
    isShared: Boolean(recording.isShared),
    createdAtMs: recording.createdAtMs ?? now,
    updatedAtMs: now,
    syncedToCloud: false,
  };
}

export async function saveSpatialRecording(
  recording: Omit<SpatialRecording, 'id' | 'ownerId' | 'createdAtMs' | 'updatedAtMs' | 'syncedToCloud'> & {
    id?: string;
    createdAtMs?: number;
  },
): Promise<SpatialRecording> {
  const user = auth.currentUser;
  const ownerId = user?.uid || 'offline_operator';
  const localRecord = clampSpatialRecordingPayload(recording, ownerId);

  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) {
    offlineStore.saveLocalRecording(localRecord, true);
    return localRecord;
  }

  const path = `spatialRecordings/${localRecord.id}`;
  try {
    await setDoc(doc(db, 'spatialRecordings', localRecord.id), {
      ownerId: user.uid,
      name: localRecord.name,
      moduleId: localRecord.moduleId,
      deviceMode: localRecord.deviceMode,
      durationMs: localRecord.durationMs,
      frameCount: localRecord.frameCount,
      snapCount: localRecord.snapCount,
      collisionCount: localRecord.collisionCount,
      avgAccuracyPct: localRecord.avgAccuracyPct,
      frames: localRecord.frames,
      events: localRecord.events,
      isShared: localRecord.isShared,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    localRecord.syncedToCloud = true;
    offlineStore.saveLocalRecording(localRecord, false);
    return localRecord;
  } catch (error) {
    offlineStore.saveLocalRecording(localRecord, true);
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeSpatialRecordings(
  userId: string,
  onUpdate: (recordings: SpatialRecording[]) => void,
): Unsubscribe {
  const path = 'spatialRecordings';
  const q = query(
    collection(db, path),
    where('ownerId', '==', userId),
    orderBy('updatedAt', 'desc'),
    limit(15),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: SpatialRecording[] = snap.docs.map((d) => {
        const data = d.data();
        const createdTs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
        const updatedTs = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : createdTs;
        return {
          id: d.id,
          ownerId: data.ownerId,
          name: data.name,
          moduleId: data.moduleId,
          deviceMode: data.deviceMode || 'desktop',
          durationMs: Number(data.durationMs ?? 0),
          frameCount: Number(data.frameCount ?? (Array.isArray(data.frames) ? data.frames.length : 0)),
          snapCount: Number(data.snapCount ?? 0),
          collisionCount: Number(data.collisionCount ?? 0),
          avgAccuracyPct: Number(data.avgAccuracyPct ?? 100),
          frames: Array.isArray(data.frames) ? data.frames : [],
          events: Array.isArray(data.events) ? data.events : [],
          isShared: Boolean(data.isShared),
          createdAtMs: createdTs,
          updatedAtMs: updatedTs,
          syncedToCloud: true,
        };
      });
      onUpdate(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    },
  );
}

export async function deleteSpatialRecording(id: string): Promise<void> {
  offlineStore.deleteLocalRecording(id);
  const user = auth.currentUser;
  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) return;
  const path = `spatialRecordings/${id}`;
  try {
    await deleteDoc(doc(db, 'spatialRecordings', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function flushOfflineQueue(): Promise<{ synced: number }> {
  const user = auth.currentUser;
  if (offlineStore.isEffectivelyOffline() || !user || !user.emailVerified) {
    return { synced: 0 };
  }
  let synced = 0;

  const pendingAnalytics = offlineStore.getPendingAnalytics();
  const syncedAnalyticsIds = new Set<string>();
  for (const item of pendingAnalytics) {
    const path = `analyticsEvents/${item.id}`;
    try {
      await setDoc(doc(db, 'analyticsEvents', item.id), {
        userId: user.uid,
        moduleId: item.moduleId,
        actionType: item.actionType,
        accuracyPct: item.accuracyPct,
        durationMs: item.durationMs,
        collisions: item.collisions,
        deviceMode: item.deviceMode,
        offlineSynced: true,
        createdAt: serverTimestamp(),
      });
      syncedAnalyticsIds.add(item.id);
      synced += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
  offlineStore.clearPendingAnalytics(syncedAnalyticsIds);

  const pendingMappings = offlineStore.getPendingMappings();
  const syncedMappingIds = new Set<string>();
  for (const mapping of pendingMappings) {
    const path = `spatialMappings/${mapping.id}`;
    try {
      await setDoc(doc(db, 'spatialMappings', mapping.id), {
        ownerId: user.uid,
        name: mapping.name,
        moduleId: mapping.moduleId,
        roomBounds: mapping.roomBounds,
        partTransforms: mapping.partTransforms,
        rokidProfile: mapping.rokidProfile,
        isShared: mapping.isShared,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      syncedMappingIds.add(mapping.id);
      synced += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
  offlineStore.markMappingsSynced(syncedMappingIds);

  const pendingRecordings = offlineStore.getPendingRecordings();
  const syncedRecordingIds = new Set<string>();
  for (const rec of pendingRecordings) {
    const clamped = clampSpatialRecordingPayload(rec, user.uid);
    const path = `spatialRecordings/${clamped.id}`;
    try {
      await setDoc(doc(db, 'spatialRecordings', clamped.id), {
        ownerId: user.uid,
        name: clamped.name,
        moduleId: clamped.moduleId,
        deviceMode: clamped.deviceMode,
        durationMs: clamped.durationMs,
        frameCount: clamped.frameCount,
        snapCount: clamped.snapCount,
        collisionCount: clamped.collisionCount,
        avgAccuracyPct: clamped.avgAccuracyPct,
        frames: clamped.frames,
        events: clamped.events,
        isShared: clamped.isShared,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      syncedRecordingIds.add(rec.id);
      synced += 1;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
  offlineStore.markRecordingsSynced(syncedRecordingIds);

  return { synced };
}
