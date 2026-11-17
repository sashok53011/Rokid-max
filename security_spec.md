# Security Specification — AeroLab XR

## 1. Data Invariants
1. **Owner-Only Profile & PII Isolation**: Public user profile (`users/{userId}`) contains only non-PII (`uid`, `displayName`, `preferredLang`, `deviceProfile`, timestamps). Private PII (`email`) is isolated in `users/{userId}/private/info` and strictly readable/writable only by the verified owner (`request.auth.uid == userId`).
2. **Telemetry Ownership & Immutability**: `analyticsEvents/{eventId}` documents must carry `userId == request.auth.uid`, valid numeric bounds (`0 <= accuracyPct <= 100`, `durationMs >= 0`, `collisions >= 0`), server-validated `createdAt == request.time`, and are immutable after creation.
3. **Spatial Mapping Integrity**: `spatialMappings/{mappingId}` requires `ownerId == request.auth.uid` on create, immutable `ownerId` and `createdAt` on update, bounded `partTransforms` list (`size() <= 24`), and `allow list` enforced strictly against `resource.data.ownerId == request.auth.uid || resource.data.isShared == true`.
4. **Master Gate & Terminal State Locking**: `collaborationSessions/{sessionId}` cannot be mutated once `status == 'completed'`. Subcollection `participants/{participantId}` validates parent session existence and active status via `get()`.
5. **Email Verification & ID Hardening**: All standard write operations require `request.auth.token.email_verified == true` and `isValidId()` (`^[a-zA-Z0-9_\-]+$`, `<= 128` chars).
6. **Spatial Recording Integrity**: `spatialRecordings/{recordingId}` requires `ownerId == request.auth.uid` on create, immutable `ownerId`/`createdAt`/`frames`/`events` on update (only `name`, `isShared`, `updatedAt` mutable), bounded `frames` (`1 <= size() <= 450`) and `events` (`size() <= 200`), and `allow list` enforced strictly against `resource.data.ownerId == request.auth.uid || resource.data.isShared == true`.

## 2. The "Dirty Dozen" Attack Payloads
1. **Unauthenticated Write**: Creating an `analyticsEvents` doc with `auth: null` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: Creating a `spatialMappings` doc with `email_verified: false` -> `PERMISSION_DENIED`.
3. **Shadow Ghost Field Injection**: Creating `users/{uid}` with an extra field `{ isAdmin: true }` -> `PERMISSION_DENIED`.
4. **Identity Spoofing on Create**: Creating `analyticsEvents` with `userId: "victim_uid"` while signed in as `"attacker_uid"` -> `PERMISSION_DENIED`.
5. **Owner Reassignment on Update**: Updating `spatialMappings/{id}` to change `ownerId` -> `PERMISSION_DENIED`.
6. **Client Timestamp Forgery**: Creating `analyticsEvents` with a backdated client timestamp (`createdAt != request.time`) -> `PERMISSION_DENIED`.
7. **ID Poisoning / Resource Exhaustion**: Writing to `spatialMappings/{200-char-invalid-id}` -> `PERMISSION_DENIED`.
8. **Unbounded Array / Value Poisoning**: Creating `spatialMappings` with 50 items in `partTransforms` (`> 24`), or `spatialRecordings` with 500 frames (`> 450`) -> `PERMISSION_DENIED`.
9. **Cross-User PII Read**: Reading `users/victim_uid/private/info` as `attacker_uid` -> `PERMISSION_DENIED`.
10. **Blanket Query Scraping**: Listing `analyticsEvents` without `where('userId', '==', uid)` -> `PERMISSION_DENIED`.
11. **Terminal State Bypass**: Updating a `collaborationSessions` document whose `status` is already `'completed'` -> `PERMISSION_DENIED`.
12. **Orphaned Subcollection Write**: Creating a `participants/{uid}` document under a nonexistent `collaborationSessions/missing` parent -> `PERMISSION_DENIED`.
13. **Recording ImmutabilityTampering**: Updating `spatialRecordings/{id}` to overwrite `frames` or `ownerId` -> `PERMISSION_DENIED`.
