import { audioEngine } from '../audio/ProceduralAudio.ts';
import { TRANSLATIONS, type SupportedLang } from '../i18n/translations.ts';
import { wakeLockManager } from '../utils/platform.ts';
import {
  cameraVision,
  type CameraPermissionState,
  type QrImportPayload,
  type QrRoomPayload,
} from '../vision/CameraVisionEngine.ts';

export interface QrScannerOverlayCallbacks {
  getLang: () => SupportedLang;
  isDockCameraActive: () => boolean;
  onImportRoomScale: (payload: QrRoomPayload) => void;
  onImportModel3d: (name: string, parts: Extract<QrImportPayload, { type: 'model_3d' }>['parts']) => void;
  onStateChange?: (open: boolean) => void;
}

/**
 * Dedicated camera-permission QR Code Scanner Overlay for importing room-scale
 * spatial configurations from external QR markers (JSON, compact ROOM:, or URI).
 */
export class QrScannerOverlay {
  private host: HTMLElement;
  private cb: QrScannerOverlayCallbacks;
  private openState = false;
  private permission: CameraPermissionState = cameraVision.getPermissionState();
  private streaming = false;
  private errorMessage = '';
  private autoApply = true;
  private decodedRoom: QrRoomPayload | null = null;
  private decodedRaw = '';
  private appliedCount = 0;
  private lastRenderedLang: SupportedLang | null = null;

  private videoEl: HTMLVideoElement;
  private canvasEl: HTMLCanvasElement;
  private rootEl: HTMLDivElement | null = null;

  constructor(host: HTMLElement, callbacks: QrScannerOverlayCallbacks) {
    this.host = host;
    this.cb = callbacks;

    this.videoEl = document.createElement('video');
    this.videoEl.playsInline = true;
    this.videoEl.muted = true;
    this.videoEl.style.display = 'none';

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'qr-overlay-canvas';
  }

  isOpen(): boolean {
    return this.openState;
  }

  async open(): Promise<void> {
    if (this.openState) return;
    this.openState = true;
    this.errorMessage = '';
    this.decodedRoom = null;
    this.decodedRaw = '';
    cameraVision.resetLastQr();

    this.permission = await cameraVision.checkCameraPermission();
    this.render();
    this.cb.onStateChange?.(true);

    // If camera permission is already granted or awaiting prompt, request camera access directly
    // from this user gesture so the native permission dialog & live QR viewfinder start immediately.
    if (this.permission === 'granted' || this.permission === 'prompt') {
      await this.startCameraScan();
    }
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    this.streaming = false;

    if (!this.cb.isDockCameraActive()) {
      cameraVision.stop();
    } else {
      cameraVision.setQrOnlyMode(false);
    }

    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
    }
    this.cb.onStateChange?.(false);
  }

  async startCameraScan(): Promise<void> {
    this.errorMessage = '';
    void wakeLockManager.enable();
    cameraVision.attachElements(this.videoEl, this.canvasEl);
    const res = await cameraVision.start({ qrOnly: true });
    this.permission = res.permission;
    this.streaming = res.ok;
    if (!res.ok) {
      this.errorMessage = res.message;
    }
    this.render();
  }

  handleDecodedPayload(payload: QrImportPayload, rawText: string): boolean {
    if (!this.openState) return false;
    audioEngine.playCommandAck();
    this.decodedRaw = rawText;

    if (payload.type === 'room_scale') {
      this.decodedRoom = payload;
      if (this.autoApply) {
        this.applyDecodedRoom();
      } else {
        this.render();
      }
      return true;
    }

    if (payload.type === 'model_3d') {
      this.cb.onImportModel3d(payload.name, payload.parts);
      this.close();
      return true;
    }
    return false;
  }

  private applyDecodedRoom() {
    if (!this.decodedRoom) return;
    this.appliedCount += 1;
    this.cb.onImportRoomScale(this.decodedRoom);
    this.render();
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  syncLocale() {
    if (!this.openState) return;
    if (this.lastRenderedLang !== this.cb.getLang()) {
      this.render();
    }
  }

  render() {
    if (!this.openState) return;
    const lang = this.cb.getLang();
    this.lastRenderedLang = lang;
    const t = TRANSLATIONS[lang].vision;

    if (!this.rootEl) {
      const el = document.createElement('div');
      el.id = 'qr-scanner-overlay';
      el.className = 'qr-overlay-backdrop';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-label', t.scannerTitle);
      this.host.appendChild(el);
      this.rootEl = el;
    }

    const permLabel =
      this.permission === 'granted'
        ? t.permGranted
        : this.permission === 'denied'
          ? t.permDenied
          : this.permission === 'unsupported'
            ? t.permUnsupported
            : t.permPrompt;

    const permClass =
      this.permission === 'granted'
        ? 'granted'
        : this.permission === 'denied' || this.permission === 'unsupported'
          ? 'denied'
          : 'prompt';

    const room = this.decodedRoom;
    const b = room?.bounds;

    this.rootEl.innerHTML = `
      <div class="qr-overlay-card">
        <div class="qr-overlay-header">
          <div>
            <div class="qr-overlay-title">${this.escapeHtml(t.scannerTitle)}</div>
            <div class="qr-overlay-sub">${this.escapeHtml(t.scannerSubtitle)}</div>
          </div>
          <div class="qr-overlay-header-right">
            <span class="qr-perm-badge ${permClass}">${this.escapeHtml(permLabel)}</span>
            <button class="chip-btn" id="qr-ov-close" aria-label="${this.escapeHtml(t.closeBtn)}">✕</button>
          </div>
        </div>

        <div class="qr-viewfinder ${room ? 'locked' : this.streaming ? 'scanning' : 'idle'}">
          <div class="qr-media-host" id="qr-ov-media-host"></div>
          ${
            !this.streaming
              ? `<div class="qr-idle-gate">
                   <p class="qr-idle-msg">${this.escapeHtml(
                     this.permission === 'denied'
                       ? t.deniedHint
                       : this.errorMessage || t.awaitingMarker,
                   )}</p>
                   ${
                     this.permission !== 'unsupported'
                       ? `<button class="dock-btn primary" id="qr-ov-allow-cam">${this.escapeHtml(t.allowCameraBtn)}</button>`
                       : ''
                   }
                 </div>`
              : `<div class="qr-reticle" aria-hidden="true">
                   <span class="qr-corner tl"></span>
                   <span class="qr-corner tr"></span>
                   <span class="qr-corner bl"></span>
                   <span class="qr-corner br"></span>
                   ${!room ? '<div class="qr-scanline"></div>' : ''}
                 </div>`
          }
          <div class="qr-vf-caption">
            ${this.escapeHtml(
              room
                ? `✓ ${room.name || 'QR Room'} (${b!.width.toFixed(1)}×${b!.depth.toFixed(1)}×${b!.height.toFixed(1)}m)`
                : t.awaitingMarker,
            )}
          </div>
        </div>

        ${
          room && b
            ? `<div class="qr-decoded-panel">
                 <div class="qr-decoded-head">
                   <strong>${this.escapeHtml(t.decodedTitle)}: ${this.escapeHtml(room.name || 'Room Scale')}</strong>
                   ${room.markerId ? `<span class="mono-val">${this.escapeHtml(t.markerIdLabel)}: ${this.escapeHtml(room.markerId)}</span>` : ''}
                 </div>
                 <div class="qr-decoded-metrics">
                   <div><span class="muted">${this.escapeHtml(t.dimensionsLabel)}:</span> <strong>${b.width.toFixed(2)} × ${b.depth.toFixed(2)} × ${b.height.toFixed(2)} m</strong></div>
                   <div><span class="muted">${this.escapeHtml(t.originLabel)}:</span> <strong>(${b.originX.toFixed(2)}, ${b.originY.toFixed(2)}, ${b.originZ.toFixed(2)}) · ${(b.yawDeg ?? 0).toFixed(0)}°</strong></div>
                 </div>
                 ${
                   this.decodedRaw
                     ? `<div class="qr-raw-snippet" title="${this.escapeHtml(this.decodedRaw)}">${this.escapeHtml(
                         this.decodedRaw.length > 96 ? `${this.decodedRaw.slice(0, 96)}…` : this.decodedRaw,
                       )}</div>`
                     : ''
                 }
                 <div class="qr-decoded-actions">
                   <button class="dock-btn primary" id="qr-ov-apply">${this.escapeHtml(t.applyRoomBtn)}${this.appliedCount > 0 ? ' ✓' : ''}</button>
                   <button class="dock-btn" id="qr-ov-rescan">${this.escapeHtml(t.rescanBtn)}</button>
                 </div>
               </div>`
            : ''
        }

        <div class="qr-overlay-footer">
          <div class="quick-btns">
            <button class="dock-btn" id="qr-ov-switch-cam" ${!this.streaming ? 'disabled' : ''}>${this.escapeHtml(t.switchCamBtn)}</button>
            <label class="dock-btn file-btn">
              ${this.escapeHtml(t.uploadQrImage)}
              <input id="qr-ov-file" type="file" accept="image/*" hidden />
            </label>
            <button class="dock-btn" id="qr-ov-sim-room">${this.escapeHtml(t.sampleQrRoom)}</button>
          </div>
          <label class="check-label">
            <input id="qr-ov-auto-apply" type="checkbox" ${this.autoApply ? 'checked' : ''} />
            ${this.escapeHtml(t.autoApplyLabel)}
          </label>
        </div>
      </div>
    `;

    // Mount live video & canvas into viewfinder
    const mediaHost = document.getElementById('qr-ov-media-host');
    if (mediaHost) {
      mediaHost.appendChild(this.videoEl);
      mediaHost.appendChild(this.canvasEl);
      cameraVision.attachElements(this.videoEl, this.canvasEl);
    }

    this.bindEvents();
  }

  private bindEvents() {
    if (!this.rootEl) return;

    this.rootEl.onclick = (e) => {
      if (e.target === this.rootEl) {
        this.close();
      }
    };

    const closeBtn = document.getElementById('qr-ov-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.close();
    }

    const allowBtn = document.getElementById('qr-ov-allow-cam');
    if (allowBtn) {
      allowBtn.onclick = () => void this.startCameraScan();
    }

    const switchBtn = document.getElementById('qr-ov-switch-cam');
    if (switchBtn) {
      switchBtn.onclick = async () => {
        const res = await cameraVision.switchCamera();
        this.streaming = res.ok;
        this.permission = res.permission;
        if (!res.ok) this.errorMessage = res.message;
        this.render();
      };
    }

    const rescanBtn = document.getElementById('qr-ov-rescan');
    if (rescanBtn) {
      rescanBtn.onclick = () => {
        this.decodedRoom = null;
        this.decodedRaw = '';
        this.appliedCount = 0;
        cameraVision.resetLastQr();
        this.render();
      };
    }

    const applyBtn = document.getElementById('qr-ov-apply');
    if (applyBtn) {
      applyBtn.onclick = () => this.applyDecodedRoom();
    }

    const autoApplyChk = document.getElementById('qr-ov-auto-apply') as HTMLInputElement | null;
    if (autoApplyChk) {
      autoApplyChk.onchange = () => {
        this.autoApply = autoApplyChk.checked;
      };
    }

    const simRoomBtn = document.getElementById('qr-ov-sim-room');
    if (simRoomBtn) {
      simRoomBtn.onclick = () => {
        const sample = cameraVision.getSampleRoomQrPayload();
        this.handleDecodedPayload(sample, JSON.stringify(sample));
      };
    }

    const fileInput = document.getElementById('qr-ov-file') as HTMLInputElement | null;
    if (fileInput) {
      fileInput.onchange = async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        const res = await cameraVision.decodeQrFromFile(file);
        if (!res.ok) {
          this.errorMessage = res.raw
            ? 'QR detected, but payload is not an AeroLab room-scale config.'
            : 'No readable QR marker detected in uploaded image.';
          this.render();
        }
      };
    }
  }
}
