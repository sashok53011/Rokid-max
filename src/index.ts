import * as xb from 'xrblocks';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import { registerSW } from 'virtual:pwa-register';
import { detectPlatformCapabilities } from './utils/platform.ts';
import { SpatialWorkbench } from './xr/SpatialWorkbench.ts';
import { HudController } from './ui/HudController.ts';

async function bootstrap() {
  // Register PWA Service Worker for field offline capability
  try {
    registerSW({ immediate: true });
  } catch {
    // Ignore if SW unavailable in restricted preview
  }

  // Initialize Rapier WASM module and probe WebXR capabilities (Android ARCore / Android XR / VR)
  const [, caps] = await Promise.all([RAPIER.init(), detectPlatformCapabilities()]);

  const options = new xb.Options();
  if (caps.preferredXrMode === 'immersive-vr') {
    options.enableVR();
  } else {
    options.xrSessionMode = 'immersive-ar';
    options.enableXRTransitions();
    options.transition.defaultBackgroundColor = 0x0b101b;
  }
  options.enableHands();
  options.enableHandRays();
  options.enableReticles();
  options.reticles.projectOnDepthMesh = false;
  options.enableControllers();
  options.enablePlaneDetection();
  options.lighting.enabled = true;

  options.physics.RAPIER = RAPIER as unknown as xb.RAPIERCompat;
  options.physics.fps = 60;
  options.physics.gravity = { x: 0, y: -9.81, z: 0 };
  options.physics.worldStep = true;
  options.physics.useEventQueue = true;

  // Cross-platform Desktop/Mobile XR Simulator autostart so 3D workbench & Spatial UI are live immediately
  options.enableSimulator = true;
  options.xrButton.enabled = true;
  options.xrButton.alwaysAutostartSimulator = true;
  options.xrButton.appTitle = 'AeroLab XR';
  options.xrButton.appDescription =
    'Interactive 3D Physics Assembly, Multiplayer, Rokid Max AR & Offline Field Sync';
  options.simulator.handPosePanel.enabled = false;
  options.simulator.geminiLivePanel.enabled = false;
  options.simulator.instructions.showAutomatically = false;
  options.simulator.simulatorSettingsPanel.enabled = false;
  options.simulator.initialCameraPosition = { x: 0, y: 1.55, z: 0.45 };

  const workbench = new SpatialWorkbench();
  xb.add(workbench);
  await xb.init(options);

  const root = document.getElementById('root') || document.body;
  const hudRoot = document.createElement('div');
  hudRoot.id = 'hud-root';
  root.appendChild(hudRoot);

  new HudController(hudRoot, workbench);
}

document.addEventListener('DOMContentLoaded', () => {
  void bootstrap();
});
