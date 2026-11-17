export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PeerInfo {
  id: string;
  name: string;
  color: string;
  deviceProfile: string;
  headPos: Vec3Like;
  headQuat: QuatLike;
  handPos: Vec3Like | null;
  voiceEnabled?: boolean;
  muted?: boolean;
}

export interface RoomPartSync {
  id: string;
  pos: Vec3Like;
  quat: QuatLike;
  snapped: boolean;
  lockedBy: string | null;
}

export interface SpatialAnnotation {
  id: string;
  author: string;
  text: string;
  pos: Vec3Like;
  color: string;
  createdAt: number;
}

export interface RoomSnapshot {
  roomCode: string;
  moduleId: string;
  explodedAmount: number;
  participants: PeerInfo[];
  parts: RoomPartSync[];
  annotations: SpatialAnnotation[];
}

export type MultiplayerEvent =
  | { type: 'connected'; selfId: string; room: RoomSnapshot }
  | { type: 'disconnected' }
  | { type: 'peers'; participants: PeerInfo[] }
  | { type: 'avatar:pose'; clientId: string; headPos: Vec3Like; headQuat: QuatLike; handPos: Vec3Like | null }
  | { type: 'part:grab'; partId: string; clientId: string }
  | { type: 'part:move'; partId: string; pos: Vec3Like; quat: QuatLike; snapped: boolean; clientId: string }
  | { type: 'part:snap'; partId: string; pos: Vec3Like; quat: QuatLike; clientId: string }
  | { type: 'part:release'; partId: string; pos?: Vec3Like; quat?: QuatLike; clientId: string }
  | { type: 'module:switch'; moduleId: string; clientId: string }
  | { type: 'exploded:change'; amount: number; clientId: string }
  | { type: 'room:reset'; clientId: string }
  | { type: 'annotation:add'; annotation: SpatialAnnotation }
  | { type: 'voice:state'; clientId: string; voiceEnabled: boolean; muted: boolean; participants: PeerInfo[] }
  | { type: 'webrtc:signal'; fromId: string; signalType: 'offer' | 'answer' | 'ice-candidate'; payload: unknown };

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<(event: MultiplayerEvent) => void>();
  private selfId: string | null = null;
  private currentRoomCode: string | null = null;
  private currentName = 'Operator';
  private currentDevice = 'desktop';
  private currentModule = 'turbine';
  private reconnectTimer: number | null = null;
  private manualClose = false;
  private pendingQueue: string[] = [];

  onEvent(cb: (event: MultiplayerEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: MultiplayerEvent) {
    for (const cb of this.listeners) cb(event);
  }

  getSelfId(): string | null {
    return this.selfId;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN && Boolean(this.currentRoomCode);
  }

  getRoomCode(): string | null {
    return this.currentRoomCode;
  }

  connect(roomCode: string, name: string, deviceProfile: string, moduleId: string) {
    this.manualClose = false;
    this.currentRoomCode = roomCode.trim() || 'LAB-01';
    this.currentName = name.trim() || 'Operator';
    this.currentDevice = deviceProfile;
    this.currentModule = moduleId;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const sock = new WebSocket(url);
    this.ws = sock;

    sock.onopen = () => {
      sock.send(
        JSON.stringify({
          type: 'room:join',
          roomCode: this.currentRoomCode,
          name: this.currentName,
          deviceProfile: this.currentDevice,
          moduleId: this.currentModule,
        }),
      );
      while (this.pendingQueue.length > 0) {
        const msg = this.pendingQueue.shift();
        if (msg) sock.send(msg);
      }
    };

    sock.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        const type = String(data.type || '');
        if (type === 'room:state') {
          this.selfId = String(data.selfId || '');
          this.emit({
            type: 'connected',
            selfId: this.selfId,
            room: data.room as RoomSnapshot,
          });
        } else if (type === 'user:joined' || type === 'user:left') {
          this.emit({
            type: 'peers',
            participants: (data.participants as PeerInfo[]) || [],
          });
        } else if (type === 'avatar:pose') {
          this.emit(data as unknown as MultiplayerEvent);
        } else if (
          type === 'part:grab' ||
          type === 'part:move' ||
          type === 'part:snap' ||
          type === 'part:release' ||
          type === 'module:switch' ||
          type === 'exploded:change' ||
          type === 'room:reset' ||
          type === 'annotation:add' ||
          type === 'voice:state' ||
          type === 'webrtc:signal'
        ) {
          this.emit(data as unknown as MultiplayerEvent);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    sock.onclose = () => {
      this.emit({ type: 'disconnected' });
      if (!this.manualClose && this.currentRoomCode) {
        if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = window.setTimeout(() => {
          if (this.currentRoomCode && !this.manualClose) {
            this.connect(this.currentRoomCode, this.currentName, this.currentDevice, this.currentModule);
          }
        }, 2500);
      }
    };
  }

  disconnect() {
    this.manualClose = true;
    this.currentRoomCode = null;
    this.selfId = null;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.emit({ type: 'disconnected' });
  }

  send(payload: Record<string, unknown>) {
    if (!this.currentRoomCode) return;
    const raw = JSON.stringify(payload);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(raw);
    } else if (this.pendingQueue.length < 25) {
      this.pendingQueue.push(raw);
    }
  }

  sendVoiceState(voiceEnabled: boolean, muted: boolean) {
    this.send({
      type: 'voice:state',
      voiceEnabled,
      muted,
    });
  }

  sendWebRtcSignal(
    targetId: string,
    signalType: 'offer' | 'answer' | 'ice-candidate',
    payload: unknown,
  ) {
    if (!this.currentRoomCode || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: 'webrtc:signal',
        targetId,
        signalType,
        payload,
      }),
    );
  }
}

export const multiplayerClient = new MultiplayerClient();
