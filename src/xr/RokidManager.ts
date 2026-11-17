import * as THREE from 'three';
import * as xb from 'xrblocks';
import { orientationController, type LandscapeLockStatus } from '../utils/platform.ts';

export interface RokidSettings {
  enabled: boolean;
  /** Rokid Max Gen 1 diagonal FOV is 50 deg (~30 deg vertical at 16:9) */
  fovDegrees: number;
  ipdMm: number;
  sbsStereo: boolean;
  opticalSeeThrough: boolean;
  imuHeadTracking: boolean;
  comfortVignette: boolean;
}

const _imuEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _imuQuat = new THREE.Quaternion();
const _screenAdjust = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const _orientQuat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _rightVec = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();

/**
 * Hardware-calibrated profile & low-latency stereo/IMU manager for
 * Rokid Max AR Glasses (1st Generation: 50° diagonal FOV, 1920x1080/eye
 * Birdbath micro-OLED optics, 3840x1080 3D SBS mode, and 3DoF IMU).
 */
export class RokidMaxManager {
  settings: RokidSettings = {
    enabled: false,
    fovDegrees: 50,
    ipdMm: 63,
    sbsStereo: false,
    opticalSeeThrough: true,
    imuHeadTracking: false,
    comfortVignette: true,
  };

  private leftCam = new THREE.PerspectiveCamera(29, 16 / 9, 0.05, 80);
  private rightCam = new THREE.PerspectiveCamera(29, 16 / 9, 0.05, 80);
  private baseCameraFov = 55;
  private hasBaseFov = false;
  private imuActive = false;
  private imuZeroYaw: number | null = null;
  private latestAlpha = 0;
  private latestBeta = 0;
  private latestGamma = 0;
  private hasImuSample = false;

  // Frame latency telemetry (EMA)
  private avgFrameMs = 16.6;
  private fps = 60;
  private lastHeadQuat = new THREE.Quaternion();
  private vignetteIntensity = 0;
  private vignetteEl: HTMLDivElement | null = null;
  private imuListeners = new Set<(active: boolean) => void>();

  constructor() {
    this.ensureVignetteElement();
  }

  private ensureVignetteElement() {
    if (typeof document === 'undefined' || this.vignetteEl) return;
    const el = document.createElement('div');
    el.id = 'rokid-comfort-vignette';
    el.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:6;opacity:0;transition:opacity 80ms linear;' +
      'background:radial-gradient(circle at center, rgba(0,0,0,0) 48%, rgba(0,0,0,0.82) 100%);';
    document.body.appendChild(el);
    this.vignetteEl = el;
  }

  onImuChange(cb: (active: boolean) => void): () => void {
    this.imuListeners.add(cb);
    cb(this.imuActive);
    return () => this.imuListeners.delete(cb);
  }

  private emitImuChange() {
    for (const cb of this.imuListeners) cb(this.imuActive);
  }

  private attachOrientationListeners() {
    if (typeof window === 'undefined') return;
    window.addEventListener('orientationchange', this.onScreenOrientationChange, { passive: true });
    if (typeof screen !== 'undefined' && screen.orientation?.addEventListener) {
      screen.orientation.addEventListener('change', this.onScreenOrientationChange);
    }
  }

  private detachOrientationListeners() {
    if (typeof window === 'undefined') return;
    window.removeEventListener('orientationchange', this.onScreenOrientationChange);
    if (typeof screen !== 'undefined' && screen.orientation?.removeEventListener) {
      screen.orientation.removeEventListener('change', this.onScreenOrientationChange);
    }
  }

  private onScreenOrientationChange = () => {
    // Re-zero IMU heading when rotating between portrait and landscape
    this.imuZeroYaw = null;
  };

  async enableImuTracking(enabled: boolean): Promise<boolean> {
    this.settings.imuHeadTracking = enabled;
    if (!enabled) {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', this.onDeviceOrientation);
      }
      this.detachOrientationListeners();
      this.imuActive = false;
      this.imuZeroYaw = null;
      this.hasImuSample = false;
      await orientationController.unlockLandscape();
      this.emitImuChange();
      return false;
    }

    if (typeof window !== 'undefined') {
      const DevOrient = window.DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>;
      };
      if (DevOrient && typeof DevOrient.requestPermission === 'function') {
        try {
          const perm = await DevOrient.requestPermission();
          if (perm !== 'granted') {
            this.settings.imuHeadTracking = false;
            this.emitImuChange();
            return false;
          }
        } catch {
          this.settings.imuHeadTracking = false;
          this.emitImuChange();
          return false;
        }
      }
      window.addEventListener('deviceorientation', this.onDeviceOrientation, { passive: true });
    }

    this.imuZeroYaw = null;
    this.attachOrientationListeners();
    this.imuActive = true;
    await orientationController.lockLandscape({ allowFullscreenFallback: true });
    this.emitImuChange();
    return true;
  }

  private onDeviceOrientation = (ev: DeviceOrientationEvent) => {
    if (ev.alpha === null || ev.beta === null || ev.gamma === null) return;
    if (this.imuZeroYaw === null) {
      this.imuZeroYaw = ev.alpha;
    }
    this.latestAlpha = ev.alpha - this.imuZeroYaw;
    this.latestBeta = ev.beta;
    this.latestGamma = ev.gamma;
    this.hasImuSample = true;
  };

  recenterImuHeading() {
    this.imuZeroYaw = null;
  }

  async requestLandscapeLock(): Promise<LandscapeLockStatus> {
    return orientationController.lockLandscape({ allowFullscreenFallback: true });
  }

  getLandscapeStatus(): LandscapeLockStatus {
    return orientationController.getStatus();
  }

  isImuActive(): boolean {
    return this.imuActive;
  }

  setEnabled(enabled: boolean) {
    this.settings.enabled = enabled;
    document.body.classList.toggle('rokid-ar-active', enabled && this.settings.opticalSeeThrough);
    this.applyToCore();
  }

  updateSettings(partial: Partial<RokidSettings>) {
    Object.assign(this.settings, partial);
    document.body.classList.toggle(
      'rokid-ar-active',
      this.settings.enabled && this.settings.opticalSeeThrough,
    );
    this.applyToCore();
  }

  applyToCore() {
    const cam = xb.core.camera;
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const scene = xb.core.scene;
    if (!cam) return;

    if (!this.hasBaseFov) {
      this.baseCameraFov = cam.fov;
      this.hasBaseFov = true;
    }

    if (this.settings.enabled) {
      // Convert Rokid Max 50° diagonal FOV at 16:9 to vertical FOV (~25.4°–29°)
      const aspect = Math.max(1.1, cam.aspect || 16 / 9);
      const diagRad = THREE.MathUtils.degToRad(this.settings.fovDegrees);
      const vertRad = 2 * Math.atan(Math.tan(diagRad / 2) / Math.sqrt(1 + aspect * aspect));
      cam.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(vertRad), 22, 65);
      cam.updateProjectionMatrix();

      if (this.settings.opticalSeeThrough) {
        if (scene) {
          scene.background = new THREE.Color(0x000000);
          scene.fog = null;
        }
        if (renderer && 'setClearColor' in renderer) {
          renderer.setClearColor(0x000000, 1);
        }
      }
      if (this.settings.sbsStereo && renderer && 'render' in renderer) {
        xb.core.renderSceneOverride = this.renderRokidSbsStereo;
      } else {
        xb.core.renderSceneOverride = undefined;
      }
    } else {
      cam.fov = this.baseCameraFov;
      cam.updateProjectionMatrix();
      xb.core.renderSceneOverride = undefined;
      if (scene) {
        scene.background = new THREE.Color(0x0b101b);
        scene.fog = new THREE.FogExp2(0x0b101b, 0.045);
      }
    }
  }

  private renderRokidSbsStereo = (
    renderer: xb.SupportedRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) => {
    const glRenderer = renderer as THREE.WebGLRenderer;
    if (!glRenderer.render || glRenderer.xr?.isPresenting) {
      glRenderer.render(scene, camera);
      return;
    }

    const persp = camera as THREE.PerspectiveCamera;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const halfW = Math.floor(width / 2);
    const halfIpd = (this.settings.ipdMm / 1000) * 0.5;

    this.leftCam.fov = persp.fov;
    this.leftCam.aspect = halfW / Math.max(1, height);
    this.leftCam.near = persp.near;
    this.leftCam.far = persp.far;
    this.leftCam.updateProjectionMatrix();

    this.rightCam.copy(this.leftCam);

    persp.updateMatrixWorld();
    _rightVec.set(1, 0, 0).applyQuaternion(persp.quaternion);

    this.leftCam.position.copy(persp.position).addScaledVector(_rightVec, -halfIpd);
    this.leftCam.quaternion.copy(persp.quaternion);

    this.rightCam.position.copy(persp.position).addScaledVector(_rightVec, halfIpd);
    this.rightCam.quaternion.copy(persp.quaternion);

    const prevScissor = glRenderer.getScissorTest();
    glRenderer.setScissorTest(true);

    // Left eye viewport (1920x1080 scaled)
    glRenderer.setViewport(0, 0, halfW, height);
    glRenderer.setScissor(0, 0, halfW, height);
    glRenderer.render(scene, this.leftCam);

    // Right eye viewport
    glRenderer.setViewport(halfW, 0, width - halfW, height);
    glRenderer.setScissor(halfW, 0, width - halfW, height);
    glRenderer.render(scene, this.rightCam);

    glRenderer.setScissorTest(prevScissor);
    glRenderer.setViewport(0, 0, width, height);
  };

  updatePerFrame(dtSec: number) {
    const frameMs = Math.max(1, Math.min(200, dtSec * 1000));
    this.avgFrameMs = this.avgFrameMs * 0.9 + frameMs * 0.1;
    this.fps = Math.round(1000 / Math.max(1, this.avgFrameMs));

    const cam = xb.core.camera;
    if (!cam) return;

    if (this.imuActive && this.hasImuSample && !xb.core.renderer?.xr?.isPresenting) {
      const alpha = THREE.MathUtils.degToRad(this.latestAlpha);
      const beta = THREE.MathUtils.degToRad(this.latestBeta);
      const gamma = THREE.MathUtils.degToRad(this.latestGamma);
      const orientDeg = orientationController.getOrientationAngle();
      _orientQuat.setFromAxisAngle(_zAxis, -THREE.MathUtils.degToRad(orientDeg));
      _imuEuler.set(beta, alpha, -gamma, 'YXZ');
      _targetQuat.setFromEuler(_imuEuler).multiply(_screenAdjust).multiply(_orientQuat);
      _imuQuat.copy(cam.quaternion).slerp(_targetQuat, 1 - Math.exp(-18 * dtSec));
      cam.quaternion.copy(_imuQuat);
    }

    // Anti-motion-sickness comfort vignette on rapid head/camera rotation
    if (this.settings.comfortVignette && this.vignetteEl) {
      const angleDelta = cam.quaternion.angleTo(this.lastHeadQuat);
      const angVel = dtSec > 0.0001 ? angleDelta / dtSec : 0;
      const targetVig = angVel > 1.35 ? Math.min(0.9, (angVel - 1.35) * 0.45) : 0;
      this.vignetteIntensity = THREE.MathUtils.damp(this.vignetteIntensity, targetVig, 10, dtSec);
      this.vignetteEl.style.opacity = this.vignetteIntensity.toFixed(2);
    } else if (this.vignetteEl && this.vignetteIntensity > 0.01) {
      this.vignetteIntensity = 0;
      this.vignetteEl.style.opacity = '0';
    }
    this.lastHeadQuat.copy(cam.quaternion);
  }

  getLatencyStats() {
    return {
      frameMs: Number(this.avgFrameMs.toFixed(1)),
      fps: this.fps,
    };
  }
}

export const rokidManager = new RokidMaxManager();
