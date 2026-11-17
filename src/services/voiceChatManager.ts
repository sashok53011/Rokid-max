import * as THREE from 'three';
import { audioEngine } from '../audio/ProceduralAudio.ts';
import { multiplayerClient, type PeerInfo } from './multiplayerClient.ts';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface VoiceStateSnapshot {
  voiceEnabled: boolean;
  muted: boolean;
  deafened: boolean;
  connectedPeerIds: string[];
  speakingPeerIds: string[];
  spatialPeerCount: number;
  localSpeaking: boolean;
  localLevel: number;
  errorMessage: string;
}

interface RemotePeerSession {
  peerId: string;
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isPolite: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  remoteStream: MediaStream | null;
  audioEl: HTMLAudioElement | null;
  posAudio: THREE.PositionalAudio | null;
  analyser: AnalyserNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  freqBuffer: Uint8Array<ArrayBuffer> | null;
}

class VoiceChatManager {
  private voiceEnabled = false;
  private muted = false;
  private deafened = false;
  private errorMessage = '';
  private localStream: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localFreqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private localSpeaking = false;
  private localLevel = 0;

  private sessions = new Map<string, RemotePeerSession>();
  private peerAnchors = new Map<string, THREE.Object3D>();
  private knownPeers = new Map<string, PeerInfo>();
  private speakingPeers = new Set<string>();
  private stateListeners = new Set<(snap: VoiceStateSnapshot) => void>();
  private levelListeners = new Set<(snap: VoiceStateSnapshot) => void>();
  private meterTimer: number | null = null;
  private audioContainer: HTMLElement | null = null;

  constructor() {
    multiplayerClient.onEvent((ev) => {
      if (ev.type === 'connected') {
        this.syncPeerList(ev.room.participants);
        if (this.voiceEnabled) {
          multiplayerClient.sendVoiceState(true, this.muted);
          this.ensureConnectionsForActivePeers();
        }
      } else if (ev.type === 'peers' || ev.type === 'voice:state') {
        this.syncPeerList(ev.participants);
        this.ensureConnectionsForActivePeers();
      } else if (ev.type === 'webrtc:signal') {
        void this.handleSignal(ev.fromId, ev.signalType, ev.payload);
      } else if (ev.type === 'disconnected') {
        this.closeAllPeerConnections();
        this.knownPeers.clear();
        this.speakingPeers.clear();
        this.emitState();
      }
    });
  }

  onStateChange(cb: (snap: VoiceStateSnapshot) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.getSnapshot());
    return () => this.stateListeners.delete(cb);
  }

  onLevelUpdate(cb: (snap: VoiceStateSnapshot) => void): () => void {
    this.levelListeners.add(cb);
    return () => this.levelListeners.delete(cb);
  }

  getSnapshot(): VoiceStateSnapshot {
    const connectedPeerIds: string[] = [];
    let spatialPeerCount = 0;
    for (const [id, sess] of this.sessions.entries()) {
      if (sess.posAudio) {
        spatialPeerCount += 1;
      }
      if (
        sess.pc.connectionState === 'connected' ||
        sess.pc.iceConnectionState === 'connected' ||
        sess.pc.iceConnectionState === 'completed' ||
        sess.remoteStream !== null
      ) {
        connectedPeerIds.push(id);
      }
    }
    return {
      voiceEnabled: this.voiceEnabled,
      muted: this.muted,
      deafened: this.deafened,
      connectedPeerIds,
      speakingPeerIds: Array.from(this.speakingPeers),
      spatialPeerCount,
      localSpeaking: this.localSpeaking,
      localLevel: this.localLevel,
      errorMessage: this.errorMessage,
    };
  }

  isPeerSpeaking(peerId: string): boolean {
    return this.speakingPeers.has(peerId);
  }

  /**
   * Registers a 3D Object3D anchor (remote avatar head group) for a peer so their
   * WebRTC voice stream plays spatially via Three.js PositionalAudio.
   */
  attachPeerPositionalAudio(peerId: string, anchor: THREE.Object3D) {
    this.peerAnchors.set(peerId, anchor);
    const sess = this.sessions.get(peerId);
    if (sess?.remoteStream) {
      this.bindPeerSpatialAudio(sess);
      this.emitState();
    }
  }

  detachPeerPositionalAudio(peerId: string) {
    this.peerAnchors.delete(peerId);
    const sess = this.sessions.get(peerId);
    if (sess) {
      this.bindPeerSpatialAudio(sess);
      this.emitState();
    }
  }

  /**
   * Re-binds all active peer WebRTC streams to Three.js PositionalAudio once
   * the scene AudioListener is attached to the camera.
   */
  syncAllSpatialAudio() {
    let updated = false;
    for (const sess of this.sessions.values()) {
      if (sess.remoteStream && !sess.posAudio && this.peerAnchors.has(sess.peerId)) {
        this.bindPeerSpatialAudio(sess);
        updated = true;
      }
    }
    if (updated) {
      this.emitState();
    }
  }

  private emitState() {
    const snap = this.getSnapshot();
    for (const cb of this.stateListeners) cb(snap);
  }

  private emitLevel() {
    const snap = this.getSnapshot();
    for (const cb of this.levelListeners) cb(snap);
  }

  private ensureAudioContext(): AudioContext | null {
    const ctx = audioEngine.getSharedAudioContext();
    audioEngine.resume();
    return ctx;
  }

  private ensureAudioContainer(): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    if (!this.audioContainer) {
      const div = document.createElement('div');
      div.id = 'webrtc-audio-pool';
      div.style.display = 'none';
      document.body.appendChild(div);
      this.audioContainer = div;
    }
    return this.audioContainer;
  }

  async enableVoice(): Promise<{ ok: boolean; message?: string }> {
    if (this.voiceEnabled && this.localStream) {
      return { ok: true };
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      this.errorMessage = 'WebRTC microphone unavailable in this browser.';
      this.emitState();
      return { ok: false, message: this.errorMessage };
    }

    try {
      this.errorMessage = '';
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localStream = stream;
      this.voiceEnabled = true;
      this.muted = false;

      const ctx = this.ensureAudioContext();
      if (ctx) {
        this.localSource = ctx.createMediaStreamSource(stream);
        this.localAnalyser = ctx.createAnalyser();
        this.localAnalyser.fftSize = 256;
        this.localSource.connect(this.localAnalyser);
        this.localFreqBuffer = new Uint8Array(new ArrayBuffer(this.localAnalyser.frequencyBinCount));
      }

      this.startMeterLoop();
      multiplayerClient.sendVoiceState(true, this.muted);

      // Attach local audio tracks to existing peer connections and trigger negotiation
      for (const sess of this.sessions.values()) {
        this.attachLocalTracksToConnection(sess.pc);
      }
      this.ensureConnectionsForActivePeers();
      this.emitState();
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Microphone permission denied.';
      this.errorMessage = msg;
      this.voiceEnabled = false;
      this.emitState();
      return { ok: false, message: msg };
    }
  }

  disableVoice() {
    this.voiceEnabled = false;
    this.muted = false;
    this.localSpeaking = false;
    this.localLevel = 0;
    this.errorMessage = '';

    if (this.localSource) {
      this.localSource.disconnect();
      this.localSource = null;
    }
    this.localAnalyser = null;
    this.localFreqBuffer = null;

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    // Remove local senders from peer connections so remote peers stop receiving
    for (const sess of this.sessions.values()) {
      for (const sender of sess.pc.getSenders()) {
        if (sender.track) {
          try {
            sess.pc.removeTrack(sender);
          } catch {
            // Ignore closed pc
          }
        }
      }
    }

    multiplayerClient.sendVoiceState(false, false);

    // If no peers have voice enabled either, clean up meter & sessions
    if (!this.anyRemotePeerHasVoice()) {
      this.closeAllPeerConnections();
      this.stopMeterLoop();
    }
    this.emitState();
  }

  toggleMute(): boolean {
    if (!this.voiceEnabled) return false;
    this.muted = !this.muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = !this.muted;
      }
    }
    if (this.muted) {
      this.localSpeaking = false;
      this.localLevel = 0;
    }
    multiplayerClient.sendVoiceState(this.voiceEnabled, this.muted);
    this.emitState();
    return this.muted;
  }

  toggleDeafen(): boolean {
    this.deafened = !this.deafened;
    for (const sess of this.sessions.values()) {
      if (sess.posAudio) {
        sess.posAudio.setVolume(this.deafened ? 0 : 1);
        if (sess.audioEl) {
          sess.audioEl.muted = true;
        }
      } else if (sess.audioEl) {
        sess.audioEl.muted = this.deafened;
      }
    }
    this.emitState();
    return this.deafened;
  }

  private anyRemotePeerHasVoice(): boolean {
    const selfId = multiplayerClient.getSelfId();
    for (const p of this.knownPeers.values()) {
      if (p.id !== selfId && p.voiceEnabled) return true;
    }
    return false;
  }

  private syncPeerList(participants: PeerInfo[]) {
    const selfId = multiplayerClient.getSelfId();
    const activeIds = new Set<string>();
    this.knownPeers.clear();
    for (const p of participants) {
      this.knownPeers.set(p.id, p);
      if (p.id !== selfId) activeIds.add(p.id);
    }

    // Close connections for peers that left
    for (const peerId of Array.from(this.sessions.keys())) {
      if (!activeIds.has(peerId)) {
        this.closePeerConnection(peerId);
      }
    }
  }

  private ensureConnectionsForActivePeers() {
    const selfId = multiplayerClient.getSelfId();
    if (!selfId || !multiplayerClient.isConnected()) return;

    for (const peer of this.knownPeers.values()) {
      if (peer.id === selfId) continue;
      // Establish WebRTC mesh link whenever either side has voice active
      if ((this.voiceEnabled || peer.voiceEnabled) && !this.sessions.has(peer.id)) {
        this.getOrCreateSession(peer.id);
      }
    }
  }

  private attachLocalTracksToConnection(pc: RTCPeerConnection) {
    if (!this.localStream) return;
    const existingTrackIds = new Set(
      pc
        .getSenders()
        .map((s) => s.track?.id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !this.muted;
      if (!existingTrackIds.has(track.id)) {
        pc.addTrack(track, this.localStream);
      }
    }
  }

  private getOrCreateSession(peerId: string): RemotePeerSession {
    const existing = this.sessions.get(peerId);
    if (existing) return existing;

    const selfId = multiplayerClient.getSelfId() || '';
    const isPolite = selfId < peerId;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const sess: RemotePeerSession = {
      peerId,
      pc,
      makingOffer: false,
      ignoreOffer: false,
      isPolite,
      pendingCandidates: [],
      remoteStream: null,
      audioEl: null,
      posAudio: null,
      analyser: null,
      sourceNode: null,
      freqBuffer: null,
    };
    this.sessions.set(peerId, sess);

    // Ensure transceiver exists even if receive-only so SDP negotiation completes cleanly
    if (this.voiceEnabled && this.localStream) {
      this.attachLocalTracksToConnection(pc);
    } else {
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        multiplayerClient.sendWebRtcSignal(peerId, 'ice-candidate', ev.candidate.toJSON());
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        sess.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) {
          multiplayerClient.sendWebRtcSignal(peerId, 'offer', pc.localDescription.toJSON());
        }
      } catch {
        // Ignore transient negotiation abort
      } finally {
        sess.makingOffer = false;
      }
    };

    pc.ontrack = (ev) => {
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      sess.remoteStream = stream;

      // Keep a hidden <audio> element pumping the WebRTC MediaStream in Chromium;
      // mute it when THREE.PositionalAudio drives audible 3D spatial output.
      const container = this.ensureAudioContainer();
      if (!sess.audioEl && container) {
        const audio = document.createElement('audio');
        audio.autoplay = true;
        (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
        audio.muted = this.deafened;
        audio.srcObject = stream;
        container.appendChild(audio);
        sess.audioEl = audio;
        void audio.play().catch(() => {});
      } else if (sess.audioEl) {
        sess.audioEl.srcObject = stream;
      }

      this.bindPeerSpatialAudio(sess);
      this.startMeterLoop();
      this.emitState();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try {
          pc.restartIce();
        } catch {
          // Ignore if unsupported
        }
      }
      this.emitState();
    };

    return sess;
  }

  private async handleSignal(
    fromId: string,
    signalType: 'offer' | 'answer' | 'ice-candidate',
    payload: unknown,
  ) {
    if (!fromId || fromId === multiplayerClient.getSelfId()) return;
    const sess = this.getOrCreateSession(fromId);
    const { pc } = sess;

    try {
      if (signalType === 'offer' || signalType === 'answer') {
        const description = payload as RTCSessionDescriptionInit;
        const offerCollision =
          description.type === 'offer' &&
          (sess.makingOffer || pc.signalingState !== 'stable');

        sess.ignoreOffer = !sess.isPolite && offerCollision;
        if (sess.ignoreOffer) return;

        await pc.setRemoteDescription(description);

        // Drain queued ICE candidates now that remote description is applied
        while (sess.pendingCandidates.length > 0) {
          const cand = sess.pendingCandidates.shift();
          if (cand) await pc.addIceCandidate(cand).catch(() => {});
        }

        if (description.type === 'offer') {
          if (this.voiceEnabled && this.localStream) {
            this.attachLocalTracksToConnection(pc);
          }
          await pc.setLocalDescription();
          if (pc.localDescription) {
            multiplayerClient.sendWebRtcSignal(fromId, 'answer', pc.localDescription.toJSON());
          }
        }
      } else if (signalType === 'ice-candidate') {
        const candidate = payload as RTCIceCandidateInit;
        if (!candidate) return;
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            if (!sess.ignoreOffer) {
              // Ignore late ICE candidates
            }
          }
        } else {
          sess.pendingCandidates.push(candidate);
        }
      }
    } catch {
      // Ignore signaling race during teardown
    }
  }

  private bindPeerSpatialAudio(sess: RemotePeerSession) {
    if (sess.posAudio) {
      try {
        sess.posAudio.disconnect();
      } catch {
        // Ignore already disconnected
      }
      sess.posAudio.removeFromParent();
      sess.posAudio = null;
    }
    if (sess.sourceNode) {
      try {
        sess.sourceNode.disconnect();
      } catch {
        // Ignore
      }
      sess.sourceNode = null;
    }

    const stream = sess.remoteStream;
    if (!stream) return;

    const listener = audioEngine.getAudioListener();
    const ctx = listener?.context ?? this.ensureAudioContext();
    if (ctx && !sess.analyser) {
      try {
        sess.analyser = ctx.createAnalyser();
        sess.analyser.fftSize = 256;
        sess.freqBuffer = new Uint8Array(new ArrayBuffer(sess.analyser.frequencyBinCount));
      } catch {
        sess.analyser = null;
      }
    }

    const anchor = this.peerAnchors.get(sess.peerId);
    if (listener && anchor) {
      try {
        audioEngine.resume();
        const posAudio = new THREE.PositionalAudio(listener);
        posAudio.name = `PeerVoice_${sess.peerId}`;
        posAudio.panner.panningModel = 'HRTF';
        posAudio.setDistanceModel('inverse');
        posAudio.setRefDistance(1.0);
        posAudio.setRolloffFactor(1.25);
        posAudio.setMaxDistance(16);
        posAudio.setMediaStreamSource(stream);
        posAudio.setVolume(this.deafened ? 0 : 1);
        posAudio.position.set(0, 0, 0);
        anchor.add(posAudio);
        posAudio.updateMatrixWorld(true);
        sess.posAudio = posAudio;

        if (posAudio.source && sess.analyser) {
          posAudio.source.connect(sess.analyser);
        }
        // Mute flat DOM playback so audio outputs strictly through 3D PositionalAudio
        if (sess.audioEl) {
          sess.audioEl.muted = true;
        }
        return;
      } catch {
        // Fall through to non-spatial fallback
      }
    }

    if (ctx && sess.analyser) {
      try {
        sess.sourceNode = ctx.createMediaStreamSource(stream);
        sess.sourceNode.connect(sess.analyser);
      } catch {
        // Ignore analyser errors if stream closes
      }
    }
    if (sess.audioEl) {
      sess.audioEl.muted = this.deafened;
    }
  }

  private closePeerConnection(peerId: string) {
    const sess = this.sessions.get(peerId);
    if (!sess) return;
    this.sessions.delete(peerId);
    this.speakingPeers.delete(peerId);

    if (sess.posAudio) {
      try {
        sess.posAudio.disconnect();
      } catch {
        // Ignore
      }
      sess.posAudio.removeFromParent();
      sess.posAudio = null;
    }
    try {
      sess.sourceNode?.disconnect();
    } catch {
      // Ignore
    }
    if (sess.audioEl) {
      sess.audioEl.srcObject = null;
      sess.audioEl.remove();
    }
    try {
      sess.pc.close();
    } catch {
      // Ignore
    }
  }

  private closeAllPeerConnections() {
    for (const peerId of Array.from(this.sessions.keys())) {
      this.closePeerConnection(peerId);
    }
  }

  private computeLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
    analyser.getByteFrequencyData(buffer);
    let sum = 0;
    const bins = Math.min(32, buffer.length);
    for (let i = 0; i < bins; i++) {
      sum += buffer[i];
    }
    return Math.min(1, sum / (bins * 110));
  }

  private startMeterLoop() {
    if (this.meterTimer !== null) return;
    this.meterTimer = window.setInterval(() => {
      let changed = false;

      if (this.voiceEnabled && !this.muted && this.localAnalyser && this.localFreqBuffer) {
        this.localLevel = this.computeLevel(this.localAnalyser, this.localFreqBuffer);
        const speaking = this.localLevel > 0.11;
        if (speaking !== this.localSpeaking) {
          this.localSpeaking = speaking;
          changed = true;
        }
      } else {
        if (this.localLevel !== 0 || this.localSpeaking) {
          this.localLevel = 0;
          this.localSpeaking = false;
          changed = true;
        }
      }

      for (const [peerId, sess] of this.sessions.entries()) {
        const peer = this.knownPeers.get(peerId);
        if (peer?.voiceEnabled && !peer?.muted && sess.analyser && sess.freqBuffer && !this.deafened) {
          const lvl = this.computeLevel(sess.analyser, sess.freqBuffer);
          const isSpk = lvl > 0.1;
          const wasSpk = this.speakingPeers.has(peerId);
          if (isSpk && !wasSpk) {
            this.speakingPeers.add(peerId);
            changed = true;
          } else if (!isSpk && wasSpk) {
            this.speakingPeers.delete(peerId);
            changed = true;
          }
        } else if (this.speakingPeers.delete(peerId)) {
          changed = true;
        }
      }

      this.emitLevel();
      if (changed) {
        this.emitState();
      }
    }, 90);
  }

  private stopMeterLoop() {
    if (this.meterTimer !== null) {
      window.clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }
}

export const voiceChatManager = new VoiceChatManager();
