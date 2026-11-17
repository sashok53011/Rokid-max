import * as xb from 'xrblocks';
import type { User } from 'firebase/auth';
import {
  TRANSLATIONS,
  type SupportedLang,
} from '../i18n/translations.ts';
import {
  SIMULATION_MODULES,
  type BuiltinModuleId,
} from '../modules/SimulationCatalog.ts';
import type {
  SpatialWorkbench,
  WorkbenchStateSnapshot,
} from '../xr/SpatialWorkbench.ts';
import { rokidManager } from '../xr/RokidManager.ts';
import { vrModeManager, type SbsAspectMode, type VrDisplayMode } from '../xr/VrModeManager.ts';
import {
  cameraVision,
  type CameraGestureAction,
  type RecognizedArObject,
} from '../vision/CameraVisionEngine.ts';
import {
  multiplayerClient,
  type PeerInfo,
} from '../services/multiplayerClient.ts';
import {
  voiceChatManager,
  type VoiceStateSnapshot,
} from '../services/voiceChatManager.ts';
import {
  deleteSpatialMapping,
  deleteSpatialRecording,
  flushOfflineQueue,
  saveSpatialMapping,
  signInWithGoogle,
  signOutUser,
  subscribeAnalyticsEvents,
  subscribeAuth,
  subscribeSpatialMappings,
  subscribeSpatialRecordings,
  syncUserProfile,
} from '../services/firebaseClient.ts';
import {
  offlineStore,
  type OfflineAnalyticsItem,
  type SavedSpatialMapping,
  type SpatialRecording,
} from '../services/offlineSync.ts';
import {
  getCachedPlatformCapabilities,
  orientationController,
  wakeLockManager,
  type LandscapeLockStatus,
} from '../utils/platform.ts';
import {
  voiceCommandEngine,
  type VoiceCommandAction,
  type VoiceCommandStateSnapshot,
} from '../audio/VoiceCommandEngine.ts';
import { audioEngine } from '../audio/ProceduralAudio.ts';
import type { RecorderStateSnapshot } from '../xr/SpatialRecorder.ts';
import { QrScannerOverlay } from './QrScannerOverlay.ts';

type DockTab = 'modules' | 'multiplayer' | 'vision' | 'sync' | 'recordings' | 'vr' | 'analytics' | 'rokid';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export class HudController {
  private root: HTMLElement;
  private hudBodyEl: HTMLDivElement;
  private qrOverlayHost: HTMLDivElement;
  private qrScannerOverlay: QrScannerOverlay;
  private workbench: SpatialWorkbench;
  private state: WorkbenchStateSnapshot;
  private activeTab: DockTab | null = 'modules';
  private dockCollapsed = false;
  private currentUser: User | null = null;
  private peers: PeerInfo[] = [];
  private mpConnected = false;
  private voiceState: VoiceStateSnapshot = voiceChatManager.getSnapshot();
  private analyticsItems: OfflineAnalyticsItem[] = offlineStore.getLocalAnalyticsHistory();
  private savedMappings: SavedSpatialMapping[] = offlineStore.getLocalMappings();
  private savedRecordings: SpatialRecording[] = offlineStore.getLocalRecordings();
  private recState: RecorderStateSnapshot;
  private unsubAnalytics?: () => void;
  private unsubMappings?: () => void;
  private unsubRecordings?: () => void;

  // Vision & QR UI state
  private cameraActive = false;
  private cameraStatusText = '';
  private detectedGesture: CameraGestureAction = 'None';
  private detectedObjects: RecognizedArObject[] = [];
  private lastQrSummary = '';
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;

  // PWA install prompt
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
  private isPwaInstalled = false;
  private authErrorText = '';
  private voiceCmdState: VoiceCommandStateSnapshot = voiceCommandEngine.getSnapshot();
  private voiceCmdFeedback = '';
  private voiceCmdFeedbackTimer: number | null = null;
  private landscapeStatus: LandscapeLockStatus = orientationController.getStatus();

  // Form drafts (kept across renders)
  private draftRoomCode = 'LAB-01';
  private draftPeerName = 'Engineer-1';
  private draftMappingName = 'Field Workbench A';
  private draftMappingShared = false;
  private draftRecordingName = '';
  private draftRecordingShared = false;
  private draftNoteText = '';

  constructor(root: HTMLElement, workbench: SpatialWorkbench) {
    this.root = root;
    this.workbench = workbench;
    this.state = workbench.getSnapshot();
    this.recState = workbench.getRecorderSnapshot();

    this.hudBodyEl = document.createElement('div');
    this.qrOverlayHost = document.createElement('div');
    this.root.appendChild(this.hudBodyEl);
    this.root.appendChild(this.qrOverlayHost);

    this.qrScannerOverlay = new QrScannerOverlay(this.qrOverlayHost, {
      getLang: () => this.state.lang,
      isDockCameraActive: () => this.cameraActive,
      onImportRoomScale: (payload) => {
        this.workbench.importQrRoomBounds(payload.bounds);
        this.lastQrSummary = `${payload.name || 'Room'}: ${payload.bounds.width.toFixed(1)}×${payload.bounds.depth.toFixed(1)}×${payload.bounds.height.toFixed(1)}m`;
        this.render();
      },
      onImportModel3d: (name, parts) => {
        this.workbench.importQrModel(name, parts);
        this.lastQrSummary = `3D Model: ${name} (${parts.length} parts)`;
        this.render();
      },
      onStateChange: () => {
        this.render();
      },
    });

    this.setupListeners();
    this.render();
  }

  private setupListeners() {
    this.workbench.onStateChange((snap) => {
      this.state = snap;
      this.render();
    });

    this.workbench.onRecordingSaved((rec) => {
      this.savedRecordings = [rec, ...this.savedRecordings.filter((r) => r.id !== rec.id)];
      this.render();
    });

    this.workbench.recorder.onStateChange((snap) => {
      const modeChanged = snap.mode !== this.recState.mode;
      this.recState = snap;
      if (modeChanged) {
        this.render();
      } else {
        this.updateRecorderDom();
      }
    });

    subscribeAuth((user) => {
      this.currentUser = user;
      if (user) this.authErrorText = '';
      this.unsubAnalytics?.();
      this.unsubMappings?.();
      this.unsubRecordings?.();
      if (user) {
        this.draftPeerName = user.displayName?.split(' ')[0] || this.draftPeerName;
        void syncUserProfile(
          user,
          this.state.lang,
          this.workbench.getActiveDeviceProfile(),
        ).catch(() => {});
        if (user.emailVerified && !offlineStore.isEffectivelyOffline()) {
          void flushOfflineQueue().catch(() => {});
          this.unsubAnalytics = subscribeAnalyticsEvents(user.uid, (events) => {
            this.analyticsItems = events.length > 0 ? events : offlineStore.getLocalAnalyticsHistory();
            this.render();
          });
          this.unsubMappings = subscribeSpatialMappings(user.uid, (maps) => {
            const localOnly = offlineStore.getLocalMappings().filter((m) => !m.syncedToCloud);
            const merged = [...localOnly, ...maps];
            this.savedMappings = merged;
            this.render();
          });
          this.unsubRecordings = subscribeSpatialRecordings(user.uid, (recs) => {
            const localOnly = offlineStore.getLocalRecordings().filter((r) => !r.syncedToCloud);
            const cloudIds = new Set(recs.map((r) => r.id));
            const merged = [...localOnly.filter((r) => !cloudIds.has(r.id)), ...recs];
            this.savedRecordings = merged;
            this.render();
          });
        }
      }
      this.render();
    });

    multiplayerClient.onEvent((ev) => {
      if (ev.type === 'connected') {
        this.mpConnected = true;
        this.peers = ev.room.participants;
      } else if (ev.type === 'disconnected') {
        this.mpConnected = false;
        this.peers = [];
      } else if (ev.type === 'peers' || ev.type === 'voice:state') {
        this.peers = ev.participants;
      }
      this.render();
    });

    voiceChatManager.onStateChange((vs) => {
      this.voiceState = vs;
      this.render();
    });

    voiceChatManager.onLevelUpdate((vs) => {
      this.voiceState = vs;
      this.updateVoiceMeterDom();
    });

    voiceCommandEngine.onStateChange((vcs) => {
      this.voiceCmdState = vcs;
      this.render();
    });

    voiceCommandEngine.onCommand((action, transcript) => {
      this.executeVoiceCommand(action, transcript);
    });

    orientationController.onChange((status) => {
      this.landscapeStatus = status;
      this.render();
    });

    rokidManager.onImuChange(() => {
      this.render();
    });

    cameraVision.setCallbacks({
      onGesture: (g) => {
        if (g !== this.detectedGesture) {
          this.detectedGesture = g;
          this.workbench.triggerCameraGestureAction(g);
          this.render();
        }
      },
      onObjects: (objs) => {
        this.detectedObjects = objs;
        this.updateVisionOverlayDom();
      },
      onQrDecoded: (payload, rawText) => {
        if (this.qrScannerOverlay.isOpen()) {
          this.qrScannerOverlay.handleDecodedPayload(payload, rawText);
          return;
        }
        if (payload.type === 'room_scale') {
          this.workbench.importQrRoomBounds(payload.bounds);
          this.lastQrSummary = `${payload.name || 'Room'}: ${payload.bounds.width}×${payload.bounds.depth}×${payload.bounds.height}m`;
        } else if (payload.type === 'model_3d') {
          this.workbench.importQrModel(payload.name, payload.parts);
          this.lastQrSummary = `3D Model: ${payload.name} (${payload.parts.length} parts)`;
        }
        this.render();
      },
      onStatus: (msg) => {
        this.cameraStatusText = msg;
        this.render();
      },
    });

    window.addEventListener('online', () => {
      if (!offlineStore.isFieldOfflineMode()) {
        void flushOfflineQueue().then(() => this.render()).catch(() => {});
      }
      this.render();
    });
    window.addEventListener('offline', () => this.render());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.qrScannerOverlay.isOpen()) {
        this.qrScannerOverlay.close();
        return;
      }
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyH') {
        this.dockCollapsed = !this.dockCollapsed;
        this.render();
      } else if (e.code === 'KeyM' && this.voiceState.voiceEnabled) {
        voiceChatManager.toggleMute();
      }
    });

    // PWA install events
    this.isPwaInstalled =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e as BeforeInstallPromptEvent;
      this.render();
    });
    window.addEventListener('appinstalled', () => {
      this.isPwaInstalled = true;
      this.deferredInstallPrompt = null;
      this.render();
    });

    // Periodic latency refresh for Rokid diagnostics
    window.setInterval(() => {
      const latEl = document.getElementById('hud-latency-readout');
      if (latEl) {
        const stats = rokidManager.getLatencyStats();
        latEl.textContent = `${stats.frameMs} ms · ${stats.fps} FPS`;
      }
    }, 500);
  }

  private updateVisionOverlayDom() {
    const el = document.getElementById('hud-ar-objects-list');
    if (!el) return;
    if (this.detectedObjects.length === 0) {
      el.textContent = '—';
    } else {
      el.textContent = this.detectedObjects
        .map((o) => `${o.label} (${Math.round(o.score * 100)}%)`)
        .join(', ');
    }
  }

  private updateVoiceMeterDom() {
    const fill = document.getElementById('hud-mic-meter-fill');
    if (fill) {
      const pct = Math.round(this.voiceState.localLevel * 100);
      fill.style.width = `${pct}%`;
    }
  }

  private formatDurationMs(ms: number): string {
    const safe = Math.max(0, ms);
    const totalSec = safe / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = (totalSec % 60).toFixed(1).padStart(4, '0');
    return `${String(mins).padStart(2, '0')}:${secs}`;
  }

  private updateRecorderDom() {
    const r = this.recState;
    const topReadout = document.getElementById('rec-top-time');
    if (topReadout) {
      if (r.mode === 'recording') {
        topReadout.textContent = `${this.formatDurationMs(r.elapsedRecordingMs)} · ${r.recordedFrameCount}f`;
      } else if (r.mode === 'playing' || r.mode === 'paused') {
        topReadout.textContent = `${this.formatDurationMs(r.playheadMs)} / ${this.formatDurationMs(r.durationMs)}`;
      }
    }

    const liveRecCounter = document.getElementById('rec-live-counter');
    if (liveRecCounter && r.mode === 'recording') {
      const t = TRANSLATIONS[this.state.lang].recordings;
      liveRecCounter.textContent = `${this.formatDurationMs(r.elapsedRecordingMs)} · ${r.recordedFrameCount} ${t.framesLabel}`;
    }

    const scrubber = document.getElementById('rec-scrubber') as HTMLInputElement | null;
    if (scrubber && (r.mode === 'playing' || r.mode === 'paused')) {
      scrubber.value = String(r.playheadMs);
    }

    const timeReadout = document.getElementById('rec-time-readout');
    if (timeReadout && (r.mode === 'playing' || r.mode === 'paused')) {
      timeReadout.textContent = `${this.formatDurationMs(r.playheadMs)} / ${this.formatDurationMs(r.durationMs)}`;
    }

    const eventLabel = document.getElementById('rec-active-event');
    if (eventLabel) {
      eventLabel.textContent = r.lastEventLabel || '—';
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  render() {
    const t = TRANSLATIONS[this.state.lang];
    const isOffline = offlineStore.isEffectivelyOffline();
    const pendingCount = offlineStore.getPendingCount();
    const latency = rokidManager.getLatencyStats();
    const xrSupported = xb.core.webXRSessionManager?.isXRSupported();
    const caps = getCachedPlatformCapabilities();
    const imuActive = rokidManager.isImuActive();
    const hasXrTransition = Boolean(xb.core.transition);

    const statusText = offlineStore.isFieldOfflineMode()
      ? t.statusFieldOffline
      : isOffline
        ? t.statusOffline
        : t.statusOnline;

    const statusClass = isOffline ? 'status-badge offline' : 'status-badge online';

    this.hudBodyEl.innerHTML = `
      <header class="top-bar">
        <div class="top-brand">
          <span class="brand-title">${this.escapeHtml(t.appTitle)}</span>
          <span class="brand-sub">${this.escapeHtml(t.appSubtitle)}</span>
        </div>

        <div class="top-actions">
          <span class="${statusClass}">${this.escapeHtml(statusText)}${pendingCount > 0 ? ` (${pendingCount})` : ''}</span>

          ${
            this.recState.mode === 'recording'
              ? `<button class="rec-pill recording" id="rec-top-pill" title="${this.escapeHtml(t.recordings.stopSaveBtn)}">
                   <span class="rec-dot"></span>
                   <span>${this.escapeHtml(t.recordings.recBadge)}</span>
                   <span id="rec-top-time" class="mono-val">${this.formatDurationMs(this.recState.elapsedRecordingMs)} · ${this.recState.recordedFrameCount}f</span>
                 </button>`
              : this.recState.mode === 'playing' || this.recState.mode === 'paused'
                ? `<button class="rec-pill replay" id="rec-top-pill" title="${this.escapeHtml(t.recordings.exitReplayBtn)}">
                     <span>${this.recState.mode === 'playing' ? '▶' : '⏸'} ${this.escapeHtml(t.recordings.replayBadge)}</span>
                     <span id="rec-top-time" class="mono-val">${this.formatDurationMs(this.recState.playheadMs)} / ${this.formatDurationMs(this.recState.durationMs)}</span>
                   </button>`
                : ''
          }

          <div class="lang-group" role="group" aria-label="Language">
            ${(['en', 'ru', 'de'] as SupportedLang[])
              .map(
                (code) =>
                  `<button class="chip-btn ${this.state.lang === code ? 'active' : ''}" data-lang="${code}">${code.toUpperCase()}</button>`,
              )
              .join('')}
          </div>

          <button
            class="chip-btn ${this.voiceCmdState.active ? 'voice-cmd-active' : ''}"
            id="btn-voice-cmd"
            ${!this.voiceCmdState.supported ? 'disabled' : ''}
            title="${this.escapeHtml(t.voiceCmd.listeningHint)}"
          >
            ${this.escapeHtml(
              !this.voiceCmdState.supported
                ? t.voiceCmd.btnUnsupported
                : this.voiceCmdState.active
                  ? t.voiceCmd.btnOn
                  : t.voiceCmd.btnOff,
            )}
          </button>

          ${
            this.mpConnected || this.voiceState.voiceEnabled
              ? `<button class="chip-btn ${this.voiceState.voiceEnabled ? (this.voiceState.muted ? 'warn' : 'accent') : ''}" id="btn-top-voice-quick">${
                  !this.voiceState.voiceEnabled
                    ? this.escapeHtml(t.multiplayer.voiceEnable)
                    : this.voiceState.muted
                      ? this.escapeHtml(t.multiplayer.voiceMuted)
                      : this.escapeHtml(t.multiplayer.voiceReady)
                }</button>`
              : ''
          }

          ${
            !this.isPwaInstalled && this.deferredInstallPrompt
              ? `<button class="chip-btn accent" id="btn-pwa-install">${this.escapeHtml(t.installPwa)}</button>`
              : ''
          }

          <button
            class="chip-btn ${this.qrScannerOverlay.isOpen() ? 'active' : ''}"
            id="btn-open-qr-overlay"
            title="${this.escapeHtml(t.vision.scannerTitle)}"
          >
            ${this.escapeHtml(t.vision.openScannerBtn)}
          </button>

          <button
            class="chip-btn ${this.state.vrMode !== 'off' ? 'vr-active' : ''}"
            id="btn-vr-quick"
            title="${this.escapeHtml(t.vrMode.heading)}"
          >
            ${this.escapeHtml(
              this.state.vrMode === 'horizontal_sbs'
                ? t.vrMode.quickSbs
                : this.state.vrMode === 'monoscopic'
                  ? t.vrMode.quickMono
                  : t.vrMode.quickOff,
            )}
          </button>

          ${
            xrSupported !== false
              ? `<button class="chip-btn primary" id="btn-enter-xr">${this.escapeHtml(caps.preferredXrMode === 'immersive-ar' ? t.enterAr : t.enterXr)}</button>`
              : ''
          }

          ${
            imuActive && !this.landscapeStatus.isPortrait
              ? `<span class="landscape-pill" id="badge-3dof-landscape">${this.escapeHtml(t.actions.landscapeBadge)}</span>`
              : ''
          }

          ${
            this.currentUser
              ? `<button class="chip-btn" id="btn-auth-signout">${this.escapeHtml(this.currentUser.displayName?.split(' ')[0] || t.signedInAs)} · ${this.escapeHtml(t.signOut)}</button>`
              : `<button class="chip-btn accent" id="btn-auth-signin">${this.escapeHtml(t.signInGoogle)}</button>`
          }
          ${this.authErrorText ? `<span class="voice-err">${this.escapeHtml(this.authErrorText)}</span>` : ''}
        </div>
      </header>

      ${
        imuActive && this.landscapeStatus.isPortrait
          ? `<div class="landscape-hint-banner" id="landscape-3dof-banner">
              <span>${this.escapeHtml(t.actions.rotateLandscapeHint)}</span>
              <button class="chip-btn primary" id="btn-lock-landscape">${this.escapeHtml(t.actions.lockLandscapeBtn)}</button>
            </div>`
          : ''
      }

      ${
        this.voiceCmdState.active || this.voiceCmdFeedback || this.voiceCmdState.errorMessage
          ? `<div class="voice-cmd-banner" id="voice-cmd-banner">
              ${this.voiceCmdState.active ? '<span class="voice-pulse-dot" aria-hidden="true"></span>' : ''}
              <span class="voice-cmd-text">${this.escapeHtml(
                this.voiceCmdState.errorMessage
                  ? this.voiceCmdState.errorMessage
                  : this.voiceCmdFeedback
                    ? this.voiceCmdFeedback
                    : this.voiceCmdState.lastTranscript
                      ? `"${this.voiceCmdState.lastTranscript}" · ${t.voiceCmd.listeningHint}`
                      : t.voiceCmd.listeningHint,
              )}</span>
            </div>`
          : ''
      }

      <div class="dock-wrapper ${this.dockCollapsed ? 'collapsed' : ''}">
        <button class="dock-collapse-btn" id="btn-toggle-dock">
          ${this.dockCollapsed ? '▴ ' + this.escapeHtml(t.showControls) : '▾ ' + this.escapeHtml(t.hideControls)}
        </button>

        ${
          !this.dockCollapsed
            ? `
          <div class="bottom-dock">
            ${this.activeTab ? `<div class="dock-drawer">${this.renderDrawerContent()}</div>` : ''}

            <div class="dock-quick-row">
              <div class="slider-wrap">
                <label for="slider-exploded">${this.escapeHtml(t.actions.explodedView)}</label>
                <input id="slider-exploded" type="range" min="0" max="1" step="0.02" value="${this.state.explodedAmount}" />
                <span class="mono-val">${Math.round(this.state.explodedAmount * 100)}%</span>
              </div>

              <div class="quick-btns">
                <button class="dock-btn" id="btn-snap-next">${this.escapeHtml(t.actions.snapAssist)}</button>
                <button class="dock-btn" id="btn-auto-build">${this.escapeHtml(t.actions.autoAssemble)}</button>
                <button class="dock-btn" id="btn-reset-asm">${this.escapeHtml(t.actions.resetAssembly)}</button>
                <button class="dock-btn ${imuActive ? 'primary' : ''}" id="btn-android-gyro">
                  ${this.escapeHtml(imuActive ? t.actions.androidGyroLandscape : t.actions.androidGyro)}
                </button>
                <button class="dock-btn" id="btn-recenter-view">${this.escapeHtml(t.actions.recenterView)}</button>
                ${
                  hasXrTransition
                    ? `<button class="dock-btn" id="btn-ar-bg-toggle">${this.escapeHtml(t.actions.arPassthrough)}</button>`
                    : ''
                }
                <button class="dock-btn ${offlineStore.isFieldOfflineMode() ? 'warn' : ''}" id="btn-field-offline">${this.escapeHtml(t.actions.offlineToggle)}</button>
                ${
                  pendingCount > 0 && !isOffline && this.currentUser
                    ? `<button class="dock-btn primary" id="btn-sync-queue">${this.escapeHtml(t.actions.syncNow)} (${pendingCount})</button>`
                    : ''
                }
              </div>
            </div>

            <nav class="dock-tabs">
              ${(
                [
                  ['modules', t.tabs.modules],
                  ['multiplayer', t.tabs.multiplayer],
                  ['vision', t.tabs.visionQr],
                  ['sync', t.tabs.spatialSync],
                  ['recordings', t.tabs.recordings],
                  ['vr', t.tabs.vrMode],
                  ['analytics', t.tabs.analytics],
                  ['rokid', t.tabs.rokid],
                ] as Array<[DockTab, string]>
              )
                .map(
                  ([key, label]) =>
                    `<button class="tab-btn ${this.activeTab === key ? 'active' : ''}" data-tab="${key}">${this.escapeHtml(label)}</button>`,
                )
                .join('')}
            </nav>

            <div class="dock-footer-meta">
              <span>${this.escapeHtml(t.modules.progressLabel)}: <strong>${this.state.snappedCount}/${this.state.totalParts}</strong></span>
              <span>${this.escapeHtml(t.analytics.accuracy)}: <strong>${this.state.avgAccuracyPct}%</strong></span>
              <span id="hud-latency-readout">${latency.frameMs} ms · ${latency.fps} FPS</span>
              ${this.state.lastSelectedPartLabel ? `<span>Selected: <strong>${this.escapeHtml(this.state.lastSelectedPartLabel)}</strong></span>` : ''}
            </div>
          </div>
        `
            : ''
        }
      </div>
    `;

    this.bindDomEvents();

    // Re-attach video/canvas elements into Vision tab without losing active MediaStream
    if (this.activeTab === 'vision' && !this.dockCollapsed && !this.qrScannerOverlay.isOpen()) {
      const mount = document.getElementById('vision-media-mount');
      if (mount) {
        if (!this.videoEl) {
          this.videoEl = document.createElement('video');
          this.videoEl.playsInline = true;
          this.videoEl.muted = true;
          this.videoEl.style.display = 'none';
        }
        if (!this.canvasEl) {
          this.canvasEl = document.createElement('canvas');
          this.canvasEl.className = 'vision-canvas';
        }
        mount.appendChild(this.videoEl);
        mount.appendChild(this.canvasEl);
        cameraVision.attachElements(this.videoEl, this.canvasEl);
      }
    }

    if (this.qrScannerOverlay.isOpen()) {
      this.qrScannerOverlay.syncLocale();
    }
  }

  private renderDrawerContent(): string {
    const t = TRANSLATIONS[this.state.lang];

    if (this.activeTab === 'modules') {
      const mods: Array<{ id: BuiltinModuleId; title: string; desc: string }> = [
        { id: 'turbine', title: t.modules.turbineTitle, desc: t.modules.turbineDesc },
        { id: 'gearbox', title: t.modules.gearboxTitle, desc: t.modules.gearboxDesc },
        { id: 'robotarm', title: t.modules.robotarmTitle, desc: t.modules.robotarmDesc },
        { id: 'spectrometer', title: t.modules.spectrometerTitle, desc: t.modules.spectrometerDesc },
      ];
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.modules.heading)}</span>
          ${this.state.completed ? `<span class="complete-tag">${this.escapeHtml(t.modules.completedBanner)}</span>` : ''}
        </div>
        <div class="module-grid">
          ${mods
            .map(
              (m) => `
            <button class="module-card ${this.state.moduleId === m.id ? 'active' : ''}" data-module="${m.id}">
              <div class="module-title">${this.escapeHtml(m.title)}</div>
              <div class="module-desc">${this.escapeHtml(m.desc)}</div>
            </button>
          `,
            )
            .join('')}
        </div>
      `;
    }

    if (this.activeTab === 'multiplayer') {
      const vs = this.voiceState;
      const selfId = multiplayerClient.getSelfId();
      const speakingSet = new Set(vs.speakingPeerIds);
      const micPct = Math.round(vs.localLevel * 100);
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.multiplayer.heading)}</span>
          <span class="mono-val">${this.mpConnected ? `Room ${this.escapeHtml(multiplayerClient.getRoomCode() || '')}` : 'Disconnected'}</span>
        </div>
        <div class="form-row">
          <input id="input-room-code" class="hud-input" value="${this.escapeHtml(this.draftRoomCode)}" placeholder="${this.escapeHtml(t.multiplayer.roomCode)}" />
          <input id="input-peer-name" class="hud-input" value="${this.escapeHtml(this.draftPeerName)}" placeholder="${this.escapeHtml(t.multiplayer.displayName)}" />
          ${
            this.mpConnected
              ? `<button class="dock-btn warn" id="btn-mp-leave">${this.escapeHtml(t.multiplayer.leaveRoom)}</button>`
              : `<button class="dock-btn primary" id="btn-mp-join">${this.escapeHtml(t.multiplayer.joinRoom)}</button>`
          }
        </div>
        <div class="voice-bar">
          <button class="dock-btn ${vs.voiceEnabled ? 'warn' : 'primary'}" id="btn-voice-toggle" ${!this.mpConnected ? 'disabled' : ''}>
            ${this.escapeHtml(vs.voiceEnabled ? t.multiplayer.voiceLeave : t.multiplayer.voiceEnable)}
          </button>
          <button class="dock-btn ${vs.muted ? 'warn' : ''}" id="btn-voice-mute" ${!vs.voiceEnabled ? 'disabled' : ''}>
            ${this.escapeHtml(vs.muted ? t.multiplayer.voiceUnmute : t.multiplayer.voiceMute)}
          </button>
          <button class="dock-btn ${vs.deafened ? 'warn' : ''}" id="btn-voice-deafen" ${!this.mpConnected ? 'disabled' : ''}>
            ${this.escapeHtml(vs.deafened ? t.multiplayer.voiceUndeafen : t.multiplayer.voiceDeafen)}
          </button>
          ${
            vs.voiceEnabled
              ? `<div class="mic-meter-wrap" title="Microphone level">
                   <div class="mic-meter-track"><div id="hud-mic-meter-fill" class="mic-meter-fill" style="width:${micPct}%"></div></div>
                   <span class="mono-val">${vs.muted ? this.escapeHtml(t.multiplayer.voiceMuted) : vs.localSpeaking ? this.escapeHtml(t.multiplayer.voiceSpeaking) : this.escapeHtml(t.multiplayer.voiceReady)}${vs.spatialPeerCount > 0 ? ` · 3D HRTF (${vs.spatialPeerCount})` : ''}</span>
                 </div>`
              : `<span class="muted">${this.escapeHtml(this.mpConnected ? t.multiplayer.voiceOff : t.multiplayer.voiceJoinRoomHint)}</span>`
          }
          ${vs.errorMessage ? `<span class="voice-err">${this.escapeHtml(vs.errorMessage)}</span>` : ''}
        </div>
        <div class="form-row">
          <input id="input-pin-note" class="hud-input" value="${this.escapeHtml(this.draftNoteText)}" placeholder="${this.escapeHtml(t.multiplayer.pinNotePlaceholder)}" />
          <button class="dock-btn" id="btn-pin-note" ${!this.mpConnected ? 'disabled' : ''}>${this.escapeHtml(t.multiplayer.pinNoteBtn)}</button>
        </div>
        <div class="peers-row">
          <span>${this.escapeHtml(t.multiplayer.connectedPeers)} (${this.peers.length}):</span>
          ${
            this.peers.length > 0
              ? this.peers
                  .map((p) => {
                    const isSelf = p.id === selfId;
                    const isSpeaking = isSelf ? vs.localSpeaking : speakingSet.has(p.id);
                    const voiceTag = !p.voiceEnabled
                      ? t.multiplayer.voiceOff
                      : p.muted
                        ? t.multiplayer.voiceMuted
                        : isSpeaking
                          ? t.multiplayer.voiceSpeaking
                          : t.multiplayer.voiceReady;
                    return `<span class="peer-tag ${isSpeaking ? 'speaking' : ''}" style="border-color:${this.escapeHtml(p.color)}">${this.escapeHtml(p.name)} (${this.escapeHtml(p.deviceProfile)}) · ${this.escapeHtml(voiceTag)}</span>`;
                  })
                  .join('')
              : `<span class="muted">${this.escapeHtml(t.multiplayer.disconnectedHint)}</span>`
          }
        </div>
      `;
    }

    if (this.activeTab === 'vision') {
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.vision.heading)}</span>
          <span class="mono-val">${this.escapeHtml(this.cameraStatusText || t.vision.roomBoundsActive + ': ' + this.state.roomBounds.width.toFixed(1) + '×' + this.state.roomBounds.depth.toFixed(1) + 'm')}</span>
        </div>
        <div class="vision-layout">
          <div class="vision-preview-box" id="vision-media-mount">
            ${!this.cameraActive ? `<div class="vision-placeholder">${this.escapeHtml(t.vision.noCameraFallback)}</div>` : ''}
          </div>
          <div class="vision-controls">
            <div class="form-row">
              <button class="dock-btn primary" id="btn-vision-open-overlay">
                ${this.escapeHtml(t.vision.openScannerBtn)}
              </button>
              <button class="dock-btn ${this.cameraActive ? 'warn' : ''}" id="btn-cam-toggle">
                ${this.escapeHtml(this.cameraActive ? t.vision.stopCamera : t.vision.startCamera)}
              </button>
              <label class="dock-btn file-btn">
                ${this.escapeHtml(t.vision.uploadQrImage)}
                <input id="input-qr-file" type="file" accept="image/*" hidden />
              </label>
            </div>
            <div class="form-row">
              <button class="dock-btn" id="btn-sample-qr-room">${this.escapeHtml(t.vision.sampleQrRoom)}</button>
              <button class="dock-btn" id="btn-sample-qr-model">${this.escapeHtml(t.vision.sampleQrModel)}</button>
            </div>
            <div class="vision-readouts">
              <div><strong>${this.escapeHtml(t.vision.gestureLabel)}:</strong> ${this.escapeHtml(this.detectedGesture)}</div>
              <div><strong>${this.escapeHtml(t.vision.detectedObjects)}:</strong> <span id="hud-ar-objects-list">${this.detectedObjects.length > 0 ? this.detectedObjects.map((o) => o.label).join(', ') : '—'}</span></div>
              ${this.lastQrSummary ? `<div><strong>QR:</strong> ${this.escapeHtml(this.lastQrSummary)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    }

    if (this.activeTab === 'sync') {
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.spatialSync.heading)}</span>
          <span class="muted">${this.escapeHtml(t.spatialSync.signInRequired)}</span>
        </div>
        <div class="form-row">
          <input id="input-mapping-name" class="hud-input" value="${this.escapeHtml(this.draftMappingName)}" placeholder="${this.escapeHtml(t.spatialSync.mappingNamePlaceholder)}" />
          <label class="check-label">
            <input id="check-mapping-shared" type="checkbox" ${this.draftMappingShared ? 'checked' : ''} />
            ${this.escapeHtml(t.spatialSync.shareToggle)}
          </label>
          <button class="dock-btn primary" id="btn-save-mapping">${this.escapeHtml(t.spatialSync.saveMapping)}</button>
        </div>
        <div class="mapping-list">
          ${
            this.savedMappings.length === 0
              ? `<div class="muted">${this.escapeHtml(t.spatialSync.savedMappings)}: 0</div>`
              : this.savedMappings
                  .slice(0, 6)
                  .map(
                    (m) => `
                  <div class="mapping-item">
                    <div>
                      <strong>${this.escapeHtml(m.name)}</strong>
                      <span class="muted"> · ${this.escapeHtml(m.moduleId)} · ${m.roomBounds.width.toFixed(1)}×${m.roomBounds.depth.toFixed(1)}m · ${m.syncedToCloud ? 'Cloud' : 'Local Queue'}</span>
                    </div>
                    <div class="quick-btns">
                      <button class="chip-btn" data-load-map="${this.escapeHtml(m.id)}">${this.escapeHtml(t.spatialSync.loadMapping)}</button>
                      <button class="chip-btn" data-del-map="${this.escapeHtml(m.id)}">${this.escapeHtml(t.spatialSync.deleteMapping)}</button>
                    </div>
                  </div>
                `,
                  )
                  .join('')
          }
        </div>
      `;
    }

    if (this.activeTab === 'recordings') {
      const r = this.recState;
      const isRec = r.mode === 'recording';
      const isReplay = r.mode === 'playing' || r.mode === 'paused';
      const maxDur = Math.max(100, r.durationMs);
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.recordings.heading)}</span>
          <span id="rec-live-counter" class="mono-val">
            ${
              isRec
                ? `${this.formatDurationMs(r.elapsedRecordingMs)} · ${r.recordedFrameCount} ${this.escapeHtml(t.recordings.framesLabel)}`
                : isReplay
                  ? this.escapeHtml(r.activeRecordingName)
                  : `${this.savedRecordings.length}`
            }
          </span>
        </div>
        <div class="form-row">
          <input id="input-rec-name" class="hud-input" value="${this.escapeHtml(this.draftRecordingName)}" placeholder="${this.escapeHtml(t.recordings.namePlaceholder)}" />
          <label class="check-label">
            <input id="check-rec-shared" type="checkbox" ${this.draftRecordingShared ? 'checked' : ''} />
            ${this.escapeHtml(t.recordings.shareToggle)}
          </label>
          <button class="dock-btn ${isRec ? 'warn' : 'primary'}" id="btn-rec-toggle">
            ${this.escapeHtml(isRec ? t.recordings.stopSaveBtn : t.recordings.startBtn)}
          </button>
        </div>

        ${
          isReplay
            ? `
          <div class="playback-deck">
            <div class="playback-controls-row">
              <button class="dock-btn primary" id="btn-replay-playpause">
                ${r.mode === 'playing' ? '⏸ ' + this.escapeHtml(t.recordings.pauseBtn) : '▶ ' + this.escapeHtml(t.recordings.playBtn)}
              </button>
              <button class="dock-btn" id="btn-replay-prev">${this.escapeHtml(t.recordings.stepPrevBtn)}</button>
              <button class="dock-btn" id="btn-replay-next">${this.escapeHtml(t.recordings.stepNextBtn)}</button>
              <div class="speed-pills" aria-label="${this.escapeHtml(t.recordings.speedLabel)}">
                ${[0.5, 1, 1.5, 2]
                  .map(
                    (spd) =>
                      `<button class="chip-btn ${Math.abs(r.speed - spd) < 0.05 ? 'active' : ''}" data-replay-speed="${spd}">${spd}×</button>`,
                  )
                  .join('')}
              </div>
              <button class="dock-btn warn" id="btn-replay-exit">${this.escapeHtml(t.recordings.exitReplayBtn)}</button>
            </div>

            <div class="playback-scrubber-row">
              <span class="muted">${this.escapeHtml(t.recordings.timelineLabel)}</span>
              <input id="rec-scrubber" type="range" min="0" max="${maxDur}" step="25" value="${Math.min(maxDur, r.playheadMs)}" />
              <span id="rec-time-readout" class="mono-val">${this.formatDurationMs(r.playheadMs)} / ${this.formatDurationMs(r.durationMs)}</span>
            </div>

            <div class="playback-events-row">
              <span class="muted">${this.escapeHtml(t.recordings.stepsTimeline)}:</span>
              <span id="rec-active-event" class="mono-val">${this.escapeHtml(r.lastEventLabel || '—')}</span>
              <div class="events-strip">
                ${r.events
                  .filter((ev) => ev.type !== 'exploded')
                  .slice(0, 14)
                  .map(
                    (ev) =>
                      `<button class="event-chip event-${this.escapeHtml(ev.type)}" data-seek-ms="${ev.t}" title="${this.escapeHtml(ev.partLabel)}">
                        ${this.formatDurationMs(ev.t)} · ${this.escapeHtml(ev.type)}${ev.type === 'snap' ? ` ${Math.round(ev.accuracyPct)}%` : ''}
                      </button>`,
                  )
                  .join('')}
              </div>
            </div>
          </div>
        `
            : ''
        }

        <div class="mapping-list">
          ${
            this.savedRecordings.length === 0
              ? `<div class="muted">${this.escapeHtml(t.recordings.empty)}</div>`
              : this.savedRecordings
                  .slice(0, 8)
                  .map(
                    (rec) => `
                  <div class="mapping-item ${r.activeRecordingId === rec.id ? 'active-replay' : ''}">
                    <div>
                      <strong>${this.escapeHtml(rec.name)}</strong>
                      <span class="muted"> · ${this.escapeHtml(rec.moduleId)} · ${this.formatDurationMs(rec.durationMs)} · ${rec.snapCount} ${this.escapeHtml(t.recordings.snapsLabel)} · ${rec.avgAccuracyPct}% · ${rec.syncedToCloud ? 'Cloud' : 'Local Queue'}</span>
                    </div>
                    <div class="quick-btns">
                      <button class="chip-btn primary" data-play-rec="${this.escapeHtml(rec.id)}">${this.escapeHtml(t.recordings.replayItemBtn)}</button>
                      <button class="chip-btn" data-del-rec="${this.escapeHtml(rec.id)}">${this.escapeHtml(t.recordings.deleteBtn)}</button>
                    </div>
                  </div>
                `,
                  )
                  .join('')
          }
        </div>
      `;
    }

    if (this.activeTab === 'analytics') {
      const snaps = this.analyticsItems.filter((e) => e.actionType === 'part_snapped');
      const avgAcc =
        snaps.length > 0
          ? (snaps.reduce((s, e) => s + e.accuracyPct, 0) / snaps.length).toFixed(1)
          : String(this.state.avgAccuracyPct);
      const avgSec =
        snaps.length > 0
          ? (snaps.reduce((s, e) => s + e.durationMs, 0) / snaps.length / 1000).toFixed(1)
          : '0.0';
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.analytics.heading)}</span>
          <span class="mono-val">${this.currentUser ? this.escapeHtml(t.analytics.realtimeCloud) : 'Local Telemetry'}</span>
        </div>
        <div class="stats-grid">
          <div class="stat-box"><div class="stat-val">${avgAcc}%</div><div class="stat-lbl">${this.escapeHtml(t.analytics.accuracy)}</div></div>
          <div class="stat-box"><div class="stat-val">${avgSec}s</div><div class="stat-lbl">${this.escapeHtml(t.analytics.avgDuration)}</div></div>
          <div class="stat-box"><div class="stat-val">${snaps.length}</div><div class="stat-lbl">${this.escapeHtml(t.analytics.snappedParts)}</div></div>
          <div class="stat-box"><div class="stat-val">${this.state.collisions}</div><div class="stat-lbl">${this.escapeHtml(t.analytics.collisions)}</div></div>
        </div>
        <div class="events-strip">
          ${this.analyticsItems
            .slice(0, 4)
            .map(
              (ev) =>
                `<span class="event-tag">${this.escapeHtml(ev.moduleId)} · ${this.escapeHtml(ev.actionType)} · ${ev.accuracyPct}%</span>`,
            )
            .join('')}
        </div>
      `;
    }

    if (this.activeTab === 'vr') {
      const vs = vrModeManager.settings;
      const lat = rokidManager.getLatencyStats();
      const imuActive = rokidManager.isImuActive();
      const modes: Array<{ id: VrDisplayMode; title: string; desc: string }> = [
        { id: 'off', title: t.vrMode.modeOff, desc: t.vrMode.modeOffDesc },
        { id: 'horizontal_sbs', title: t.vrMode.modeSbs, desc: t.vrMode.modeSbsDesc },
        { id: 'monoscopic', title: t.vrMode.modeMono, desc: t.vrMode.modeMonoDesc },
      ];
      return `
        <div class="drawer-header">
          <span>${this.escapeHtml(t.vrMode.heading)}</span>
          <span class="mono-val">${lat.frameMs} ms · ${lat.fps} FPS</span>
        </div>
        <div class="muted" style="margin-bottom:8px;">${this.escapeHtml(t.vrMode.subtitle)}</div>
        <div class="vr-mode-grid">
          ${modes
            .map(
              (m) => `
            <button class="module-card vr-mode-card ${vs.mode === m.id ? 'active' : ''}" data-vr-mode="${m.id}">
              <div class="module-title">${this.escapeHtml(m.title)}</div>
              <div class="module-desc">${this.escapeHtml(m.desc)}</div>
            </button>
          `,
            )
            .join('')}
        </div>
        <div class="form-row" style="margin-top:8px;">
          <span class="muted">${this.escapeHtml(t.vrMode.aspectLabel)}:</span>
          <button class="chip-btn ${vs.sbsAspectMode === 'full' ? 'active' : ''}" data-sbs-aspect="full">${this.escapeHtml(t.vrMode.aspectFull)}</button>
          <button class="chip-btn ${vs.sbsAspectMode === 'half' ? 'active' : ''}" data-sbs-aspect="half">${this.escapeHtml(t.vrMode.aspectHalf)}</button>
          <label class="check-label">
            <input id="check-vr-divider" type="checkbox" ${vs.centerDivider ? 'checked' : ''} />
            ${this.escapeHtml(t.vrMode.dividerLabel)}
          </label>
          <label class="check-label">
            <input id="check-vr-imu" type="checkbox" ${imuActive ? 'checked' : ''} />
            ${this.escapeHtml(t.vrMode.imuLabel)}
          </label>
          <label class="check-label">
            <input id="check-vr-vignette" type="checkbox" ${vs.comfortVignette ? 'checked' : ''} />
            ${this.escapeHtml(t.vrMode.vignetteLabel)}
          </label>
        </div>
        <div class="form-row">
          <div class="slider-wrap">
            <label for="slider-vr-fov">${this.escapeHtml(t.vrMode.fovLabel)}</label>
            <input id="slider-vr-fov" type="range" min="55" max="110" step="1" value="${vs.fovDegrees}" />
            <span class="mono-val">${vs.fovDegrees}°</span>
          </div>
          <div class="slider-wrap">
            <label for="slider-vr-ipd">${this.escapeHtml(t.vrMode.ipdLabel)}</label>
            <input id="slider-vr-ipd" type="range" min="50" max="76" step="1" value="${vs.ipdMm}" />
            <span class="mono-val">${vs.ipdMm} mm</span>
          </div>
        </div>
      `;
    }

    // Rokid Max AR Glasses (1st Gen) & Low-Latency Comfort Tab
    const rs = rokidManager.settings;
    const lat = rokidManager.getLatencyStats();
    return `
      <div class="drawer-header">
        <span>${this.escapeHtml(t.rokid.heading)}</span>
        <span class="mono-val">${this.escapeHtml(t.rokid.latencyLabel)}: ${lat.frameMs} ms (${lat.fps} Hz)</span>
      </div>
      <div class="muted" style="margin-bottom:8px;">${this.escapeHtml(t.rokid.presetLabel)}</div>
      <div class="form-row">
        <button class="dock-btn ${rs.enabled ? 'warn' : 'primary'}" id="btn-rokid-toggle">
          ${this.escapeHtml(rs.enabled ? t.rokid.disableRokid : t.rokid.enableRokid)}
        </button>
        <label class="check-label">
          <input id="check-rokid-sbs" type="checkbox" ${rs.sbsStereo ? 'checked' : ''} />
          ${this.escapeHtml(t.rokid.sbsStereo)}
        </label>
        <label class="check-label">
          <input id="check-rokid-seethrough" type="checkbox" ${rs.opticalSeeThrough ? 'checked' : ''} />
          ${this.escapeHtml(t.rokid.opticalSeeThrough)}
        </label>
        <label class="check-label">
          <input id="check-rokid-imu" type="checkbox" ${rs.imuHeadTracking ? 'checked' : ''} />
          ${this.escapeHtml(t.rokid.imuTracking)}
        </label>
        <label class="check-label">
          <input id="check-rokid-vignette" type="checkbox" ${rs.comfortVignette ? 'checked' : ''} />
          ${this.escapeHtml(t.rokid.comfortVignette)}
        </label>
      </div>
      <div class="form-row">
        <div class="slider-wrap">
          <label for="slider-rokid-fov">${this.escapeHtml(t.rokid.fovLabel)}</label>
          <input id="slider-rokid-fov" type="range" min="35" max="90" step="1" value="${rs.fovDegrees}" />
          <span class="mono-val">${rs.fovDegrees}°</span>
        </div>
        <div class="slider-wrap">
          <label for="slider-rokid-ipd">${this.escapeHtml(t.rokid.ipdLabel)}</label>
          <input id="slider-rokid-ipd" type="range" min="54" max="74" step="1" value="${rs.ipdMm}" />
          <span class="mono-val">${rs.ipdMm} mm</span>
        </div>
      </div>
    `;
  }

  private bindDomEvents() {
    this.root.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((btn) => {
      btn.onclick = () => {
        const lang = btn.dataset.lang as SupportedLang;
        this.workbench.setLanguage(lang);
      };
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.onclick = () => {
        const tab = btn.dataset.tab as DockTab;
        this.activeTab = this.activeTab === tab ? null : tab;
        this.render();
      };
    });

    const toggleDock = document.getElementById('btn-toggle-dock');
    if (toggleDock) {
      toggleDock.onclick = () => {
        this.dockCollapsed = !this.dockCollapsed;
        this.render();
      };
    }

    const voiceCmdBtn = document.getElementById('btn-voice-cmd');
    if (voiceCmdBtn) {
      voiceCmdBtn.onclick = () => {
        const started = voiceCommandEngine.toggle();
        if (started) {
          void wakeLockManager.enable();
        }
      };
    }

    const pwaBtn = document.getElementById('btn-pwa-install');
    if (pwaBtn) {
      pwaBtn.onclick = async () => {
        if (!this.deferredInstallPrompt) return;
        await this.deferredInstallPrompt.prompt();
        await this.deferredInstallPrompt.userChoice;
        this.deferredInstallPrompt = null;
        this.render();
      };
    }

    const xrBtn = document.getElementById('btn-enter-xr');
    if (xrBtn) {
      xrBtn.onclick = () => {
        void wakeLockManager.enable();
        xb.core.webXRSessionManager?.startSession();
      };
    }

    const signInBtn = document.getElementById('btn-auth-signin');
    if (signInBtn) {
      signInBtn.onclick = () => {
        this.authErrorText = '';
        void signInWithGoogle().catch((e) => {
          const msg = e instanceof Error ? e.message : 'Sign-in blocked';
          this.authErrorText = /popup/i.test(msg)
            ? 'Popup blocked — allow popups in Android Chrome to sign in'
            : msg;
          this.render();
        });
      };
    }

    const signOutBtn = document.getElementById('btn-auth-signout');
    if (signOutBtn) {
      signOutBtn.onclick = () => void signOutUser().catch((e) => console.error(e));
    }

    const expSlider = document.getElementById('slider-exploded') as HTMLInputElement | null;
    if (expSlider) {
      expSlider.oninput = () => {
        this.workbench.setExplodedAmount(parseFloat(expSlider.value), true);
      };
    }

    const snapBtn = document.getElementById('btn-snap-next');
    if (snapBtn) {
      snapBtn.onclick = () => {
        audioEngine.resume();
        this.workbench.snapNextPart();
      };
    }

    const autoBtn = document.getElementById('btn-auto-build');
    if (autoBtn) {
      autoBtn.onclick = () => {
        audioEngine.resume();
        this.workbench.autoAssembleAll();
      };
    }

    const resetBtn = document.getElementById('btn-reset-asm');
    if (resetBtn) {
      resetBtn.onclick = () => {
        audioEngine.resume();
        this.workbench.resetAssembly(true);
      };
    }

    const gyroBtn = document.getElementById('btn-android-gyro');
    if (gyroBtn) {
      gyroBtn.onclick = async () => {
        const next = !rokidManager.isImuActive();
        const ok = await rokidManager.enableImuTracking(next);
        if (ok) void wakeLockManager.enable();
        this.render();
      };
    }

    const lockLandscapeBtn = document.getElementById('btn-lock-landscape');
    if (lockLandscapeBtn) {
      lockLandscapeBtn.onclick = () => {
        void wakeLockManager.enable();
        void rokidManager.requestLandscapeLock().then(() => this.render());
      };
    }

    const recenterBtn = document.getElementById('btn-recenter-view');
    if (recenterBtn) {
      recenterBtn.onclick = () => this.workbench.recenterCameraView();
    }

    const arBgBtn = document.getElementById('btn-ar-bg-toggle');
    if (arBgBtn) {
      arBgBtn.onclick = () => this.workbench.toggleXrPassthrough();
    }

    const offlineBtn = document.getElementById('btn-field-offline');
    if (offlineBtn) {
      offlineBtn.onclick = () => {
        const next = !offlineStore.isFieldOfflineMode();
        offlineStore.setFieldOfflineMode(next);
        if (!next && this.currentUser) {
          void flushOfflineQueue().then(() => this.render()).catch(() => {});
        }
        this.render();
      };
    }

    const syncQueueBtn = document.getElementById('btn-sync-queue');
    if (syncQueueBtn) {
      syncQueueBtn.onclick = () => {
        void flushOfflineQueue().then(() => this.render()).catch(() => {});
      };
    }

    // Module cards
    this.root.querySelectorAll<HTMLButtonElement>('[data-module]').forEach((btn) => {
      btn.onclick = () => {
        const modId = btn.dataset.module as BuiltinModuleId;
        if (modId in SIMULATION_MODULES) {
          this.workbench.switchModule(modId, true);
        }
      };
    });

    // Multiplayer controls
    const roomInput = document.getElementById('input-room-code') as HTMLInputElement | null;
    if (roomInput) roomInput.oninput = () => (this.draftRoomCode = roomInput.value);
    const nameInput = document.getElementById('input-peer-name') as HTMLInputElement | null;
    if (nameInput) nameInput.oninput = () => (this.draftPeerName = nameInput.value);
    const noteInput = document.getElementById('input-pin-note') as HTMLInputElement | null;
    if (noteInput) noteInput.oninput = () => (this.draftNoteText = noteInput.value);

    const joinBtn = document.getElementById('btn-mp-join');
    if (joinBtn) {
      joinBtn.onclick = () => {
        multiplayerClient.connect(
          this.draftRoomCode,
          this.draftPeerName,
          this.workbench.getActiveDeviceProfile(),
          this.state.moduleId,
        );
      };
    }
    const leaveBtn = document.getElementById('btn-mp-leave');
    if (leaveBtn) {
      leaveBtn.onclick = () => {
        if (this.voiceState.voiceEnabled) voiceChatManager.disableVoice();
        multiplayerClient.disconnect();
      };
    }

    const topVoiceBtn = document.getElementById('btn-top-voice-quick');
    if (topVoiceBtn) {
      topVoiceBtn.onclick = () => {
        audioEngine.resume();
        if (!this.voiceState.voiceEnabled) {
          void wakeLockManager.enable();
          void voiceChatManager.enableVoice();
        } else {
          voiceChatManager.toggleMute();
        }
      };
    }

    const voiceToggleBtn = document.getElementById('btn-voice-toggle');
    if (voiceToggleBtn) {
      voiceToggleBtn.onclick = () => {
        audioEngine.resume();
        if (this.voiceState.voiceEnabled) {
          voiceChatManager.disableVoice();
        } else {
          void wakeLockManager.enable();
          void voiceChatManager.enableVoice();
        }
      };
    }

    const voiceMuteBtn = document.getElementById('btn-voice-mute');
    if (voiceMuteBtn) {
      voiceMuteBtn.onclick = () => {
        voiceChatManager.toggleMute();
      };
    }

    const voiceDeafenBtn = document.getElementById('btn-voice-deafen');
    if (voiceDeafenBtn) {
      voiceDeafenBtn.onclick = () => {
        audioEngine.resume();
        voiceChatManager.toggleDeafen();
      };
    }

    const pinNoteBtn = document.getElementById('btn-pin-note');
    if (pinNoteBtn) {
      pinNoteBtn.onclick = () => {
        if (this.draftNoteText.trim()) {
          this.workbench.addLocalAnnotation(this.draftNoteText);
          this.draftNoteText = '';
          this.render();
        }
      };
    }

    // Vision & QR controls
    const openQrTopBtn = document.getElementById('btn-open-qr-overlay');
    if (openQrTopBtn) {
      openQrTopBtn.onclick = () => {
        if (this.qrScannerOverlay.isOpen()) {
          this.qrScannerOverlay.close();
        } else {
          void this.qrScannerOverlay.open();
        }
      };
    }

    const openQrVisionBtn = document.getElementById('btn-vision-open-overlay');
    if (openQrVisionBtn) {
      openQrVisionBtn.onclick = () => {
        void this.qrScannerOverlay.open();
      };
    }

    const camBtn = document.getElementById('btn-cam-toggle');
    if (camBtn) {
      camBtn.onclick = async () => {
        if (this.cameraActive) {
          cameraVision.stop();
          this.cameraActive = false;
          this.render();
        } else {
          void wakeLockManager.enable();
          const res = await cameraVision.start({ qrOnly: false });
          this.cameraActive = res.ok;
          this.cameraStatusText = res.message;
          this.render();
        }
      };
    }

    const qrFile = document.getElementById('input-qr-file') as HTMLInputElement | null;
    if (qrFile) {
      qrFile.onchange = async () => {
        const f = qrFile.files?.[0];
        if (!f) return;
        const res = await cameraVision.decodeQrFromFile(f);
        if (!res.ok) {
          this.lastQrSummary = 'No valid AeroLab QR payload detected in image.';
          this.render();
        }
      };
    }

    const sampleRoomBtn = document.getElementById('btn-sample-qr-room');
    if (sampleRoomBtn) {
      sampleRoomBtn.onclick = () => {
        const sample = cameraVision.getSampleRoomQrPayload();
        this.workbench.importQrRoomBounds(sample.bounds);
        this.lastQrSummary = `${sample.name}: ${sample.bounds.width}×${sample.bounds.depth}×${sample.bounds.height}m`;
        this.render();
      };
    }

    const sampleModelBtn = document.getElementById('btn-sample-qr-model');
    if (sampleModelBtn) {
      sampleModelBtn.onclick = () => {
        const sample = cameraVision.getSampleModelQrPayload();
        this.workbench.importQrModel(sample.name, sample.parts);
        this.lastQrSummary = `3D Model: ${sample.name} (${sample.parts.length} parts)`;
        this.render();
      };
    }

    // Spatial Mapping Cloud Sync controls
    const mapName = document.getElementById('input-mapping-name') as HTMLInputElement | null;
    if (mapName) mapName.oninput = () => (this.draftMappingName = mapName.value);
    const mapShared = document.getElementById('check-mapping-shared') as HTMLInputElement | null;
    if (mapShared) mapShared.onchange = () => (this.draftMappingShared = mapShared.checked);

    const saveMapBtn = document.getElementById('btn-save-mapping');
    if (saveMapBtn) {
      saveMapBtn.onclick = async () => {
        const saved = await saveSpatialMapping({
          name: this.draftMappingName,
          moduleId: this.state.moduleId,
          roomBounds: this.state.roomBounds,
          partTransforms: this.workbench.exportCurrentTransforms(),
          rokidProfile: {
            fov: rokidManager.settings.fovDegrees,
            ipdMm: rokidManager.settings.ipdMm,
            sbsMode: rokidManager.settings.sbsStereo,
            additiveDimming: 0.15,
          },
          isShared: this.draftMappingShared,
        });
        this.savedMappings = [saved, ...this.savedMappings.filter((m) => m.id !== saved.id)];
        this.render();
      };
    }

    this.root.querySelectorAll<HTMLButtonElement>('[data-load-map]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.loadMap;
        const found = this.savedMappings.find((m) => m.id === id);
        if (found) this.workbench.applySavedMapping(found);
      };
    });

    this.root.querySelectorAll<HTMLButtonElement>('[data-del-map]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delMap;
        if (!id) return;
        await deleteSpatialMapping(id).catch(() => {});
        this.savedMappings = this.savedMappings.filter((m) => m.id !== id);
        this.render();
      };
    });

    const topRecPill = document.getElementById('rec-top-pill');
    if (topRecPill) {
      topRecPill.onclick = () => {
        if (this.recState.mode === 'recording') {
          void this.workbench.stopAndSaveSpatialRecording(
            this.draftRecordingName,
            this.draftRecordingShared,
          );
        } else {
          this.workbench.exitPlayback();
        }
      };
    }

    // Spatial Recording & Training Replay controls
    const recNameInput = document.getElementById('input-rec-name') as HTMLInputElement | null;
    if (recNameInput) recNameInput.oninput = () => (this.draftRecordingName = recNameInput.value);
    const recSharedChk = document.getElementById('check-rec-shared') as HTMLInputElement | null;
    if (recSharedChk) recSharedChk.onchange = () => (this.draftRecordingShared = recSharedChk.checked);

    const recToggleBtn = document.getElementById('btn-rec-toggle');
    if (recToggleBtn) {
      recToggleBtn.onclick = () => {
        void this.workbench.toggleRecording(this.draftRecordingName, this.draftRecordingShared);
      };
    }

    const replayPlayPauseBtn = document.getElementById('btn-replay-playpause');
    if (replayPlayPauseBtn) {
      replayPlayPauseBtn.onclick = () => this.workbench.togglePlaybackPause();
    }
    const replayPrevBtn = document.getElementById('btn-replay-prev');
    if (replayPrevBtn) {
      replayPrevBtn.onclick = () => this.workbench.stepPlaybackEvent(-1);
    }
    const replayNextBtn = document.getElementById('btn-replay-next');
    if (replayNextBtn) {
      replayNextBtn.onclick = () => this.workbench.stepPlaybackEvent(1);
    }
    const replayExitBtn = document.getElementById('btn-replay-exit');
    if (replayExitBtn) {
      replayExitBtn.onclick = () => this.workbench.exitPlayback();
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-replay-speed]').forEach((btn) => {
      btn.onclick = () => {
        const spd = Number(btn.dataset.replaySpeed || 1);
        this.workbench.setPlaybackSpeed(spd);
      };
    });
    const recScrubber = document.getElementById('rec-scrubber') as HTMLInputElement | null;
    if (recScrubber) {
      recScrubber.oninput = () => {
        this.workbench.seekPlayback(Number(recScrubber.value));
      };
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-seek-ms]').forEach((btn) => {
      btn.onclick = () => {
        const ms = Number(btn.dataset.seekMs || 0);
        this.workbench.seekPlayback(ms);
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-play-rec]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.playRec;
        const found = this.savedRecordings.find((r) => r.id === id);
        if (found) this.workbench.playRecording(found);
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-del-rec]').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.delRec;
        if (!id) return;
        if (this.recState.activeRecordingId === id) {
          this.workbench.exitPlayback();
        }
        await deleteSpatialRecording(id).catch(() => {});
        this.savedRecordings = this.savedRecordings.filter((r) => r.id !== id);
        this.render();
      };
    });

    // Rokid Max AR Glasses controls
    const rokidBtn = document.getElementById('btn-rokid-toggle');
    if (rokidBtn) {
      rokidBtn.onclick = () => this.workbench.toggleRokidMode();
    }
    const sbsChk = document.getElementById('check-rokid-sbs') as HTMLInputElement | null;
    if (sbsChk) sbsChk.onchange = () => rokidManager.updateSettings({ sbsStereo: sbsChk.checked });

    const seeThruChk = document.getElementById('check-rokid-seethrough') as HTMLInputElement | null;
    if (seeThruChk) {
      seeThruChk.onchange = () =>
        rokidManager.updateSettings({ opticalSeeThrough: seeThruChk.checked });
    }
    const imuChk = document.getElementById('check-rokid-imu') as HTMLInputElement | null;
    if (imuChk) {
      imuChk.onchange = () => {
        void rokidManager.enableImuTracking(imuChk.checked).then((ok) => {
          if (ok) void wakeLockManager.enable();
          this.render();
        });
      };
    }
    const vigChk = document.getElementById('check-rokid-vignette') as HTMLInputElement | null;
    if (vigChk) {
      vigChk.onchange = () => rokidManager.updateSettings({ comfortVignette: vigChk.checked });
    }
    const fovSlider = document.getElementById('slider-rokid-fov') as HTMLInputElement | null;
    if (fovSlider) {
      fovSlider.oninput = () => {
        rokidManager.updateSettings({ fovDegrees: Number(fovSlider.value) });
        const span = fovSlider.nextElementSibling;
        if (span) span.textContent = `${fovSlider.value}°`;
      };
    }
    const ipdSlider = document.getElementById('slider-rokid-ipd') as HTMLInputElement | null;
    if (ipdSlider) {
      ipdSlider.oninput = () => {
        rokidManager.updateSettings({ ipdMm: Number(ipdSlider.value) });
        const span = ipdSlider.nextElementSibling;
        if (span) span.textContent = `${ipdSlider.value} mm`;
      };
    }

    // VR Display Mode controls (Horizontal SBS & Monoscopic)
    const vrQuickBtn = document.getElementById('btn-vr-quick');
    if (vrQuickBtn) {
      vrQuickBtn.onclick = () => this.workbench.cycleVrMode();
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-vr-mode]').forEach((btn) => {
      btn.onclick = () => {
        const mode = btn.dataset.vrMode as VrDisplayMode;
        if (mode) this.workbench.setVrMode(mode);
      };
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-sbs-aspect]').forEach((btn) => {
      btn.onclick = () => {
        const aspect = btn.dataset.sbsAspect as SbsAspectMode;
        if (aspect) {
          vrModeManager.updateSettings({ sbsAspectMode: aspect });
          this.render();
        }
      };
    });
    const vrDividerChk = document.getElementById('check-vr-divider') as HTMLInputElement | null;
    if (vrDividerChk) {
      vrDividerChk.onchange = () => {
        vrModeManager.updateSettings({ centerDivider: vrDividerChk.checked });
        this.render();
      };
    }
    const vrImuChk = document.getElementById('check-vr-imu') as HTMLInputElement | null;
    if (vrImuChk) {
      vrImuChk.onchange = () => {
        void rokidManager.enableImuTracking(vrImuChk.checked).then((ok) => {
          if (ok) void wakeLockManager.enable();
          this.render();
        });
      };
    }
    const vrVigChk = document.getElementById('check-vr-vignette') as HTMLInputElement | null;
    if (vrVigChk) {
      vrVigChk.onchange = () => {
        vrModeManager.updateSettings({ comfortVignette: vrVigChk.checked });
        this.render();
      };
    }
    const vrFovSlider = document.getElementById('slider-vr-fov') as HTMLInputElement | null;
    if (vrFovSlider) {
      vrFovSlider.oninput = () => {
        vrModeManager.updateSettings({ fovDegrees: Number(vrFovSlider.value) });
        const span = vrFovSlider.nextElementSibling;
        if (span) span.textContent = `${vrFovSlider.value}°`;
      };
    }
    const vrIpdSlider = document.getElementById('slider-vr-ipd') as HTMLInputElement | null;
    if (vrIpdSlider) {
      vrIpdSlider.oninput = () => {
        vrModeManager.updateSettings({ ipdMm: Number(vrIpdSlider.value) });
        const span = vrIpdSlider.nextElementSibling;
        if (span) span.textContent = `${vrIpdSlider.value} mm`;
      };
    }
  }

  private executeVoiceCommand(action: VoiceCommandAction, transcript: string) {
    const t = TRANSLATIONS[this.state.lang];
    const label = t.voiceCmd.actions[action];
    this.voiceCmdFeedback = `✓ ${label} ("${transcript}")`;
    if (this.voiceCmdFeedbackTimer !== null) {
      window.clearTimeout(this.voiceCmdFeedbackTimer);
    }
    this.voiceCmdFeedbackTimer = window.setTimeout(() => {
      this.voiceCmdFeedback = '';
      this.voiceCmdFeedbackTimer = null;
      this.render();
    }, 3200);

    switch (action) {
      case 'reset_scene':
        this.workbench.resetAssembly(true);
        break;
      case 'toggle_menu':
        this.dockCollapsed = !this.dockCollapsed;
        break;
      case 'snap_part':
        this.workbench.snapNextPart();
        break;
      case 'auto_assemble':
        this.workbench.autoAssembleAll();
        break;
      case 'explode_view':
        this.workbench.setExplodedAmount(0.85, true);
        break;
      case 'collapse_view':
        this.workbench.setExplodedAmount(0, true);
        break;
      case 'recenter_view':
        this.workbench.recenterCameraView();
        break;
      case 'next_module':
        this.workbench.cycleModule();
        break;
      case 'module_turbine':
        this.workbench.switchModule('turbine', true);
        break;
      case 'module_gearbox':
        this.workbench.switchModule('gearbox', true);
        break;
      case 'module_robotarm':
        this.workbench.switchModule('robotarm', true);
        break;
      case 'module_spectrometer':
        this.workbench.switchModule('spectrometer', true);
        break;
      case 'toggle_rokid':
        this.workbench.toggleRokidMode();
        break;
      case 'toggle_offline': {
        const next = !offlineStore.isFieldOfflineMode();
        offlineStore.setFieldOfflineMode(next);
        if (!next && this.currentUser) {
          void flushOfflineQueue().then(() => this.render()).catch(() => {});
        }
        break;
      }
      case 'start_recording':
        this.workbench.startSpatialRecording();
        break;
      case 'stop_recording':
        void this.workbench.stopAndSaveSpatialRecording(
          this.draftRecordingName,
          this.draftRecordingShared,
        );
        break;
      case 'replay_session': {
        const latest = this.savedRecordings[0] || offlineStore.getLocalRecordings()[0];
        if (latest) {
          this.workbench.playRecording(latest);
        }
        break;
      }
      case 'vr_sbs':
        this.workbench.setVrMode('horizontal_sbs');
        break;
      case 'vr_mono':
        this.workbench.setVrMode('monoscopic');
        break;
      case 'vr_off':
        this.workbench.setVrMode('off');
        break;
      case 'toggle_3dof': {
        const next = !rokidManager.isImuActive();
        void rokidManager.enableImuTracking(next).then((ok) => {
          if (ok) void wakeLockManager.enable();
        });
        break;
      }
    }

    audioEngine.playCommandAck();
    this.workbench.setActionToast(`${t.voiceCmd.lastCmdPrefix}: ${label}`);
    this.render();
  }
}
