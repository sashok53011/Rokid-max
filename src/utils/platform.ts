export interface PlatformCapabilities {
  isAndroid: boolean;
  isAndroidXr: boolean;
  isMobileTouch: boolean;
  preferredXrMode: 'immersive-ar' | 'immersive-vr';
  supportsAr: boolean;
  supportsVr: boolean;
}

let cachedCaps: PlatformCapabilities | null = null;

export function isAndroidUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent);
}

export function isMobileTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return uaMobile || (coarsePointer && navigator.maxTouchPoints > 0);
}

export async function detectPlatformCapabilities(): Promise<PlatformCapabilities> {
  if (cachedCaps) return cachedCaps;

  const isAndroid = isAndroidUserAgent();
  const isMobileTouch = isMobileTouchDevice();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isAndroidXr =
    isAndroid && /Quest|Oculus|Android XR|Pico|Galaxy XR|XREAL|Rokid/i.test(ua);

  let supportsAr = false;
  let supportsVr = false;

  if (typeof navigator !== 'undefined' && 'xr' in navigator && navigator.xr) {
    try {
      [supportsAr, supportsVr] = await Promise.all([
        navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
        navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
      ]);
    } catch {
      supportsAr = false;
      supportsVr = false;
    }
  }

  // On Android phones/tablets & Android XR passthrough devices, prefer immersive-ar when available.
  const preferredXrMode: 'immersive-ar' | 'immersive-vr' =
    supportsAr && (isAndroid || !supportsVr) ? 'immersive-ar' : 'immersive-vr';

  cachedCaps = {
    isAndroid,
    isAndroidXr,
    isMobileTouch,
    preferredXrMode,
    supportsAr,
    supportsVr,
  };
  return cachedCaps;
}

export function getCachedPlatformCapabilities(): PlatformCapabilities {
  return (
    cachedCaps ?? {
      isAndroid: isAndroidUserAgent(),
      isAndroidXr: false,
      isMobileTouch: isMobileTouchDevice(),
      preferredXrMode: isAndroidUserAgent() ? 'immersive-ar' : 'immersive-vr',
      supportsAr: false,
      supportsVr: false,
    }
  );
}

class AndroidWakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  async enable() {
    this.wanted = true;
    await this.acquire();
  }

  async acquire() {
    if (!this.wanted || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    if (document.visibilityState !== 'visible' || this.sentinel) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Ignore if battery saver or browser denies wake lock
    }
  }

  release() {
    this.wanted = false;
    if (this.sentinel) {
      void this.sentinel.release().catch(() => {});
      this.sentinel = null;
    }
  }
}

export const wakeLockManager = new AndroidWakeLockManager();

export interface LandscapeLockStatus {
  wanted: boolean;
  locked: boolean;
  fullscreenEntered: boolean;
  isPortrait: boolean;
  orientationAngle: number;
  orientationType: string;
}

class OrientationController {
  private wanted = false;
  private locked = false;
  private fullscreenEnteredByLock = false;
  private listeners = new Set<(status: LandscapeLockStatus) => void>();
  private initialized = false;

  constructor() {
    this.bindGlobalEvents();
  }

  private bindGlobalEvents() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    const handleChange = () => {
      if (this.fullscreenEnteredByLock && typeof document !== 'undefined' && !document.fullscreenElement) {
        this.fullscreenEnteredByLock = false;
      }
      this.emit();
    };

    window.addEventListener('resize', handleChange, { passive: true });
    window.addEventListener('orientationchange', handleChange, { passive: true });
    if (typeof screen !== 'undefined' && screen.orientation?.addEventListener) {
      screen.orientation.addEventListener('change', handleChange);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('fullscreenchange', handleChange);
    }
  }

  isPortraitViewport(): boolean {
    if (typeof window === 'undefined') return false;
    return window.innerHeight > window.innerWidth;
  }

  getOrientationAngle(): number {
    if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') {
      return ((screen.orientation.angle % 360) + 360) % 360;
    }
    if (typeof window !== 'undefined') {
      const legacy = Number((window as unknown as { orientation?: number }).orientation || 0);
      return ((legacy % 360) + 360) % 360;
    }
    return 0;
  }

  getOrientationType(): string {
    if (typeof screen !== 'undefined' && screen.orientation?.type) {
      return screen.orientation.type;
    }
    return this.isPortraitViewport() ? 'portrait-primary' : 'landscape-primary';
  }

  getStatus(): LandscapeLockStatus {
    return {
      wanted: this.wanted,
      locked: this.locked,
      fullscreenEntered: this.fullscreenEnteredByLock,
      isPortrait: this.isPortraitViewport(),
      orientationAngle: this.getOrientationAngle(),
      orientationType: this.getOrientationType(),
    };
  }

  onChange(cb: (status: LandscapeLockStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.getStatus());
    return () => this.listeners.delete(cb);
  }

  private emit() {
    const snap = this.getStatus();
    for (const cb of this.listeners) cb(snap);
  }

  private async tryLockScreenOrientation(): Promise<boolean> {
    if (typeof screen === 'undefined' || !screen.orientation) return false;
    const ori = screen.orientation as ScreenOrientation & {
      lock?: (orientation: 'landscape' | 'landscape-primary') => Promise<void>;
    };
    if (typeof ori.lock !== 'function') return false;

    try {
      await ori.lock('landscape');
      return true;
    } catch {
      try {
        await ori.lock('landscape-primary');
        return true;
      } catch {
        return false;
      }
    }
  }

  async lockLandscape(options?: { allowFullscreenFallback?: boolean }): Promise<LandscapeLockStatus> {
    this.wanted = true;
    if (typeof document !== 'undefined') {
      document.body?.classList.add('landscape-3dof-active');
    }

    let locked = await this.tryLockScreenOrientation();

    const shouldTryFullscreen =
      !locked &&
      Boolean(options?.allowFullscreenFallback) &&
      typeof document !== 'undefined' &&
      !document.fullscreenElement &&
      typeof document.documentElement?.requestFullscreen === 'function' &&
      isMobileTouchDevice();

    if (shouldTryFullscreen) {
      try {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        this.fullscreenEnteredByLock = true;
      } catch {
        try {
          await document.documentElement.requestFullscreen();
          this.fullscreenEnteredByLock = true;
        } catch {
          // Fullscreen blocked or unsupported (e.g. iframe policy)
        }
      }
      if (this.wanted) {
        locked = await this.tryLockScreenOrientation();
      }
    }

    this.locked = locked;
    this.emit();
    return this.getStatus();
  }

  async unlockLandscape(): Promise<void> {
    this.wanted = false;
    this.locked = false;

    if (typeof document !== 'undefined') {
      document.body?.classList.remove('landscape-3dof-active');
    }

    if (typeof screen !== 'undefined' && screen.orientation) {
      const ori = screen.orientation as ScreenOrientation & { unlock?: () => void };
      if (typeof ori.unlock === 'function') {
        try {
          ori.unlock();
        } catch {
          // Ignore unlock failures
        }
      }
    }

    if (
      this.fullscreenEnteredByLock &&
      typeof document !== 'undefined' &&
      document.fullscreenElement &&
      typeof document.exitFullscreen === 'function'
    ) {
      this.fullscreenEnteredByLock = false;
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore fullscreen exit errors
      }
    } else {
      this.fullscreenEnteredByLock = false;
    }

    this.emit();
  }
}

export const orientationController = new OrientationController();

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void wakeLockManager.acquire();
    }
  });
}
