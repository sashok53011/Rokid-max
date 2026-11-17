import * as THREE from 'three';

type SoundBufferKind = 'snapHigh' | 'snapMid' | 'collision' | 'complete';

const POOL_SIZE = 8;

/**
 * Web Audio API + Three.js PositionalAudio spatial sound engine for
 * tactile 3D part snaps, tabletop collisions, assembly completion chords,
 * and shared AudioListener synchronization across WebXR and desktop/mobile views.
 */
class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  private listener: THREE.AudioListener | null = null;
  private ownsListener = false;
  private emitterGroup: THREE.Group | null = null;
  private emitterPool: THREE.PositionalAudio[] = [];
  private poolCursor = 0;
  private buffers: Partial<Record<SoundBufferKind, AudioBuffer>> = {};
  private muted = false;
  private lastCollisionMs = 0;

  /**
   * Attaches or adopts a THREE.AudioListener on the active camera and creates a
   * pooled set of THREE.PositionalAudio emitters inside the scene graph.
   */
  attachSpatialListener(
    sceneRoot: THREE.Object3D,
    camera: THREE.Camera | null | undefined,
    existingListener?: THREE.AudioListener | null,
  ) {
    this.detachSpatialListener();

    let listener = existingListener ?? null;
    if (!listener) {
      listener = new THREE.AudioListener();
      this.ownsListener = true;
      if (camera && listener.parent !== camera) {
        camera.add(listener);
      }
    } else {
      this.ownsListener = false;
      if (camera && !listener.parent) {
        camera.add(listener);
      }
    }

    this.listener = listener;
    this.ctx = listener.context;

    const group = new THREE.Group();
    group.name = 'SpatialAudioEmitters';
    sceneRoot.add(group);
    this.emitterGroup = group;

    for (let i = 0; i < POOL_SIZE; i++) {
      const posAudio = new THREE.PositionalAudio(listener);
      posAudio.name = `SpatialSfxEmitter_${i}`;
      posAudio.panner.panningModel = 'HRTF';
      posAudio.setDistanceModel('inverse');
      posAudio.setRefDistance(0.9);
      posAudio.setRolloffFactor(1.45);
      posAudio.setMaxDistance(14);
      group.add(posAudio);
      this.emitterPool.push(posAudio);
    }

    this.ensureBuffers(this.ctx);
  }

  detachSpatialListener() {
    for (const emitter of this.emitterPool) {
      if (emitter.isPlaying) {
        try {
          emitter.stop();
        } catch {
          // Ignore if already stopped
        }
      }
      try {
        emitter.disconnect();
      } catch {
        // Ignore
      }
      emitter.removeFromParent();
    }
    this.emitterPool = [];
    this.poolCursor = 0;

    if (this.emitterGroup) {
      this.emitterGroup.removeFromParent();
      this.emitterGroup = null;
    }

    if (this.ownsListener && this.listener) {
      this.listener.removeFromParent();
    }
    this.ownsListener = false;
    this.listener = null;
  }

  getAudioListener(): THREE.AudioListener | null {
    return this.listener;
  }

  /**
   * Returns the single shared AudioContext used by THREE.AudioListener and
   * Three.js PositionalAudio so WebRTC MediaStreams and SFX share the same graph.
   */
  getSharedAudioContext(): AudioContext | null {
    if (this.listener?.context) {
      this.ctx = this.listener.context;
      return this.ctx;
    }
    if (!this.ctx && typeof window !== 'undefined') {
      try {
        this.ctx = THREE.AudioContext.getContext() as unknown as AudioContext;
      } catch {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
    }
    return this.ctx;
  }

  resume() {
    const ctx = this.getSharedAudioContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  /**
   * Keeps the THREE.AudioListener world matrix aligned with the active camera
   * each frame (important when XR Blocks updates camera outside normal traversal).
   */
  syncListener(camera: THREE.Camera | null | undefined) {
    if (!this.listener || !camera) return;
    camera.updateMatrixWorld();
    this.listener.updateMatrixWorld(true);
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    const ctx = this.getSharedAudioContext();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    return ctx;
  }

  private ensureBuffers(ctx: AudioContext) {
    if (!this.buffers.snapHigh) {
      this.buffers.snapHigh = this.buildSnapBuffer(ctx, 587.33);
    }
    if (!this.buffers.snapMid) {
      this.buffers.snapMid = this.buildSnapBuffer(ctx, 440);
    }
    if (!this.buffers.collision) {
      this.buffers.collision = this.buildCollisionBuffer(ctx);
    }
    if (!this.buffers.complete) {
      this.buffers.complete = this.buildCompleteBuffer(ctx);
    }
  }

  private buildSnapBuffer(ctx: AudioContext, baseFreq: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = 0.27;
    const length = Math.ceil(sr * duration);
    const buffer = ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);

    let clickPhase = 0;
    let chimePhase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      let sample = 0;

      // Crisp mechanical magnetic latch click (0 - 52 ms)
      if (t < 0.052) {
        const clickRatio = t / 0.052;
        const clickFreq = 1200 * Math.pow(220 / 1200, clickRatio);
        clickPhase += (2 * Math.PI * clickFreq) / sr;
        // Triangle-like harmonic click
        const tri = (2 / Math.PI) * Math.asin(Math.sin(clickPhase));
        const clickEnv = 0.34 * Math.pow(0.005, clickRatio);
        sample += tri * clickEnv;
      }

      // Harmonic confirmation chime (30 ms - 260 ms)
      if (t >= 0.025) {
        const ct = t - 0.025;
        const chimeRatio = Math.min(1, ct / 0.16);
        const chimeFreq = baseFreq * Math.pow(1.5, chimeRatio);
        chimePhase += (2 * Math.PI * chimeFreq) / sr;
        const attack = Math.min(1, ct / 0.015);
        const decay = Math.pow(0.004, Math.min(1, ct / 0.22));
        sample += Math.sin(chimePhase) * 0.28 * attack * decay;
      }

      data[i] = Math.max(-0.95, Math.min(0.95, sample));
    }
    return buffer;
  }

  private buildCollisionBuffer(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = 0.085;
    const length = Math.ceil(sr * duration);
    const buffer = ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);

    let phase = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const ratio = t / duration;
      const freq = 260 * Math.pow(72 / 260, ratio);
      phase += (2 * Math.PI * freq) / sr;
      const attack = Math.min(1, t / 0.004);
      const decay = Math.pow(0.002, ratio);
      const impactTransient = t < 0.008 ? Math.sin(t * 2800) * 0.16 * (1 - t / 0.008) : 0;
      data[i] = Math.max(-0.95, Math.min(0.95, Math.sin(phase) * 0.36 * attack * decay + impactTransient));
    }
    return buffer;
  }

  private buildCompleteBuffer(ctx: AudioContext): AudioBuffer {
    const sr = ctx.sampleRate;
    const duration = 0.72;
    const length = Math.ceil(sr * duration);
    const buffer = ctx.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const startSec = idx * 0.085;
      const noteDur = 0.36;
      const startSample = Math.floor(startSec * sr);
      const endSample = Math.min(length, Math.floor((startSec + noteDur) * sr));
      for (let i = startSample; i < endSample; i++) {
        const nt = (i - startSample) / sr;
        const attack = Math.min(1, nt / 0.02);
        const decay = Math.pow(0.003, nt / noteDur);
        const wave = Math.sin(2 * Math.PI * freq * nt) * 0.22 * attack * decay;
        data[i] = Math.max(-0.95, Math.min(0.95, data[i] + wave));
      }
    });
    return buffer;
  }

  private nextPoolEmitter(): THREE.PositionalAudio | null {
    if (this.emitterPool.length === 0) return null;
    const emitter = this.emitterPool[this.poolCursor % this.emitterPool.length];
    this.poolCursor = (this.poolCursor + 1) % this.emitterPool.length;
    if (emitter.isPlaying) {
      try {
        emitter.stop();
      } catch {
        // Ignore if already stopping
      }
    }
    return emitter;
  }

  private playPositionalBuffer(
    kind: SoundBufferKind,
    worldPos: THREE.Vector3,
    opts: {
      refDistance: number;
      rolloffFactor: number;
      maxDistance: number;
      volume: number;
      playbackRate?: number;
      skipIfSuspended?: boolean;
    },
  ): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.listener || this.emitterPool.length === 0) return false;
    if (opts.skipIfSuspended && ctx.state === 'suspended') return false;

    this.ensureBuffers(ctx);
    const buffer = this.buffers[kind];
    if (!buffer) return false;

    const emitter = this.nextPoolEmitter();
    if (!emitter) return false;

    emitter.position.copy(worldPos);
    emitter.setRefDistance(opts.refDistance);
    emitter.setRolloffFactor(opts.rolloffFactor);
    emitter.setMaxDistance(opts.maxDistance);
    emitter.setVolume(opts.volume);
    emitter.setBuffer(buffer);
    emitter.setPlaybackRate(opts.playbackRate ?? 1.0);
    emitter.updateMatrixWorld(true);
    emitter.play();
    return true;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      for (const emitter of this.emitterPool) {
        if (emitter.isPlaying) {
          try {
            emitter.stop();
          } catch {
            // Ignore
          }
        }
      }
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Spatialized assembly snap cue anchored at the snapped part's 3D world position.
   */
  playSnapAt(worldPos: THREE.Vector3, accuracyPct = 100) {
    if (this.muted) return;
    const kind: SoundBufferKind = accuracyPct >= 90 ? 'snapHigh' : 'snapMid';
    const played = this.playPositionalBuffer(kind, worldPos, {
      refDistance: 0.9,
      rolloffFactor: 1.5,
      maxDistance: 12,
      volume: 0.85,
      playbackRate: accuracyPct >= 90 ? 1.0 : 0.96,
    });
    if (!played) {
      this.playSnap(accuracyPct);
    }
  }

  /**
   * Spatialized physics collision thud anchored at the colliding part's 3D position.
   */
  playCollisionAt(worldPos: THREE.Vector3, intensity = 0.5) {
    if (this.muted) return;
    const nowMs = performance.now();
    if (nowMs - this.lastCollisionMs < 90) return;
    this.lastCollisionMs = nowMs;

    const clamped = Math.max(0.1, Math.min(1, intensity));
    const played = this.playPositionalBuffer('collision', worldPos, {
      refDistance: 0.7,
      rolloffFactor: 1.8,
      maxDistance: 10,
      volume: 0.24 + clamped * 0.65,
      playbackRate: 0.88 + clamped * 0.28,
      skipIfSuspended: true,
    });
    if (!played && this.listener === null) {
      this.playCollisionDirect(clamped);
    }
  }

  /**
   * Spatialized completion arpeggio anchored at the workbench center.
   */
  playModuleCompleteAt(worldPos: THREE.Vector3) {
    if (this.muted) return;
    const played = this.playPositionalBuffer('complete', worldPos, {
      refDistance: 1.15,
      rolloffFactor: 1.15,
      maxDistance: 15,
      volume: 0.9,
    });
    if (!played) {
      this.playModuleComplete();
    }
  }

  playSnap(accuracyPct = 100) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const baseFreq = accuracyPct >= 90 ? 587.33 : 440;
    const dest = this.listener?.getInput() ?? ctx.destination;

    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(1200, now);
    clickOsc.frequency.exponentialRampToValueAtTime(220, now + 0.045);
    clickGain.gain.setValueAtTime(0.16, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    clickOsc.connect(clickGain).connect(dest);
    clickOsc.start(now);
    clickOsc.stop(now + 0.055);

    const chimeOsc = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chimeOsc.type = 'sine';
    chimeOsc.frequency.setValueAtTime(baseFreq, now + 0.03);
    chimeOsc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.19);
    chimeGain.gain.setValueAtTime(0.001, now);
    chimeGain.gain.linearRampToValueAtTime(0.11, now + 0.04);
    chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    chimeOsc.connect(chimeGain).connect(dest);
    chimeOsc.start(now);
    chimeOsc.stop(now + 0.26);
  }

  playModuleComplete() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const now = ctx.currentTime;
    const dest = this.listener?.getInput() ?? ctx.destination;
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.085;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.1, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(dest);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  playCollision(intensity = 0.5) {
    const nowMs = performance.now();
    if (nowMs - this.lastCollisionMs < 90) return;
    this.lastCollisionMs = nowMs;
    const clamped = Math.max(0.1, Math.min(1, intensity));
    this.playCollisionDirect(clamped);
  }

  private playCollisionDirect(clamped: number) {
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'suspended') return;
    const now = ctx.currentTime;
    const dest = this.listener?.getInput() ?? ctx.destination;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190 + clamped * 140, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.06);
    gain.gain.setValueAtTime(0.06 * clamped, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    osc.connect(gain).connect(dest);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  playQrBeep() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dest = this.listener?.getInput() ?? ctx.destination;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1480, now);
    osc.frequency.setValueAtTime(1975, now + 0.06);
    gain.gain.setValueAtTime(0.05, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(dest);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playCommandAck() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const dest = this.listener?.getInput() ?? ctx.destination;
    const freqs = [660, 990];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.055;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      osc.connect(gain).connect(dest);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  }

  getSpatialDiagnostics(): { listenerReady: boolean; poolSize: number; activeCount: number } {
    let activeCount = 0;
    for (const emitter of this.emitterPool) {
      if (emitter.isPlaying) activeCount++;
    }
    return {
      listenerReady: this.listener !== null,
      poolSize: this.emitterPool.length,
      activeCount,
    };
  }
}

export const audioEngine = new ProceduralAudioEngine();
