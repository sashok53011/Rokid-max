import * as THREE from 'three';
import type {
  DeviceProfile,
  SpatialFramePartPose,
  SpatialRecording,
  SpatialRecordingEvent,
  SpatialRecordingEventType,
  SpatialRecordingFrame,
} from '../services/offlineSync.ts';

export type RecorderMode = 'idle' | 'recording' | 'playing' | 'paused';

export interface RecorderStateSnapshot {
  mode: RecorderMode;
  activeRecordingId: string | null;
  activeRecordingName: string;
  activeModuleId: string;
  elapsedRecordingMs: number;
  recordedFrameCount: number;
  recordedEventCount: number;
  playheadMs: number;
  durationMs: number;
  speed: number;
  events: SpatialRecordingEvent[];
  activePartId: string | null;
  lastEventLabel: string;
}

export interface EvaluatedPlaybackPose {
  exploded: number;
  parts: Map<string, SpatialFramePartPose>;
  activePartId: string | null;
}

export interface PlaybackAdvanceResult {
  evaluated: EvaluatedPlaybackPose;
  crossedEvents: SpatialRecordingEvent[];
  reachedEnd: boolean;
}

export type RecordedRecordingPayload = Omit<
  SpatialRecording,
  'id' | 'ownerId' | 'createdAtMs' | 'updatedAtMs' | 'syncedToCloud'
>;

const MAX_FRAMES = 450;
const MAX_EVENTS = 200;
const SAMPLE_INTERVAL_MS = 50; // ~20 Hz target capture rate
const HEARTBEAT_INTERVAL_MS = 1200;

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();

export class SpatialRecorder {
  private mode: RecorderMode = 'idle';
  private startedAtMs = 0;
  private lastSampleAtMs = 0;
  private lastSnapshotEmitMs = 0;
  private captureIntervalMs = SAMPLE_INTERVAL_MS;
  private recordedModuleId = 'turbine';
  private recordedDeviceMode: DeviceProfile = 'desktop';
  private frames: SpatialRecordingFrame[] = [];
  private events: SpatialRecordingEvent[] = [];
  private snapCount = 0;
  private collisionCount = 0;
  private lastExplodedEventT = -1000;

  // Playback state
  private activeRecording: SpatialRecording | null = null;
  private playheadMs = 0;
  private prevCheckedEventMs = -1;
  private speed = 1;
  private lastEventLabel = '';

  // Reusable pose cache for zero-GC playback evaluation
  private posePool = new Map<string, SpatialFramePartPose>();
  private evaluatedCache: EvaluatedPlaybackPose = {
    exploded: 0,
    parts: this.posePool,
    activePartId: null,
  };

  private listeners = new Set<(snap: RecorderStateSnapshot) => void>();

  onStateChange(cb: (snap: RecorderStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => this.listeners.delete(cb);
  }

  private emitState(force = false) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this.lastSnapshotEmitMs < 110) return;
    this.lastSnapshotEmitMs = now;
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }

  getMode(): RecorderMode {
    return this.mode;
  }

  isRecording(): boolean {
    return this.mode === 'recording';
  }

  isPlayingOrPaused(): boolean {
    return this.mode === 'playing' || this.mode === 'paused';
  }

  getActiveRecording(): SpatialRecording | null {
    return this.activeRecording;
  }

  getSnapshot(): RecorderStateSnapshot {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedRecordingMs =
      this.mode === 'recording' ? Math.max(0, Math.round(now - this.startedAtMs)) : 0;
    const currentEvents =
      this.mode === 'recording'
        ? this.events
        : this.activeRecording
          ? this.activeRecording.events
          : [];
    const activePartId = this.findActivePartAt(
      this.playheadMs,
      currentEvents,
    );

    return {
      mode: this.mode,
      activeRecordingId: this.activeRecording?.id ?? null,
      activeRecordingName: this.activeRecording?.name ?? '',
      activeModuleId:
        this.mode === 'recording'
          ? this.recordedModuleId
          : (this.activeRecording?.moduleId ?? ''),
      elapsedRecordingMs,
      recordedFrameCount: this.frames.length,
      recordedEventCount: this.events.length,
      playheadMs: Math.round(this.playheadMs),
      durationMs: this.activeRecording?.durationMs ?? 0,
      speed: this.speed,
      events: currentEvents.slice(),
      activePartId,
      lastEventLabel: this.lastEventLabel,
    };
  }

  startRecording(
    moduleId: string,
    deviceMode: DeviceProfile,
    partPoses: SpatialFramePartPose[],
    explodedAmount: number,
    nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ) {
    this.activeRecording = null;
    this.playheadMs = 0;
    this.prevCheckedEventMs = -1;
    this.lastEventLabel = '';
    this.mode = 'recording';
    this.startedAtMs = nowMs;
    this.lastSampleAtMs = nowMs;
    this.captureIntervalMs = SAMPLE_INTERVAL_MS;
    this.recordedModuleId = moduleId;
    this.recordedDeviceMode = deviceMode;
    this.frames = [this.cloneFrame(0, explodedAmount, partPoses)];
    this.events = [];
    this.snapCount = 0;
    this.collisionCount = 0;
    this.lastExplodedEventT = -1000;
    this.emitState(true);
  }

  sampleTick(
    explodedAmount: number,
    partPoses: SpatialFramePartPose[],
    nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ) {
    if (this.mode !== 'recording') return;
    if (nowMs - this.lastSampleAtMs < this.captureIntervalMs) return;

    const relT = Math.max(0, Math.round(nowMs - this.startedAtMs));
    const prev = this.frames[this.frames.length - 1];
    const sincePrev = prev ? relT - prev.t : HEARTBEAT_INTERVAL_MS;

    if (!prev || sincePrev >= HEARTBEAT_INTERVAL_MS || this.hasPoseDelta(prev, explodedAmount, partPoses)) {
      this.pushFrame(relT, explodedAmount, partPoses);
      this.lastSampleAtMs = nowMs;
      this.emitState(false);
    }
  }

  recordEvent(
    type: SpatialRecordingEventType,
    partId: string,
    partLabel: string,
    accuracyPct: number,
    pos: { x: number; y: number; z: number },
    explodedAmount: number,
    partPoses: SpatialFramePartPose[],
    nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ) {
    if (this.mode !== 'recording') return;
    const relT = Math.max(0, Math.round(nowMs - this.startedAtMs));

    if (type === 'exploded' && relT - this.lastExplodedEventT < 350) {
      return;
    }
    if (type === 'exploded') this.lastExplodedEventT = relT;

    if (type === 'snap') this.snapCount += 1;
    if (type === 'collision') this.collisionCount += 1;

    this.pushFrame(relT, explodedAmount, partPoses);
    this.lastSampleAtMs = nowMs;

    if (this.events.length < MAX_EVENTS) {
      this.events.push({
        t: relT,
        type,
        partId: partId.slice(0, 64),
        partLabel: partLabel.slice(0, 80),
        accuracyPct: Math.max(0, Math.min(100, Number(accuracyPct.toFixed(1)))),
        x: Number(pos.x.toFixed(4)),
        y: Number(pos.y.toFixed(4)),
        z: Number(pos.z.toFixed(4)),
      });
    } else if (type === 'snap' || type === 'complete') {
      // Preserve critical milestone events if collision chatter filled buffer
      const dropIdx = this.events.findIndex((e) => e.type === 'exploded' || e.type === 'collision');
      if (dropIdx >= 0) {
        this.events.splice(dropIdx, 1);
        this.events.push({
          t: relT,
          type,
          partId: partId.slice(0, 64),
          partLabel: partLabel.slice(0, 80),
          accuracyPct: Math.max(0, Math.min(100, Number(accuracyPct.toFixed(1)))),
          x: Number(pos.x.toFixed(4)),
          y: Number(pos.y.toFixed(4)),
          z: Number(pos.z.toFixed(4)),
        });
      }
    }

    this.lastEventLabel = `${type.toUpperCase()}: ${partLabel || partId}`;
    this.emitState(true);
  }

  stopRecording(
    name: string,
    isShared: boolean,
    partPoses: SpatialFramePartPose[],
    explodedAmount: number,
    avgAccuracyPct: number,
    nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): RecordedRecordingPayload {
    const durationMs = Math.max(50, Math.round(nowMs - this.startedAtMs));
    const last = this.frames[this.frames.length - 1];
    if (!last || last.t < durationMs) {
      this.pushFrame(durationMs, explodedAmount, partPoses);
    }

    const payload: RecordedRecordingPayload = {
      name: name.trim().slice(0, 80) || `${this.recordedModuleId} Replay`,
      moduleId: this.recordedModuleId,
      deviceMode: this.recordedDeviceMode,
      durationMs,
      frameCount: this.frames.length,
      snapCount: this.snapCount,
      collisionCount: this.collisionCount,
      avgAccuracyPct: Number(avgAccuracyPct.toFixed(1)),
      frames: this.frames,
      events: this.events,
      isShared,
    };

    this.mode = 'idle';
    this.frames = [];
    this.events = [];
    this.lastEventLabel = '';
    this.emitState(true);
    return payload;
  }

  cancelRecording() {
    if (this.mode !== 'recording') return;
    this.mode = 'idle';
    this.frames = [];
    this.events = [];
    this.lastEventLabel = '';
    this.emitState(true);
  }

  loadForPlayback(recording: SpatialRecording, autoplay = true): EvaluatedPlaybackPose | null {
    if (!recording.frames || recording.frames.length === 0) return null;
    this.activeRecording = recording;
    this.playheadMs = 0;
    this.prevCheckedEventMs = -1;
    this.lastEventLabel = '';
    this.mode = autoplay ? 'playing' : 'paused';
    const evaluated = this.evaluateAt(0);
    this.emitState(true);
    return evaluated;
  }

  play(): boolean {
    if (!this.activeRecording) return false;
    if (this.playheadMs >= this.activeRecording.durationMs) {
      this.playheadMs = 0;
      this.prevCheckedEventMs = -1;
    }
    this.mode = 'playing';
    this.emitState(true);
    return true;
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.emitState(true);
  }

  togglePlayPause() {
    if (this.mode === 'playing') this.pause();
    else if (this.mode === 'paused') this.play();
  }

  setSpeed(nextSpeed: number) {
    this.speed = Math.max(0.25, Math.min(4, nextSpeed));
    this.emitState(true);
  }

  seek(ms: number): EvaluatedPlaybackPose | null {
    if (!this.activeRecording) return null;
    this.playheadMs = Math.max(0, Math.min(this.activeRecording.durationMs, ms));
    this.prevCheckedEventMs = this.playheadMs;
    const ev = this.findNearestEventAtOrBefore(this.playheadMs, this.activeRecording.events);
    this.lastEventLabel = ev ? `${ev.type.toUpperCase()}: ${ev.partLabel || ev.partId}` : '';
    const evaluated = this.evaluateAt(this.playheadMs);
    this.emitState(true);
    return evaluated;
  }

  stepToEvent(direction: 1 | -1): {
    evaluated: EvaluatedPlaybackPose;
    event: SpatialRecordingEvent;
  } | null {
    if (!this.activeRecording || this.activeRecording.events.length === 0) return null;
    const events = this.activeRecording.events;
    let target: SpatialRecordingEvent | undefined;
    if (direction > 0) {
      target = events.find((ev) => ev.t > this.playheadMs + 35) ?? events[events.length - 1];
    } else {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].t < this.playheadMs - 35) {
          target = events[i];
          break;
        }
      }
      if (!target) target = events[0];
    }
    if (!target) return null;
    this.playheadMs = Math.max(0, Math.min(this.activeRecording.durationMs, target.t));
    this.prevCheckedEventMs = this.playheadMs;
    this.lastEventLabel = `${target.type.toUpperCase()}: ${target.partLabel || target.partId}`;
    const evaluated = this.evaluateAt(this.playheadMs);
    this.emitState(true);
    return { evaluated, event: target };
  }

  exitPlayback() {
    if (!this.isPlayingOrPaused() && !this.activeRecording) return;
    this.activeRecording = null;
    this.playheadMs = 0;
    this.prevCheckedEventMs = -1;
    this.lastEventLabel = '';
    this.mode = 'idle';
    this.emitState(true);
  }

  advancePlayback(dtSec: number): PlaybackAdvanceResult | null {
    if (this.mode !== 'playing' || !this.activeRecording) return null;
    const duration = this.activeRecording.durationMs;
    const prevMs = this.prevCheckedEventMs;
    this.playheadMs = Math.min(duration, this.playheadMs + dtSec * 1000 * this.speed);
    this.prevCheckedEventMs = this.playheadMs;

    const crossedEvents: SpatialRecordingEvent[] = [];
    for (const ev of this.activeRecording.events) {
      if (ev.t > prevMs && ev.t <= this.playheadMs) {
        crossedEvents.push(ev);
        this.lastEventLabel = `${ev.type.toUpperCase()}: ${ev.partLabel || ev.partId}`;
      }
    }

    const evaluated = this.evaluateAt(this.playheadMs);
    let reachedEnd = false;
    if (this.playheadMs >= duration) {
      this.mode = 'paused';
      reachedEnd = true;
      this.emitState(true);
    } else {
      this.emitState(false);
    }

    return { evaluated, crossedEvents, reachedEnd };
  }

  /**
   * Returns 3D polyline points for the trajectory of `partId` up to the current playhead.
   */
  getTrajectoryPoints(partId: string, upToMs = this.playheadMs): THREE.Vector3[] {
    if (!this.activeRecording) return [];
    const pts: THREE.Vector3[] = [];
    for (const frame of this.activeRecording.frames) {
      if (frame.t > upToMs) break;
      const p = frame.parts.find((item) => item.id === partId);
      if (p) {
        const last = pts[pts.length - 1];
        if (
          !last ||
          Math.abs(last.x - p.x) + Math.abs(last.y - p.y) + Math.abs(last.z - p.z) > 0.004
        ) {
          pts.push(new THREE.Vector3(p.x, p.y, p.z));
        }
      }
    }
    const evaluated = this.evaluateAt(upToMs);
    const live = evaluated.parts.get(partId);
    if (live) {
      pts.push(new THREE.Vector3(live.x, live.y, live.z));
    }
    return pts;
  }

  evaluateAt(ms: number): EvaluatedPlaybackPose {
    const rec = this.activeRecording;
    if (!rec || rec.frames.length === 0) {
      this.evaluatedCache.exploded = 0;
      this.evaluatedCache.activePartId = null;
      return this.evaluatedCache;
    }

    const frames = rec.frames;
    if (frames.length === 1 || ms <= frames[0].t) {
      return this.populateSingleFrame(frames[0], ms, rec.events);
    }
    const lastIdx = frames.length - 1;
    if (ms >= frames[lastIdx].t) {
      return this.populateSingleFrame(frames[lastIdx], ms, rec.events);
    }

    // Binary search bracketing frames [lo, hi]
    let lo = 0;
    let hi = lastIdx;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= ms) lo = mid;
      else hi = mid;
    }

    const fA = frames[lo];
    const fB = frames[hi];
    const span = Math.max(1, fB.t - fA.t);
    const alpha = Math.max(0, Math.min(1, (ms - fA.t) / span));

    this.evaluatedCache.exploded = fA.exploded + (fB.exploded - fA.exploded) * alpha;

    for (const pa of fA.parts) {
      const pb = fB.parts.find((item) => item.id === pa.id) || pa;
      let target = this.posePool.get(pa.id);
      if (!target) {
        target = { ...pa };
        this.posePool.set(pa.id, target);
      }

      target.x = pa.x + (pb.x - pa.x) * alpha;
      target.y = pa.y + (pb.y - pa.y) * alpha;
      target.z = pa.z + (pb.z - pa.z) * alpha;

      _qa.set(pa.qx, pa.qy, pa.qz, pa.qw).normalize();
      _qb.set(pb.qx, pb.qy, pb.qz, pb.qw).normalize();
      _qOut.copy(_qa).slerp(_qb, alpha);

      target.qx = _qOut.x;
      target.qy = _qOut.y;
      target.qz = _qOut.z;
      target.qw = _qOut.w;
      target.snapped = alpha >= 0.98 ? pb.snapped : pa.snapped;
    }

    this.evaluatedCache.activePartId = this.findActivePartAt(ms, rec.events);
    return this.evaluatedCache;
  }

  private populateSingleFrame(
    frame: SpatialRecordingFrame,
    ms: number,
    events: SpatialRecordingEvent[],
  ): EvaluatedPlaybackPose {
    this.evaluatedCache.exploded = frame.exploded;
    for (const p of frame.parts) {
      let target = this.posePool.get(p.id);
      if (!target) {
        target = { ...p };
        this.posePool.set(p.id, target);
      } else {
        target.x = p.x;
        target.y = p.y;
        target.z = p.z;
        target.qx = p.qx;
        target.qy = p.qy;
        target.qz = p.qz;
        target.qw = p.qw;
        target.snapped = p.snapped;
      }
    }
    this.evaluatedCache.activePartId = this.findActivePartAt(ms, events);
    return this.evaluatedCache;
  }

  private findActivePartAt(ms: number, events: SpatialRecordingEvent[]): string | null {
    const ev = this.findNearestEventAtOrBefore(ms, events);
    if (ev && ev.partId) return ev.partId;
    const firstWithPart = events.find((item) => Boolean(item.partId));
    return firstWithPart?.partId ?? null;
  }

  private findNearestEventAtOrBefore(
    ms: number,
    events: SpatialRecordingEvent[],
  ): SpatialRecordingEvent | null {
    let best: SpatialRecordingEvent | null = null;
    for (const ev of events) {
      if (ev.t <= ms + 1) best = ev;
      else break;
    }
    return best;
  }

  private pushFrame(t: number, explodedAmount: number, partPoses: SpatialFramePartPose[]) {
    if (this.frames.length >= MAX_FRAMES) {
      // Compact every second intermediate frame to extend continuous capture window
      const compacted: SpatialRecordingFrame[] = [this.frames[0]];
      for (let i = 1; i < this.frames.length - 1; i += 2) {
        compacted.push(this.frames[i]);
      }
      compacted.push(this.frames[this.frames.length - 1]);
      this.frames = compacted;
      this.captureIntervalMs = Math.min(400, this.captureIntervalMs * 1.45);
    }
    const last = this.frames[this.frames.length - 1];
    const safeT = last ? Math.max(last.t, t) : t;
    this.frames.push(this.cloneFrame(safeT, explodedAmount, partPoses));
  }

  private cloneFrame(
    t: number,
    explodedAmount: number,
    partPoses: SpatialFramePartPose[],
  ): SpatialRecordingFrame {
    return {
      t,
      exploded: Number(explodedAmount.toFixed(3)),
      parts: partPoses.slice(0, 24).map((p) => ({
        id: p.id,
        x: Number(p.x.toFixed(4)),
        y: Number(p.y.toFixed(4)),
        z: Number(p.z.toFixed(4)),
        qx: Number(p.qx.toFixed(4)),
        qy: Number(p.qy.toFixed(4)),
        qz: Number(p.qz.toFixed(4)),
        qw: Number(p.qw.toFixed(4)),
        snapped: p.snapped,
      })),
    };
  }

  private hasPoseDelta(
    prev: SpatialRecordingFrame,
    explodedAmount: number,
    partPoses: SpatialFramePartPose[],
  ): boolean {
    if (Math.abs(prev.exploded - explodedAmount) > 0.01) return true;
    for (const cur of partPoses) {
      const old = prev.parts.find((p) => p.id === cur.id);
      if (!old) return true;
      if (old.snapped !== cur.snapped) return true;
      const dist =
        Math.abs(old.x - cur.x) + Math.abs(old.y - cur.y) + Math.abs(old.z - cur.z);
      if (dist > 0.0025) return true;
      const dot = Math.abs(
        old.qx * cur.qx + old.qy * cur.qy + old.qz * cur.qz + old.qw * cur.qw,
      );
      if (dot < 0.9992) return true;
    }
    return false;
  }
}
