/**
 * Payload-First Security TDD Suite for AeroLab XR Firestore Rules.
 * Verifies the "Dirty Dozen" adversarial payloads against the Eight Pillars.
 */
export interface DirtyDozenCase {
  id: string;
  collectionPath: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; emailVerified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenCase[] = [
  {
    id: '01-unauthenticated-write',
    collectionPath: 'analyticsEvents/evt_1',
    operation: 'create',
    auth: null,
    payload: { userId: 'anon', moduleId: 'turbine', actionType: 'part_snapped' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '02-unverified-email',
    collectionPath: 'spatialMappings/map_1',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: false },
    payload: { ownerId: 'user_a', name: 'Lab A' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '03-shadow-ghost-field',
    collectionPath: 'users/user_a',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: {
      uid: 'user_a',
      displayName: 'Alice',
      preferredLang: 'en',
      deviceProfile: 'desktop',
      isAdmin: true,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '04-identity-spoofing',
    collectionPath: 'analyticsEvents/evt_spoof',
    operation: 'create',
    auth: { uid: 'attacker', emailVerified: true },
    payload: {
      userId: 'victim',
      moduleId: 'turbine',
      actionType: 'part_snapped',
      accuracyPct: 99,
      durationMs: 1200,
      collisions: 0,
      deviceMode: 'desktop',
      offlineSynced: false,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '05-owner-reassignment',
    collectionPath: 'spatialMappings/map_1',
    operation: 'update',
    auth: { uid: 'user_a', emailVerified: true },
    payload: { ownerId: 'user_b', name: 'Hijacked' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '06-client-timestamp-forgery',
    collectionPath: 'analyticsEvents/evt_time',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: { userId: 'user_a', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '07-id-poisoning',
    collectionPath: `spatialMappings/${'x'.repeat(160)}`,
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: { ownerId: 'user_a', name: 'Overflow' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '08-unbounded-array',
    collectionPath: 'spatialMappings/map_big',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: {
      ownerId: 'user_a',
      name: 'Oversized',
      partTransforms: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })),
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '09-cross-user-pii-read',
    collectionPath: 'users/victim/private/info',
    operation: 'get',
    auth: { uid: 'attacker', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '10-blanket-query-scrape',
    collectionPath: 'analyticsEvents',
    operation: 'list',
    auth: { uid: 'attacker', emailVerified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '11-terminal-state-bypass',
    collectionPath: 'collaborationSessions/sess_done',
    operation: 'update',
    auth: { uid: 'host_user', emailVerified: true },
    payload: { status: 'active' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '12-orphaned-subcollection-write',
    collectionPath: 'collaborationSessions/missing_parent/participants/user_a',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: { userId: 'user_a', displayName: 'Alice', deviceProfile: 'rokid_max' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '13-recording-unbounded-frames',
    collectionPath: 'spatialRecordings/rec_big',
    operation: 'create',
    auth: { uid: 'user_a', emailVerified: true },
    payload: {
      ownerId: 'user_a',
      name: 'Oversized Replay',
      moduleId: 'turbine',
      frames: Array.from({ length: 480 }, (_, i) => ({ t: i * 50, exploded: 0, parts: [] })),
      events: [],
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: '14-recording-immutable-frames-update',
    collectionPath: 'spatialRecordings/rec_1',
    operation: 'update',
    auth: { uid: 'user_a', emailVerified: true },
    payload: { name: 'Edited', frames: [] },
    expected: 'PERMISSION_DENIED',
  },
];
