import * as THREE from 'three';
import * as xb from 'xrblocks';
import { rokidManager } from './RokidManager.ts';

export type VrDisplayMode = 'off' | 'horizontal_sbs' | 'monoscopic';
export type SbsAspectMode = 'full' | 'half';

export interface VrModeSettings {
  mode: VrDisplayMode;
  fovDegrees: number;
  ipdMm: number;
  sbsAspectMode: SbsAspectMode;
  centerDivider: boolean;
  comfortVignette: boolean;
}

const STORAGE_KEY = 'aerolab_xr_vr_mode_v1';

// Zero-GC pre-allocated math helpers
const _rightVec = new THREE.Vector3();
const _size = new THREE.Vector2();
const _leftPos = new THREE.Vector3();
const _rightPos = new THREE.Vector3();
const _midPos = new THREE.Vector3();
const _camQuat = new THREE.Quaternion();
const _camScale = new THREE.Vector3(1, 1, 1);

/**
 * Manages immersive VR display modes for desktop, mobile VR viewers, AR/VR
 * glasses, and WebXR headsets:
 *  - `horizontal_sbs`: Side-by-Side 3D stereo dual-viewport projection (Left | Right)
 *  - `monoscopic`: Full-viewport single-camera VR rendering (and zero-IPD WebXR sync)
 *  - `off`: Standard workbench / AR passthrough view
 */
export class VrModeManager {
  settings: VrModeSettings = {
    mode: 'off',
    fovDegrees: 84,
    ipdMm: 63,
    sbsAspectMode: 'full',
    centerDivider: true,
    comfortVignette: true,
  };

  private leftCam = new THREE.PerspectiveCamera(84, 1, 0.05, 100);
  private rightCam = new THREE.PerspectiveCamera(84, 1, 0.05, 100);
  private monoCam = new THREE.PerspectiveCamera(84, 16 / 9, 0.05, 100);
  private baseCameraFov = 55;
  private hasBaseFov = false;
  private wasArBeforeVr = false;

  private listeners = new Set<(settings: VrModeSettings) => void>();
  private sbsOverlayEl: HTMLDivElement | null = null;
  private vignetteEl: HTMLDivElement | null = null;
  private lastHeadQuat = new THREE.Quaternion();
  private vignetteIntensity = 0;

  constructor() {
    this.loadPersistedPrefs();
    this.ensureOverlayElements();
  }

  private loadPersistedPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<VrModeSettings>;
      if (typeof parsed.fovDegrees === 'number') {
        this.settings.fovDegrees = THREE.MathUtils.clamp(parsed.fovDegrees, 55, 110);
      }
      if (typeof parsed.ipdMm === 'number') {
        this.settings.ipdMm = THREE.MathUtils.clamp(parsed.ipdMm, 50, 76);
      }
      if (parsed.sbsAspectMode === 'full' || parsed.sbsAspectMode === 'half') {
        this.settings.sbsAspectMode = parsed.sbsAspectMode;
      }
      if (typeof parsed.centerDivider === 'boolean') {
        this.settings.centerDivider = parsed.centerDivider;
      }
      if (typeof parsed.comfortVignette === 'boolean') {
        this.settings.comfortVignette = parsed.comfortVignette;
      }
    } catch {
      // Ignore corrupt local preferences
    }
  }

  private savePersistedPrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          fovDegrees: this.settings.fovDegrees,
          ipdMm: this.settings.ipdMm,
          sbsAspectMode: this.settings.sbsAspectMode,
          centerDivider: this.settings.centerDivider,
          comfortVignette: this.settings.comfortVignette,
        }),
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  private ensureOverlayElements() {
    if (typeof document === 'undefined') return;
    if (!this.sbsOverlayEl) {
      const el = document.createElement('div');
      el.id = 'vr-sbs-overlay';
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML =
        '<div class="vr-sbs-seam"></div>' +
        '<span class="vr-eye-tag vr-eye-left">L</span>' +
        '<span class="vr-eye-tag vr-eye-right">R</span>';
      document.body.appendChild(el);
      this.sbsOverlayEl = el;
    }
    if (!this.vignetteEl) {
      const v = document.createElement('div');
      v.id = 'vr-comfort-vignette';
      v.setAttribute('aria-hidden', 'true');
      v.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:7;opacity:0;transition:opacity 80ms linear;' +
        'background:radial-gradient(circle at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.85) 100%);';
      document.body.appendChild(v);
      this.vignetteEl = v;
    }
  }

  onChange(cb: (settings: VrModeSettings) => void): () => void {
    this.listeners.add(cb);
    cb({ ...this.settings });
    return () => this.listeners.delete(cb);
  }

  private emit() {
    const snap = { ...this.settings };
    for (const cb of this.listeners) cb(snap);
  }

  isActive(): boolean {
    return this.settings.mode !== 'off';
  }

  getMode(): VrDisplayMode {
    return this.settings.mode;
  }

  cycleMode(): VrDisplayMode {
    const order: VrDisplayMode[] = ['off', 'horizontal_sbs', 'monoscopic'];
    const next = order[(order.indexOf(this.settings.mode) + 1) % order.length];
    this.setMode(next);
    return next;
  }

  setMode(mode: VrDisplayMode) {
    const prevMode = this.settings.mode;
    if (prevMode === mode) {
      this.applyToCore();
      return;
    }

    if (mode !== 'off' && rokidManager.settings.enabled) {
      rokidManager.setEnabled(false);
    }

    if (prevMode === 'off' && mode !== 'off') {
      this.wasArBeforeVr = xb.core.transition?.currentMode === 'AR';
    }

    this.settings.mode = mode;
    this.applyToCore();
    this.emit();
  }

  updateSettings(partial: Partial<Omit<VrModeSettings, 'mode'>>) {
    Object.assign(this.settings, partial);
    this.settings.fovDegrees = THREE.MathUtils.clamp(this.settings.fovDegrees, 55, 110);
    this.settings.ipdMm = THREE.MathUtils.clamp(this.settings.ipdMm, 50, 76);
    this.savePersistedPrefs();
    this.applyToCore();
    this.emit();
  }

  applyToCore() {
    const cam = xb.core.camera;
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const scene = xb.core.scene;
    const mode = this.settings.mode;

    if (typeof document !== 'undefined') {
      document.body.classList.toggle('vr-mode-sbs', mode === 'horizontal_sbs');
      document.body.classList.toggle('vr-mode-mono', mode === 'monoscopic');
      if (this.sbsOverlayEl) {
        this.sbsOverlayEl.classList.toggle(
          'visible',
          mode === 'horizontal_sbs' && this.settings.centerDivider && !renderer?.xr?.isPresenting,
        );
      }
    }

    if (!cam) return;

    if (!this.hasBaseFov) {
      this.baseCameraFov = cam.fov;
      this.hasBaseFov = true;
    }

    if (mode === 'off') {
      cam.fov = this.baseCameraFov;
      cam.updateProjectionMatrix();
      xb.core.renderSceneOverride = undefined;

      if (this.wasArBeforeVr && xb.core.transition && xb.core.transition.currentMode !== 'AR') {
        xb.core.transition.toAR();
      }
      this.wasArBeforeVr = false;

      if (rokidManager.settings.enabled) {
        rokidManager.applyToCore();
      } else if (scene) {
        scene.background = new THREE.Color(0x0b101b);
        scene.fog = new THREE.FogExp2(0x0b101b, 0.045);
      }
      if (this.vignetteEl) {
        this.vignetteIntensity = 0;
        this.vignetteEl.style.opacity = '0';
      }
      return;
    }

    // Active VR mode (Horizontal SBS or Monoscopic)
    cam.fov = this.settings.fovDegrees;
    cam.updateProjectionMatrix();

    if (xb.core.transition && xb.core.transition.currentMode === 'AR') {
      xb.core.transition.toVR({ color: 0x060a14 });
    }
    if (scene) {
      scene.background = new THREE.Color(0x060a14);
      scene.fog = new THREE.FogExp2(0x060a14, 0.032);
    }
    if (renderer && 'setClearColor' in renderer) {
      renderer.setClearColor(0x060a14, 1);
      if ('setClearAlpha' in renderer) {
        renderer.setClearAlpha(1);
      }
    }

    if (mode === 'horizontal_sbs') {
      xb.core.renderSceneOverride = this.renderHorizontalSbs;
    } else {
      xb.core.renderSceneOverride = this.renderMonoscopic;
    }
  }

  private renderHorizontalSbs = (
    renderer: xb.SupportedRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    const glRenderer = renderer as THREE.WebGLRenderer;
    if (!glRenderer.render) return;

    // Native WebXR sessions already drive binocular stereo framebuffers in hardware.
    if (glRenderer.xr?.isPresenting) {
      glRenderer.render(scene, camera);
      return;
    }

    const persp = camera as THREE.PerspectiveCamera;
    glRenderer.getSize(_size);
    const width = Math.max(2, Math.floor(_size.x || window.innerWidth));
    const height = Math.max(2, Math.floor(_size.y || window.innerHeight));
    const halfW = Math.floor(width / 2);
    const rightW = width - halfW;

    const eyeAspect =
      this.settings.sbsAspectMode === 'half'
        ? width / height
        : halfW / height;

    this.leftCam.fov = this.settings.fovDegrees;
    this.leftCam.aspect = eyeAspect;
    this.leftCam.near = persp.near || 0.05;
    this.leftCam.far = persp.far || 100;
    this.leftCam.updateProjectionMatrix();

    this.rightCam.fov = this.leftCam.fov;
    this.rightCam.aspect = eyeAspect;
    this.rightCam.near = this.leftCam.near;
    this.rightCam.far = this.leftCam.far;
    this.rightCam.updateProjectionMatrix();

    persp.updateMatrixWorld();
    persp.getWorldPosition(_midPos);
    persp.getWorldQuaternion(_camQuat);

    _rightVec.set(1, 0, 0).applyQuaternion(_camQuat).normalize();
    const halfIpd = (this.settings.ipdMm / 1000) * 0.5;

    this.leftCam.position.copy(_midPos).addScaledVector(_rightVec, -halfIpd);
    this.leftCam.quaternion.copy(_camQuat);
    this.leftCam.updateMatrixWorld();

    this.rightCam.position.copy(_midPos).addScaledVector(_rightVec, halfIpd);
    this.rightCam.quaternion.copy(_camQuat);
    this.rightCam.updateMatrixWorld();

    const prevScissorTest = glRenderer.getScissorTest();
    const prevAutoClear = glRenderer.autoClear;
    glRenderer.setRenderTarget(null);
    glRenderer.setScissorTest(true);
    glRenderer.autoClear = false;

    try {
      // Left eye half-viewport
      glRenderer.setViewport(0, 0, halfW, height);
      glRenderer.setScissor(0, 0, halfW, height);
      glRenderer.clear(true, true, true);
      glRenderer.render(scene, this.leftCam);

      // Right eye half-viewport
      glRenderer.setViewport(halfW, 0, rightW, height);
      glRenderer.setScissor(halfW, 0, rightW, height);
      glRenderer.clear(true, true, true);
      glRenderer.render(scene, this.rightCam);
    } finally {
      glRenderer.autoClear = prevAutoClear;
      glRenderer.setScissorTest(prevScissorTest);
      glRenderer.setViewport(0, 0, width, height);
      glRenderer.setScissor(0, 0, width, height);
    }
  };

  private renderMonoscopic = (
    renderer: xb.SupportedRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    const glRenderer = renderer as THREE.WebGLRenderer;
    if (!glRenderer.render) return;

    // Inside WebXR presentation, collapse stereo eyes onto a single cyclopean pose
    // so both displays receive an identical monoscopic image with zero disparity.
    if (glRenderer.xr?.isPresenting) {
      const xrCam = glRenderer.xr.getCamera();
      const prevAutoUpdate = glRenderer.xr.cameraAutoUpdate;
      glRenderer.xr.cameraAutoUpdate = false;
      try {
        glRenderer.xr.updateCamera(camera as THREE.PerspectiveCamera);
        const eyes = xrCam?.cameras;
        if (eyes && eyes.length >= 2) {
          eyes[0].matrixWorld.decompose(_leftPos, _camQuat, _camScale);
          eyes[1].matrixWorld.decompose(_rightPos, _camQuat, _camScale);
          _midPos.copy(_leftPos).add(_rightPos).multiplyScalar(0.5);

          for (let i = 0; i < eyes.length; i++) {
            eyes[i].matrixWorld.compose(_midPos, _camQuat, _camScale);
            eyes[i].matrixWorldInverse.copy(eyes[i].matrixWorld).invert();
          }
        }
        glRenderer.render(scene, camera);
      } finally {
        glRenderer.xr.cameraAutoUpdate = prevAutoUpdate;
      }
      return;
    }

    const persp = camera as THREE.PerspectiveCamera;
    glRenderer.getSize(_size);
    const width = Math.max(2, Math.floor(_size.x || window.innerWidth));
    const height = Math.max(2, Math.floor(_size.y || window.innerHeight));

    this.monoCam.fov = this.settings.fovDegrees;
    this.monoCam.aspect = width / height;
    this.monoCam.near = persp.near || 0.05;
    this.monoCam.far = persp.far || 100;
    this.monoCam.updateProjectionMatrix();

    persp.updateMatrixWorld();
    persp.getWorldPosition(this.monoCam.position);
    persp.getWorldQuaternion(this.monoCam.quaternion);
    this.monoCam.updateMatrixWorld();

    const prevAutoClear = glRenderer.autoClear;
    const prevScissorTest = glRenderer.getScissorTest();
    glRenderer.setRenderTarget(null);
    glRenderer.setScissorTest(false);
    glRenderer.setViewport(0, 0, width, height);
    glRenderer.autoClear = false;
    try {
      glRenderer.clear(true, true, true);
      glRenderer.render(scene, this.monoCam);
    } finally {
      glRenderer.autoClear = prevAutoClear;
      glRenderer.setScissorTest(prevScissorTest);
    }
  };

  updatePerFrame(dtSec: number) {
    const cam = xb.core.camera;
    if (!cam || !this.isActive()) {
      if (this.vignetteEl && this.vignetteIntensity > 0.01) {
        this.vignetteIntensity = 0;
        this.vignetteEl.style.opacity = '0';
      }
      return;
    }

    if (this.settings.comfortVignette && this.vignetteEl) {
      const angleDelta = cam.quaternion.angleTo(this.lastHeadQuat);
      const angVel = dtSec > 0.0001 ? angleDelta / dtSec : 0;
      const targetVig = angVel > 1.35 ? Math.min(0.88, (angVel - 1.35) * 0.42) : 0;
      this.vignetteIntensity = THREE.MathUtils.damp(this.vignetteIntensity, targetVig, 10, dtSec);
      this.vignetteEl.style.opacity = this.vignetteIntensity.toFixed(2);
    } else if (this.vignetteEl && this.vignetteIntensity > 0.01) {
      this.vignetteIntensity = 0;
      this.vignetteEl.style.opacity = '0';
    }
    this.lastHeadQuat.copy(cam.quaternion);
  }
}

export const vrModeManager = new VrModeManager();
