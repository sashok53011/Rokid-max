import jsQR, { type QRCode } from 'jsqr';
import type { CustomQrPartDef } from '../modules/SimulationCatalog.ts';
import type { RoomBoundsSpec } from '../services/offlineSync.ts';

export type CameraGestureAction =
  | 'None'
  | 'Closed_Fist'
  | 'Open_Palm'
  | 'Pointing_Up'
  | 'Thumb_Up'
  | 'Victory'
  | 'ILoveYou';

export type CameraPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

export interface RecognizedArObject {
  label: string;
  score: number;
  bbox: [number, number, number, number];
}

export interface QrRoomPayload {
  type: 'room_scale';
  name?: string;
  markerId?: string;
  bounds: RoomBoundsSpec;
}

export interface QrModelPayload {
  type: 'model_3d';
  name: string;
  parts: CustomQrPartDef[];
}

export type QrImportPayload = QrRoomPayload | QrModelPayload;

export interface CameraStartOptions {
  qrOnly?: boolean;
  facingMode?: 'environment' | 'user';
  deviceId?: string;
}

export interface VisionCallbacks {
  onGesture?: (gesture: CameraGestureAction, confidence: number) => void;
  onObjects?: (objects: RecognizedArObject[]) => void;
  onQrDecoded?: (payload: QrImportPayload, rawText: string) => void;
  onStatus?: (status: string) => void;
  onPermissionChange?: (state: CameraPermissionState) => void;
}

function clampNum(val: unknown, fallback: number, min: number, max: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

/**
 * Uses device camera + @mediapipe/tasks-vision (GestureRecognizer & ObjectDetector)
 * + jsQR for real-time AR object recognition, hand gesture tracking, and external QR
 * room-scale spatial marker calibration.
 */
export class CameraVisionEngine {
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private running = false;
  private qrOnly = false;
  private facingMode: 'environment' | 'user' = 'environment';
  private activeDeviceId = '';
  private rafId = 0;
  private lastVisionTs = 0;
  private lastQrTs = 0;
  private lastQrRaw = '';
  private lastQrHighlightAt = 0;
  private lastQrLocation: QRCode['location'] | null = null;
  private permissionState: CameraPermissionState = 'prompt';

  private gestureRecognizer: {
    recognizeForVideo: (
      video: HTMLVideoElement,
      timestampMs: number,
    ) => { gestures?: Array<Array<{ categoryName: string; score: number }>> };
  } | null = null;

  private objectDetector: {
    detectForVideo: (
      video: HTMLVideoElement,
      timestampMs: number,
    ) => {
      detections?: Array<{
        categories?: Array<{ categoryName: string; score: number }>;
        boundingBox?: { originX: number; originY: number; width: number; height: number };
      }>;
    };
  } | null = null;

  private callbacks: VisionCallbacks = {};

  setCallbacks(cb: VisionCallbacks) {
    this.callbacks = { ...this.callbacks, ...cb };
  }

  attachElements(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    this.videoEl = video;
    this.canvasEl = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (this.stream && video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => {});
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getPermissionState(): CameraPermissionState {
    return this.permissionState;
  }

  getFacingMode(): 'environment' | 'user' {
    return this.facingMode;
  }

  setQrOnlyMode(qrOnly: boolean) {
    this.qrOnly = qrOnly;
  }

  resetLastQr() {
    this.lastQrRaw = '';
    this.lastQrLocation = null;
    this.lastQrHighlightAt = 0;
  }

  async checkCameraPermission(): Promise<CameraPermissionState> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.permissionState = 'unsupported';
      this.callbacks.onPermissionChange?.('unsupported');
      return 'unsupported';
    }
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
        const mapped: CameraPermissionState =
          status.state === 'granted' || status.state === 'denied' ? status.state : 'prompt';
        this.permissionState = mapped;
        this.callbacks.onPermissionChange?.(mapped);
        return mapped;
      }
    } catch {
      // Permissions query for 'camera' is unsupported on some browsers (e.g. Safari/WebViews)
    }
    if (this.stream) {
      this.permissionState = 'granted';
      return 'granted';
    }
    return this.permissionState;
  }

  async listVideoDevices(): Promise<MediaDeviceInfo[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((d) => d.kind === 'videoinput');
    } catch {
      return [];
    }
  }

  async start(options: CameraStartOptions = {}): Promise<{ ok: boolean; message: string; permission: CameraPermissionState }> {
    this.qrOnly = Boolean(options.qrOnly);
    if (options.facingMode) {
      this.facingMode = options.facingMode;
    }
    if (options.deviceId !== undefined) {
      this.activeDeviceId = options.deviceId;
    }

    if (this.running && !options.deviceId && !options.facingMode) {
      return { ok: true, message: 'Active', permission: 'granted' };
    }
    if (this.running) {
      this.stop();
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.permissionState = 'unsupported';
      this.callbacks.onPermissionChange?.('unsupported');
      return { ok: false, message: 'Camera API unavailable in this browser', permission: 'unsupported' };
    }

    try {
      const constraints: MediaStreamConstraints = this.activeDeviceId
        ? {
            video: {
              deviceId: { exact: this.activeDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          }
        : {
            video: {
              facingMode: { ideal: this.facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          };

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (firstErr) {
        // Retry with generic constraints only if hardware constraint failed (not permission denial)
        const name =
          firstErr && typeof firstErr === 'object' && 'name' in firstErr
            ? String((firstErr as { name?: unknown }).name)
            : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          throw firstErr;
        }
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      this.permissionState = 'granted';
      this.callbacks.onPermissionChange?.('granted');
      this.lastQrRaw = '';

      const activeTrack = this.stream.getVideoTracks()[0];
      const settings = activeTrack?.getSettings?.();
      if (settings?.deviceId) {
        this.activeDeviceId = settings.deviceId;
      }

      if (this.videoEl) {
        this.videoEl.srcObject = this.stream;
        await this.videoEl.play().catch(() => {});
      }
      this.running = true;
      if (!this.qrOnly) {
        void this.initMediaPipeModels();
        this.callbacks.onStatus?.('Camera CV active');
        this.loop();
        return { ok: true, message: 'Camera CV active', permission: 'granted' };
      }
      this.callbacks.onStatus?.('QR Scanner ready');
      this.loop();
      return { ok: true, message: 'QR Scanner active', permission: 'granted' };
    } catch (err) {
      const name =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name?: unknown }).name)
          : '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
      if (denied) {
        this.permissionState = 'denied';
        this.callbacks.onPermissionChange?.('denied');
      }
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      this.callbacks.onStatus?.(msg);
      return { ok: false, message: msg, permission: this.permissionState };
    }
  }

  async switchCamera(): Promise<{ ok: boolean; message: string; permission: CameraPermissionState }> {
    const devices = await this.listVideoDevices();
    if (devices.length > 1) {
      const idx = devices.findIndex((d) => d.deviceId === this.activeDeviceId);
      const next = devices[(idx + 1) % devices.length];
      return this.start({ qrOnly: this.qrOnly, deviceId: next.deviceId });
    }
    this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
    this.activeDeviceId = '';
    return this.start({ qrOnly: this.qrOnly, facingMode: this.facingMode });
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.lastQrLocation = null;
    this.lastQrHighlightAt = 0;
  }

  private async initMediaPipeModels() {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.callbacks.onStatus?.('Offline: QR scanning active (MediaPipe models require cached/online WASM)');
      return;
    }
    try {
      const mp = await import('@mediapipe/tasks-vision');
      const vision = await mp.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm',
      );
      this.gestureRecognizer = await mp.GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      this.objectDetector = await mp.ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.45,
        maxResults: 4,
      });
      this.callbacks.onStatus?.('MediaPipe AR Vision + QR ready');
    } catch {
      this.callbacks.onStatus?.('QR Vision active (MediaPipe model fallback)');
    }
  }

  private drawQrLocation(ctx: CanvasRenderingContext2D, loc: QRCode['location']) {
    ctx.save();
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(loc.topLeftCorner.x, loc.topLeftCorner.y);
    ctx.lineTo(loc.topRightCorner.x, loc.topRightCorner.y);
    ctx.lineTo(loc.bottomRightCorner.x, loc.bottomRightCorner.y);
    ctx.lineTo(loc.bottomLeftCorner.x, loc.bottomLeftCorner.y);
    ctx.closePath();
    ctx.stroke();

    const corners = [
      loc.topLeftCorner,
      loc.topRightCorner,
      loc.bottomRightCorner,
      loc.bottomLeftCorner,
    ];
    ctx.fillStyle = '#38bdf8';
    for (const c of corners) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private loop = () => {
    if (!this.running) return;
    const video = this.videoEl;
    const canvas = this.canvasEl;
    const ctx = this.ctx;
    if (video && canvas && ctx && video.readyState >= 2) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const now = performance.now();

      // QR scan (~12 Hz in QR overlay mode, ~6 Hz in full CV mode)
      const qrIntervalMs = this.qrOnly ? 85 : 160;
      if (now - this.lastQrTs > qrIntervalMs) {
        this.lastQrTs = now;
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imgData.data, imgData.width, imgData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (code && code.data) {
          this.lastQrLocation = code.location;
          this.lastQrHighlightAt = now;
          if (code.data !== this.lastQrRaw) {
            this.lastQrRaw = code.data;
            const parsed = this.parseQrText(code.data);
            if (parsed) {
              this.callbacks.onQrDecoded?.(parsed, code.data);
            }
          }
        }
      }

      if (this.lastQrLocation && now - this.lastQrHighlightAt < 900) {
        this.drawQrLocation(ctx, this.lastQrLocation);
      }

      // MediaPipe gesture & object recognition ~10 Hz (skipped in QR-only scanner overlay)
      if (!this.qrOnly && now - this.lastVisionTs > 100) {
        this.lastVisionTs = now;
        if (this.gestureRecognizer) {
          try {
            const res = this.gestureRecognizer.recognizeForVideo(video, now);
            const top = res.gestures?.[0]?.[0];
            if (top && top.score > 0.55) {
              this.callbacks.onGesture?.(top.categoryName as CameraGestureAction, top.score);
            }
          } catch {
            // Ignore frame skip
          }
        }
        if (this.objectDetector) {
          try {
            const det = this.objectDetector.detectForVideo(video, now);
            const objects: RecognizedArObject[] = (det.detections || [])
              .map((d) => {
                const cat = d.categories?.[0];
                const box = d.boundingBox;
                if (!cat || !box) return null;
                return {
                  label: cat.categoryName,
                  score: cat.score,
                  bbox: [box.originX, box.originY, box.width, box.height] as [number, number, number, number],
                };
              })
              .filter((x): x is RecognizedArObject => x !== null);
            this.callbacks.onObjects?.(objects);

            // Draw subtle AR boxes onto preview canvas
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2;
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#38bdf8';
            for (const o of objects) {
              ctx.strokeRect(o.bbox[0], o.bbox[1], o.bbox[2], o.bbox[3]);
              ctx.fillText(
                `${o.label} ${Math.round(o.score * 100)}%`,
                o.bbox[0] + 4,
                Math.max(14, o.bbox[1] - 4),
              );
            }
          } catch {
            // Ignore frame skip
          }
        }
      }
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  async decodeQrFromFile(file: File): Promise<{ ok: boolean; payload?: QrImportPayload; raw?: string }> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const c = off.getContext('2d');
        if (!c) {
          URL.revokeObjectURL(url);
          resolve({ ok: false });
          return;
        }
        c.drawImage(img, 0, 0);
        const data = c.getImageData(0, 0, off.width, off.height);
        const qr = jsQR(data.data, data.width, data.height, {
          inversionAttempts: 'attemptBoth',
        });
        URL.revokeObjectURL(url);
        if (!qr || !qr.data) {
          resolve({ ok: false });
          return;
        }
        const parsed = this.parseQrText(qr.data);
        if (parsed) {
          this.callbacks.onQrDecoded?.(parsed, qr.data);
          resolve({ ok: true, payload: parsed, raw: qr.data });
        } else {
          resolve({ ok: false, raw: qr.data });
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ ok: false });
      };
      img.src = url;
    });
  }

  /**
   * Parses external QR payloads into typed room-scale calibration or 3D model definitions.
   * Supports:
   *  1) Structured JSON (`type: 'room_scale'`, `bounds`, optional `anchor`)
   *  2) Flat JSON (`width`, `depth`, optional `height`, `originX/Y/Z`, `yawDeg`, `markerId`, `name`)
   *  3) Compact marker string (`ROOM:4.4x3.6x2.7` or `ROOM:4.4x3.6x2.7@0,0,-1.2`)
   *  4) URI scheme (`aerolab://room?w=4.4&d=3.6&h=2.7&ox=0&oy=0&oz=-1.2&yaw=15&name=Bay-A&id=QR-01`)
   *  5) Model JSON (`type: 'model_3d'`, `parts`)
   */
  parseQrText(raw: string): QrImportPayload | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // 1 & 2 & 5: JSON payloads
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.type === 'model_3d' && Array.isArray(obj.parts)) {
        return {
          type: 'model_3d',
          name: typeof obj.name === 'string' ? obj.name.slice(0, 40) : 'QR Model',
          parts: obj.parts as CustomQrPartDef[],
        };
      }

      const boundsObj =
        obj.type === 'room_scale' && obj.bounds && typeof obj.bounds === 'object'
          ? (obj.bounds as Record<string, unknown>)
          : typeof obj.width === 'number' && typeof obj.depth === 'number'
            ? obj
            : null;

      if (boundsObj) {
        const anchor =
          obj.anchor && typeof obj.anchor === 'object'
            ? (obj.anchor as Record<string, unknown>)
            : undefined;
        const name =
          typeof obj.name === 'string'
            ? obj.name.slice(0, 64)
            : 'QR Room Calibration';
        const markerId =
          typeof anchor?.markerId === 'string'
            ? anchor.markerId.slice(0, 32)
            : typeof obj.markerId === 'string'
              ? obj.markerId.slice(0, 32)
              : undefined;
        const yawDeg = clampNum(
          boundsObj.yawDeg ?? anchor?.yawDeg ?? obj.yawDeg ?? 0,
          0,
          -180,
          180,
        );

        return {
          type: 'room_scale',
          name,
          markerId,
          bounds: {
            width: clampNum(boundsObj.width, 4.0, 1, 25),
            depth: clampNum(boundsObj.depth, 3.5, 1, 25),
            height: clampNum(boundsObj.height, 2.6, 1.5, 10),
            originX: clampNum(boundsObj.originX, 0, -15, 15),
            originY: clampNum(boundsObj.originY, 0, -5, 5),
            originZ: clampNum(boundsObj.originZ, -1.2, -15, 15),
            yawDeg,
            markerId,
            name,
          },
        };
      }
    } catch {
      // Fall through to compact & URI QR marker formats
    }

    // 3: Compact pipe/colon format: ROOM:4.2x3.4x2.7[@ox,oy,oz]
    if (/^ROOM:/i.test(trimmed)) {
      const body = trimmed.slice(5).trim();
      const [dimPart, originPart] = body.split('@');
      const dims = dimPart.split(/x/i).map(Number);
      if (dims.length >= 2 && dims.slice(0, 2).every((n) => Number.isFinite(n) && n > 0)) {
        const orig = originPart ? originPart.split(',').map(Number) : [];
        const name = 'Compact Room QR';
        return {
          type: 'room_scale',
          name,
          bounds: {
            width: clampNum(dims[0], 4.0, 1, 25),
            depth: clampNum(dims[1], 3.5, 1, 25),
            height: clampNum(dims[2], 2.6, 1.5, 10),
            originX: clampNum(orig[0], 0, -15, 15),
            originY: clampNum(orig[1], 0, -5, 15),
            originZ: clampNum(orig[2], -1.2, -15, 15),
            yawDeg: 0,
            name,
          },
        };
      }
    }

    // 4: URI format: aerolab://room?w=4.4&d=3.6&h=2.7&...
    if (/^(aerolab|xr):\/\/room/i.test(trimmed)) {
      try {
        const queryIdx = trimmed.indexOf('?');
        const params = new URLSearchParams(queryIdx >= 0 ? trimmed.slice(queryIdx + 1) : '');
        const w = Number(params.get('w') ?? params.get('width'));
        const d = Number(params.get('d') ?? params.get('depth'));
        if (Number.isFinite(w) && Number.isFinite(d) && w > 0 && d > 0) {
          const name = (params.get('name') || 'URI Room Marker').slice(0, 64);
          const markerId = params.get('id')?.slice(0, 32) || undefined;
          return {
            type: 'room_scale',
            name,
            markerId,
            bounds: {
              width: clampNum(w, 4.0, 1, 25),
              depth: clampNum(d, 3.5, 1, 25),
              height: clampNum(params.get('h') ?? params.get('height') ?? 2.6, 2.6, 1.5, 10),
              originX: clampNum(params.get('ox') ?? 0, 0, -15, 15),
              originY: clampNum(params.get('oy') ?? 0, 0, -5, 5),
              originZ: clampNum(params.get('oz') ?? -1.2, -1.2, -15, 15),
              yawDeg: clampNum(params.get('yaw') ?? 0, 0, -180, 180),
              markerId,
              name,
            },
          };
        }
      } catch {
        // Ignore malformed URL params
      }
    }

    return null;
  }

  getSampleRoomQrPayload(): QrRoomPayload {
    return {
      type: 'room_scale',
      name: 'Hangar Bay B-12',
      markerId: 'QR-BAY-B12',
      bounds: {
        width: 4.4,
        depth: 3.6,
        height: 2.7,
        originX: 0,
        originY: 0,
        originZ: -1.2,
        yawDeg: 0,
        markerId: 'QR-BAY-B12',
        name: 'Hangar Bay B-12',
      },
    };
  }

  getSampleModelQrPayload(): QrModelPayload {
    return {
      type: 'model_3d',
      name: 'Cryo Valve Manifold',
      parts: [
        {
          id: 'cryo_body',
          label: 'Manifold Housing',
          shape: 'cylinder',
          color: '#0ea5e9',
          size: [0.12, 0.08, 0.12],
          targetOffset: [0, -0.02, 0],
        },
        {
          id: 'cryo_flange',
          label: 'Pressure Seal Ring',
          shape: 'torus',
          color: '#f59e0b',
          size: [0.11, 0.03, 0.11],
          targetOffset: [0, 0.04, 0],
        },
        {
          id: 'cryo_stem',
          label: 'Actuator Cone',
          shape: 'cone',
          color: '#10b981',
          size: [0.09, 0.1, 0.09],
          targetOffset: [0, 0.1, 0],
        },
      ],
    };
  }
}

export const cameraVision = new CameraVisionEngine();
