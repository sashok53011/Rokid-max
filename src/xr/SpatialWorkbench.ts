import * as THREE from 'three';
import * as xb from 'xrblocks';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-simd-compat';
import {
  buildCustomModuleFromQr,
  createMaterialPalette,
  SIMULATION_MODULES,
  type AssemblyPartSpec,
  type BuiltinModuleId,
  type CustomQrPartDef,
  type MaterialPalette,
  type ModuleDefinition,
} from '../modules/SimulationCatalog.ts';
import { TRANSLATIONS, type SupportedLang } from '../i18n/translations.ts';
import { audioEngine } from '../audio/ProceduralAudio.ts';
import { voiceCommandEngine } from '../audio/VoiceCommandEngine.ts';
import { rokidManager } from './RokidManager.ts';
import { vrModeManager, type VrDisplayMode } from './VrModeManager.ts';
import {
  multiplayerClient,
  type MultiplayerEvent,
  type PeerInfo,
  type SpatialAnnotation,
} from '../services/multiplayerClient.ts';
import { voiceChatManager } from '../services/voiceChatManager.ts';
import { getCachedPlatformCapabilities } from '../utils/platform.ts';
import { logAnalyticsEvent } from '../services/firebaseClient.ts';
import type {
  DeviceProfile,
  PartTransformRecord,
  RoomBoundsSpec,
  SavedSpatialMapping,
  SpatialFramePartPose,
  SpatialRecording,
  SpatialRecordingEvent,
} from '../services/offlineSync.ts';
import { offlineStore } from '../services/offlineSync.ts';
import { saveSpatialRecording } from '../services/firebaseClient.ts';
import {
  SpatialRecorder,
  type EvaluatedPlaybackPose,
  type RecorderStateSnapshot,
} from './SpatialRecorder.ts';

// Pre-allocated math helpers (Zero GC in update/physics loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _targetWorldPos = new THREE.Vector3();
const _peerPos = new THREE.Vector3();
const _peerQuat = new THREE.Quaternion();

export interface WorkbenchStateSnapshot {
  moduleId: BuiltinModuleId;
  lang: SupportedLang;
  snappedCount: number;
  totalParts: number;
  completed: boolean;
  explodedAmount: number;
  collisions: number;
  avgAccuracyPct: number;
  roomBounds: RoomBoundsSpec;
  rokidEnabled: boolean;
  vrMode: VrDisplayMode;
  lastSelectedPartLabel: string;
  lastActionToast: string;
}

class AssemblyPartNode extends xb.Script {
  spec: AssemblyPartSpec;
  visualGroup: THREE.Group;
  ghostMesh: THREE.Mesh;
  ghostMat: THREE.MeshBasicMaterial;
  rigidBody: RAPIER.RigidBody | null = null;
  snapped = false;
  isManipulated = false;
  lockedByPeer: string | null = null;
  hovered = false;
  grabStartedAt = 0;
  private workbench: SpatialWorkbench;
  private lastBroadcastMs = 0;

  constructor(
    spec: AssemblyPartSpec,
    visualGroup: THREE.Group,
    ghostMesh: THREE.Mesh,
    ghostMat: THREE.MeshBasicMaterial,
    workbench: SpatialWorkbench,
  ) {
    super();
    this.spec = spec;
    this.visualGroup = visualGroup;
    this.ghostMesh = ghostMesh;
    this.ghostMat = ghostMat;
    this.workbench = workbench;
    this.name = spec.id;
    this.add(this.visualGroup);

    // Enable XR Blocks automatic manipulation (mouse, hand-ray, controller, direct grab)
    this.xb = {
      manipulation: {
        actions: {
          translate: { faceCamera: false },
          rotate: { axis: 'y', space: 'world' },
          scale: false,
        },
      },
    };
  }

  onHoverEnter() {
    this.hovered = true;
    this.workbench.notifyPartSelected(this.spec);
  }

  onHoverExit() {
    this.hovered = false;
  }

  onObjectManipulate(event: xb.ManipulationEvent) {
    if (this.lockedByPeer || this.workbench.isPlaybackActive()) {
      event.preventDefault();
      return;
    }

    if (event.phase === 'start') {
      audioEngine.resume();
      this.isManipulated = true;
      this.snapped = false;
      this.grabStartedAt = performance.now();
      this.ghostMesh.visible = true;
      if (this.rigidBody) {
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
      multiplayerClient.send({
        type: 'part:grab',
        partId: this.spec.id,
      });
      this.workbench.notifyPartGrabbed(this);
      this.workbench.notifyPartSelected(this.spec);
      event.stopPropagation();
    } else if (event.phase === 'update') {
      if (this.rigidBody) {
        this.rigidBody.setNextKinematicTranslation({
          x: this.position.x,
          y: this.position.y,
          z: this.position.z,
        });
        this.rigidBody.setNextKinematicRotation({
          x: this.quaternion.x,
          y: this.quaternion.y,
          z: this.quaternion.z,
          w: this.quaternion.w,
        });
      }

      // Highlight ghost socket when within snap distance
      this.workbench.getTargetWorldPosition(this.spec, _targetWorldPos);
      const dist = this.position.distanceTo(_targetWorldPos);
      if (dist <= this.spec.snapRadius) {
        this.ghostMat.color.setHex(0x34d399);
        this.ghostMat.opacity = 0.42;
      } else {
        this.ghostMat.color.setHex(0x38bdf8);
        this.ghostMat.opacity = 0.2;
      }

      const now = performance.now();
      if (now - this.lastBroadcastMs > 45) {
        this.lastBroadcastMs = now;
        multiplayerClient.send({
          type: 'part:move',
          partId: this.spec.id,
          pos: { x: this.position.x, y: this.position.y, z: this.position.z },
          quat: { x: this.quaternion.x, y: this.quaternion.y, z: this.quaternion.z, w: this.quaternion.w },
          snapped: false,
        });
      }
    } else if (event.phase === 'end' || event.phase === 'cancel') {
      this.isManipulated = false;
      this.workbench.handlePartReleased(this);
    }
  }
}

interface RemoteAvatarVisual {
  group: THREE.Group;
  halo: THREE.Mesh;
  nameText: xb.UIText;
  targetHeadPos: THREE.Vector3;
  targetHeadQuat: THREE.Quaternion;
  handSphere: THREE.Mesh;
  hasHand: boolean;
  targetHandPos: THREE.Vector3;
  peerName: string;
  voiceEnabled: boolean;
  voiceMuted: boolean;
  lastHudLabel: string;
}

export class SpatialWorkbench extends xb.Script {
  private isSoftwareGl = false;
  private materials!: MaterialPalette;
  private workbenchOrigin = new THREE.Vector3(0, 1.08, -0.95);
  private tabletopY = 0.86;
  private partNodes: AssemblyPartNode[] = [];
  private activeModule: ModuleDefinition = SIMULATION_MODULES.turbine;
  private customModuleDef: ModuleDefinition | null = null;
  private currentLang: SupportedLang = 'en';
  private explodedTarget = 0;
  private explodedCurrent = 0;
  private moduleStartMs = performance.now();
  private collisions = 0;
  private accuracySamples: number[] = [];
  private completed = false;
  private lastSelectedPartLabel = '';
  private lastActionToast = '';

  // Laser beam visual for spectrometer module when completed
  private opticalBeamMesh?: THREE.Mesh;
  // Room-scale imported boundary wireframe
  private roomBoundaryGroup = new THREE.Group();
  private currentRoomBounds: RoomBoundsSpec = {
    width: 3.6,
    depth: 3.0,
    height: 2.5,
    originX: 0,
    originY: 0,
    originZ: -1.0,
  };

  // Rapier physics references
  private physicsRef?: xb.Physics;
  private staticBody?: RAPIER.RigidBody;

  // Multiplayer avatars & annotations
  private remoteAvatars = new Map<string, RemoteAvatarVisual>();
  private avatarContainer = new THREE.Group();
  private annotationContainer = new THREE.Group();
  private lastPoseBroadcastMs = 0;
  private lastAvatarDistanceSyncMs = 0;
  private unsubMultiplayer?: () => void;
  private unsubVoice?: () => void;
  private unsubVoiceCmd?: () => void;
  private unsubVrMode?: () => void;
  private vrEnvGroup = new THREE.Group();

  // Spatial Recording & Training Playback
  readonly recorder = new SpatialRecorder();
  private playbackTrailGroup = new THREE.Group();
  private playbackTrailLine?: THREE.Line;
  private playbackTrailPositions = new Float32Array(452 * 3);
  private playbackEventMarker?: THREE.Mesh;
  private playbackEventMarkerMat?: THREE.MeshBasicMaterial;
  private playbackMarkerPulse = 0;
  private recordingSavedListeners = new Set<(rec: SpatialRecording) => void>();

  // XR Blocks Spatial UI Card
  private spatialCard?: xb.UICard;
  private uiTitleText?: xb.UIText;
  private uiModuleText?: xb.UIText;
  private uiProgressText?: xb.UIText;
  private uiPartText?: xb.UIText;
  private uiExplodedSlider?: xb.UISlider;
  private uiResetBtn?: xb.UIButton;
  private uiSnapBtn?: xb.UIButton;
  private uiVoiceCmdBtn?: xb.UIButton;
  private uiRokidBtn?: xb.UIButton;
  private uiVoiceBtn?: xb.UIButton;
  private uiLangBtn?: xb.UIButton;
  private uiRecBtn?: xb.UIButton;
  private uiReplayBtn?: xb.UIButton;
  private uiVrModeBtn?: xb.UIButton;
  private uiModuleButtons: Map<string, xb.UIButton> = new Map();
  private uiValidated = false;

  // HUD state subscribers
  private stateListeners = new Set<(snap: WorkbenchStateSnapshot) => void>();

  onStateChange(cb: (snap: WorkbenchStateSnapshot) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.getSnapshot());
    return () => this.stateListeners.delete(cb);
  }

  onRecordingSaved(cb: (rec: SpatialRecording) => void): () => void {
    this.recordingSavedListeners.add(cb);
    return () => this.recordingSavedListeners.delete(cb);
  }

  isPlaybackActive(): boolean {
    return this.recorder.isPlayingOrPaused();
  }

  getRecorderSnapshot(): RecorderStateSnapshot {
    return this.recorder.getSnapshot();
  }

  private emitState() {
    const snap = this.getSnapshot();
    for (const cb of this.stateListeners) cb(snap);
  }

  getSnapshot(): WorkbenchStateSnapshot {
    const snappedCount = this.partNodes.filter((p) => p.snapped).length;
    const avgAcc =
      this.accuracySamples.length > 0
        ? this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
        : 100;
    return {
      moduleId: this.activeModule.id,
      lang: this.currentLang,
      snappedCount,
      totalParts: this.partNodes.length,
      completed: this.completed,
      explodedAmount: this.explodedTarget,
      collisions: this.collisions,
      avgAccuracyPct: Number(avgAcc.toFixed(1)),
      roomBounds: { ...this.currentRoomBounds },
      rokidEnabled: rokidManager.settings.enabled,
      vrMode: vrModeManager.getMode(),
      lastSelectedPartLabel: this.lastSelectedPartLabel,
      lastActionToast: this.lastActionToast,
    };
  }

  private detectSoftwareGl(): boolean {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return false;
    }
  }

  init() {
    this.isSoftwareGl = this.detectSoftwareGl();
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const scene = xb.core.scene;

    const caps = getCachedPlatformCapabilities();
    // Renderer quality & low-latency color pipeline (cap DPR on high-DPI Android displays)
    if (renderer && 'toneMapping' in renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      const maxDpr = caps.isAndroid ? 1.75 : 2;
      renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, maxDpr));
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = !this.isSoftwareGl;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    }

    // Mandatory studio environment map for metallic & optical glass reflections
    if (renderer && scene && 'getContext' in renderer) {
      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      } catch {
        // Ignore if non-WebGL renderer
      }
      scene.background = new THREE.Color(0x0b101b);
      scene.fog = new THREE.FogExp2(0x0b101b, 0.045);
    }

    const maxAniso =
      renderer && 'capabilities' in renderer ? renderer.capabilities.getMaxAnisotropy() : 4;
    this.materials = createMaterialPalette(this.isSoftwareGl, maxAniso);

    this.setupLighting();
    this.setupLabEnvironment();
    this.buildSpatialControlCard();

    // Attach shared THREE.AudioListener to active camera and initialize 3D PositionalAudio emitters
    audioEngine.attachSpatialListener(this, xb.core.camera, xb.core.sound?.getAudioListener());
    voiceChatManager.syncAllSpatialAudio();

    this.add(this.roomBoundaryGroup);
    this.add(this.avatarContainer);
    this.add(this.annotationContainer);
    this.setupPlaybackTrailVisuals();
    this.add(this.playbackTrailGroup);
    this.renderRoomBoundsVisual();

    this.loadModule('turbine', false);

    this.unsubMultiplayer = multiplayerClient.onEvent((ev) => this.handleMultiplayerEvent(ev));
    this.unsubVoice = voiceChatManager.onStateChange(() => this.refreshSpatialCardText());
    this.unsubVoiceCmd = voiceCommandEngine.onStateChange(() => this.refreshSpatialCardText());
    let lastVrMode = vrModeManager.getMode();
    this.unsubVrMode = vrModeManager.onChange((vrSettings) => {
      this.vrEnvGroup.visible = vrSettings.mode !== 'off';
      if (vrSettings.mode !== lastVrMode) {
        lastVrMode = vrSettings.mode;
        this.refreshSpatialCardText();
        this.emitState();
      }
    });

    // Pre-compile shaders on hardware GPUs to eliminate first-frame hitching
    if (renderer && scene && xb.core.camera && !this.isSoftwareGl && 'compile' in renderer) {
      try {
        renderer.compile(scene, xb.core.camera);
      } catch {
        // Safe skip
      }
    }
  }

  private setupLighting() {
    // 3-point warm/cool studio rig
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 1.35);
    this.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.2);
    keyLight.position.set(2.4, 3.8, 1.6);
    if (!this.isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 12;
      const d = 1.8;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
    }
    this.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.1);
    rimLight.position.set(-2.2, 2.1, -2.5);
    this.add(rimLight);
  }

  private setupLabEnvironment() {
    // Lab floor grid (offset Y >= 0.02 from shadow plane)
    const floorGeo = new THREE.CircleGeometry(14, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.88,
      metalness: 0.15,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    this.add(floor);

    const grid = new THREE.GridHelper(12, 24, 0x1e3a5f, 0x172554);
    grid.position.y = 0.005;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    this.add(grid);

    // Workbench pedestal grounded cleanly at y = 0
    const benchGroup = new THREE.Group();
    benchGroup.position.set(this.workbenchOrigin.x, 0, this.workbenchOrigin.z);

    // Soft radial contact shadow under pedestal
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext('2d')!;
    const grad = sctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.65)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.01;
    benchGroup.add(contactShadow);

    // Pedestal legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.35 });
    const legGeo = new THREE.CylinderGeometry(0.032, 0.04, 0.82, 16);
    const legPositions: [number, number][] = [
      [-0.48, -0.28],
      [0.48, -0.28],
      [-0.48, 0.28],
      [0.48, 0.28],
    ];
    for (const [lx, lz] of legPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(lx, 0.41, lz);
      leg.castShadow = true;
      benchGroup.add(leg);
    }

    // Workbench precision tabletop (top surface at y = 0.86)
    const topGeo = new THREE.BoxGeometry(1.18, 0.045, 0.74);
    const topMat = new THREE.MeshPhysicalMaterial({
      color: 0x162032,
      metalness: 0.45,
      roughness: 0.38,
      clearcoat: 0.4,
    });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.y = this.tabletopY - 0.0225;
    topMesh.receiveShadow = true;
    topMesh.castShadow = true;
    benchGroup.add(topMesh);

    // Precision target pad & glowing alignment ring at center of workbench
    const padRing = new THREE.Mesh(
      new THREE.RingGeometry(0.14, 0.155, 48),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide }),
    );
    padRing.rotation.x = -Math.PI / 2;
    padRing.position.y = this.tabletopY + 0.002;
    benchGroup.add(padRing);

    this.add(benchGroup);

    // Optical spectrometer laser beam (visible only when spectrometer is assembled)
    const beamGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.28, 12);
    beamGeo.rotateZ(Math.PI / 2);
    this.opticalBeamMesh = new THREE.Mesh(beamGeo, this.materials.emissiveLaser);
    this.opticalBeamMesh.position.set(this.workbenchOrigin.x + 0.02, this.workbenchOrigin.y + 0.045, this.workbenchOrigin.z);
    this.opticalBeamMesh.visible = false;
    this.add(this.opticalBeamMesh);

    this.setupVrDomeEnvironment();
  }

  private setupVrDomeEnvironment() {
    // 360-degree VR reference dome & subtle starfield for stereo parallax cues in Horizontal SBS & Monoscopic VR
    const domeGeo = new THREE.SphereGeometry(11.5, 24, 14);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0x164e63,
      wireframe: true,
      transparent: true,
      opacity: 0.24,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.y = 0.5;

    const horizonGeo = new THREE.RingGeometry(5.6, 5.66, 64);
    horizonGeo.rotateX(-Math.PI / 2);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const horizonRing = new THREE.Mesh(horizonGeo, horizonMat);
    horizonRing.position.set(this.workbenchOrigin.x, 0.02, this.workbenchOrigin.z);

    const starCount = 280;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = ((i * 137.508) % 360) * (Math.PI / 180);
      const phi = Math.acos(0.08 + ((i * 0.6180339) % 0.9));
      const r = 8.5 + (i % 7) * 0.45;
      starPositions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      starPositions[i * 3 + 1] = Math.cos(phi) * r + 0.4;
      starPositions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starsMat = new THREE.PointsMaterial({
      color: 0xbae6fd,
      size: 0.06,
      transparent: true,
      opacity: 0.72,
    });
    const stars = new THREE.Points(starsGeo, starsMat);

    this.vrEnvGroup.add(domeMesh, horizonRing, stars);
    this.vrEnvGroup.visible = vrModeManager.isActive();
    this.add(this.vrEnvGroup);
  }

  initPhysics(physics: xb.Physics) {
    this.physicsRef = physics;
    const world = physics.blendedWorld as unknown as RAPIER.World;
    const R = physics.RAPIER as unknown as typeof RAPIER;

    // Create fixed tabletop & floor colliders so parts rest and bounce realistically
    const tableDesc = R.RigidBodyDesc.fixed().setTranslation(
      this.workbenchOrigin.x,
      this.tabletopY - 0.025,
      this.workbenchOrigin.z,
    );
    this.staticBody = world.createRigidBody(tableDesc);
    const tableCol = R.ColliderDesc.cuboid(0.62, 0.025, 0.4).setFriction(0.75).setRestitution(0.2);
    world.createCollider(tableCol, this.staticBody);

    // Create subtle lip bumpers around the table so parts don't roll off into the void
    const railDefs: Array<[number, number, number, number, number, number]> = [
      [0, 0.04, -0.39, 0.62, 0.03, 0.015],
      [0, 0.04, 0.39, 0.62, 0.03, 0.015],
      [-0.61, 0.04, 0, 0.015, 0.03, 0.4],
      [0.61, 0.04, 0, 0.015, 0.03, 0.4],
    ];
    for (const [rx, ry, rz, hx, hy, hz] of railDefs) {
      const c = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(rx, ry, rz).setRestitution(0.3);
      world.createCollider(c, this.staticBody);
    }

    // Attach rigid bodies to already-loaded parts
    for (const part of this.partNodes) {
      this.createPartRigidBody(part);
    }
  }

  private createPartRigidBody(part: AssemblyPartNode) {
    if (!this.physicsRef) return;
    const world = this.physicsRef.blendedWorld as unknown as RAPIER.World;
    const R = this.physicsRef.RAPIER as unknown as typeof RAPIER;

    if (part.rigidBody) {
      try {
        world.removeRigidBody(part.rigidBody);
      } catch {
        // Ignore if already removed
      }
    }

    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(part.position.x, part.position.y, part.position.z)
      .setLinearDamping(1.8)
      .setAngularDamping(2.4);
    const body = world.createRigidBody(bodyDesc);
    const [hx, hy, hz] = part.spec.colliderHalfExtents;
    const colDesc = R.ColliderDesc.cuboid(hx, hy, hz)
      .setDensity(part.spec.mass * 4)
      .setFriction(0.7)
      .setRestitution(0.18);
    world.createCollider(colDesc, body);
    part.rigidBody = body;
  }

  private buildSpatialControlCard() {
    const t = TRANSLATIONS[this.currentLang].spatialCard;
    const card = new xb.UICard({
      size: { width: 0.62, height: 'auto' },
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 10,
        padding: 18,
        backgroundColor: '#0f172a',
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#1e3a5f',
      },
    });
    card.position.set(-0.78, 1.32, -0.95);
    card.rotation.y = 0.42;

    this.uiTitleText = new xb.UIText({
      text: t.title,
      style: { fontSize: 22, color: '#38bdf8', fontWeight: 'bold' },
    });
    this.uiModuleText = new xb.UIText({
      text: `${t.moduleLabel}: Turbine`,
      style: { fontSize: 16, color: '#e2e8f0' },
    });
    this.uiProgressText = new xb.UIText({
      text: `${t.progress}: 0 / 5`,
      style: { fontSize: 15, color: '#34d399' },
    });
    this.uiPartText = new xb.UIText({
      text: 'Part: -',
      style: { fontSize: 14, color: '#94a3b8' },
    });

    const moduleRow = new xb.UIPanel({
      style: { flexDirection: 'row', gap: 6, width: '100%' },
    });
    const modEntries: Array<{ id: BuiltinModuleId; label: string }> = [
      { id: 'turbine', label: 'Turbine' },
      { id: 'gearbox', label: 'Gearbox' },
      { id: 'robotarm', label: 'Robot' },
      { id: 'spectrometer', label: 'Optics' },
    ];
    for (const m of modEntries) {
      const btn = new xb.UIButton({
        label: m.label,
        style: { flexGrow: 1, paddingLeft: 8, paddingRight: 8, height: 34, fontSize: 13 },
        onClick: () => this.switchModule(m.id, true),
      });
      this.uiModuleButtons.set(m.id, btn);
      moduleRow.add(btn);
    }

    this.uiExplodedSlider = new xb.UISlider({
      ariaLabel: t.exploded,
      min: 0,
      max: 1,
      step: 0.05,
      value: 0,
      style: { width: '100%' },
      onInput: (v) => this.setExplodedAmount(v, true),
      onChange: (v) => this.setExplodedAmount(v, true),
    });

    const actionRowTop = new xb.UIPanel({
      style: { flexDirection: 'row', gap: 8, width: '100%' },
    });
    const actionRowBottom = new xb.UIPanel({
      style: { flexDirection: 'row', gap: 8, width: '100%' },
    });
    const actionRowRecord = new xb.UIPanel({
      style: { flexDirection: 'row', gap: 8, width: '100%' },
    });
    this.uiSnapBtn = new xb.UIButton({
      label: t.autoSnap,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => this.snapNextPart(),
    });
    this.uiResetBtn = new xb.UIButton({
      label: t.reset,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => this.resetAssembly(true),
    });
    this.uiVoiceCmdBtn = new xb.UIButton({
      label: TRANSLATIONS[this.currentLang].voiceCmd.btnOff,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => {
        voiceCommandEngine.toggle();
        this.refreshSpatialCardText();
      },
    });
    this.uiRokidBtn = new xb.UIButton({
      label: t.rokidMode,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => this.toggleRokidMode(),
    });
    this.uiVoiceBtn = new xb.UIButton({
      label: `${t.voiceMode}: OFF`,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => void this.toggleSpatialVoice(),
    });
    this.uiLangBtn = new xb.UIButton({
      label: `${t.langLabel}: EN`,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => {
        const order: SupportedLang[] = ['en', 'ru', 'de'];
        const next = order[(order.indexOf(this.currentLang) + 1) % order.length];
        this.setLanguage(next);
      },
    });
    this.uiRecBtn = new xb.UIButton({
      label: t.recordStart,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => void this.toggleRecording(),
    });
    this.uiReplayBtn = new xb.UIButton({
      label: t.replayStart,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => {
        if (this.recorder.isPlayingOrPaused()) {
          this.togglePlaybackPause();
        } else {
          const latest = offlineStore.getLocalRecordings()[0];
          if (latest) {
            this.playRecording(latest);
          } else {
            this.setActionToast(TRANSLATIONS[this.currentLang].recordings.empty);
          }
        }
      },
    });
    this.uiVrModeBtn = new xb.UIButton({
      label: `${t.vrMode}: OFF`,
      style: { flexGrow: 1, paddingLeft: 10, paddingRight: 10, height: 36, fontSize: 13 },
      onClick: () => this.cycleVrMode(),
    });
    actionRowTop.add(this.uiSnapBtn, this.uiResetBtn, this.uiVoiceCmdBtn);
    actionRowBottom.add(this.uiRokidBtn, this.uiVoiceBtn, this.uiLangBtn);
    actionRowRecord.add(this.uiRecBtn, this.uiReplayBtn, this.uiVrModeBtn);

    card.add(
      this.uiTitleText,
      this.uiModuleText,
      this.uiProgressText,
      this.uiPartText,
      moduleRow,
      this.uiExplodedSlider,
      actionRowTop,
      actionRowBottom,
      actionRowRecord,
    );

    this.spatialCard = card;
    this.add(card);
  }

  private async toggleSpatialVoice() {
    const snap = voiceChatManager.getSnapshot();
    if (!snap.voiceEnabled) {
      await voiceChatManager.enableVoice();
    } else {
      voiceChatManager.toggleMute();
    }
    this.refreshSpatialCardText();
  }

  private refreshSpatialCardText() {
    const bundle = TRANSLATIONS[this.currentLang];
    const t = bundle.spatialCard;
    if (this.uiTitleText) this.uiTitleText.text = t.title;
    if (this.uiModuleText) {
      this.uiModuleText.text = `${t.moduleLabel}: ${bundle.modules[this.activeModule.titleKey]}`;
    }
    const snappedCount = this.partNodes.filter((p) => p.snapped).length;
    if (this.uiProgressText) {
      this.uiProgressText.text = `${t.progress}: ${snappedCount} / ${this.partNodes.length}`;
      this.uiProgressText.style.color = this.completed ? '#34d399' : '#38bdf8';
    }
    if (this.uiPartText) {
      this.uiPartText.text = this.lastActionToast || this.lastSelectedPartLabel || '-';
    }
    if (this.uiSnapBtn) this.uiSnapBtn.label = t.autoSnap;
    if (this.uiResetBtn) this.uiResetBtn.label = t.reset;
    if (this.uiVoiceCmdBtn) {
      const vcs = voiceCommandEngine.getSnapshot();
      this.uiVoiceCmdBtn.label = !vcs.supported
        ? bundle.voiceCmd.btnUnsupported
        : vcs.active
          ? bundle.voiceCmd.btnOn
          : bundle.voiceCmd.btnOff;
    }
    if (this.uiRokidBtn) {
      this.uiRokidBtn.label = `${t.rokidMode}: ${rokidManager.settings.enabled ? 'ON' : 'OFF'}`;
    }
    if (this.uiVoiceBtn) {
      const vs = voiceChatManager.getSnapshot();
      const voiceSuffix = !vs.voiceEnabled ? 'OFF' : vs.muted ? 'MUTE' : 'ON';
      this.uiVoiceBtn.label = `${t.voiceMode}: ${voiceSuffix}`;
    }
    if (this.uiLangBtn) {
      this.uiLangBtn.label = `${t.langLabel}: ${this.currentLang.toUpperCase()}`;
    }
    const recMode = this.recorder.getMode();
    if (this.uiRecBtn) {
      this.uiRecBtn.label = recMode === 'recording' ? t.recordStop : t.recordStart;
    }
    if (this.uiReplayBtn) {
      this.uiReplayBtn.label =
        recMode === 'playing'
          ? t.replayPause
          : recMode === 'paused'
            ? t.replayResume
            : t.replayStart;
    }
    if (this.uiVrModeBtn) {
      const vm = vrModeManager.getMode();
      const suffix = vm === 'horizontal_sbs' ? 'SBS' : vm === 'monoscopic' ? 'MONO' : 'OFF';
      this.uiVrModeBtn.label = `${t.vrMode}: ${suffix}`;
    }
  }

  setLanguage(lang: SupportedLang) {
    this.currentLang = lang;
    voiceCommandEngine.setLanguage(lang);
    this.refreshSpatialCardText();
    this.emitState();
  }

  cycleModule() {
    const order: BuiltinModuleId[] = ['turbine', 'gearbox', 'robotarm', 'spectrometer'];
    const idx = order.indexOf(this.activeModule.id);
    const next = order[(idx + 1) % order.length];
    this.switchModule(next, true);
  }

  setActionToast(message: string) {
    this.lastActionToast = message;
    this.refreshSpatialCardText();
    this.emitState();
  }

  toggleRokidMode() {
    const next = !rokidManager.settings.enabled;
    if (next && vrModeManager.isActive()) {
      vrModeManager.setMode('off');
    }
    rokidManager.setEnabled(next);
    this.refreshSpatialCardText();
    this.emitState();
  }

  setVrMode(mode: VrDisplayMode) {
    vrModeManager.setMode(mode);
    const vrT = TRANSLATIONS[this.currentLang].vrMode;
    this.lastActionToast =
      mode === 'horizontal_sbs'
        ? vrT.modeSbs
        : mode === 'monoscopic'
          ? vrT.modeMono
          : vrT.modeOff;
    this.refreshSpatialCardText();
    this.emitState();
  }

  cycleVrMode() {
    const next = vrModeManager.cycleMode();
    const vrT = TRANSLATIONS[this.currentLang].vrMode;
    this.lastActionToast =
      next === 'horizontal_sbs'
        ? vrT.modeSbs
        : next === 'monoscopic'
          ? vrT.modeMono
          : vrT.modeOff;
    this.refreshSpatialCardText();
    this.emitState();
  }

  recenterCameraView() {
    rokidManager.recenterImuHeading();
    const cam = xb.core.camera;
    if (!cam || xb.core.renderer?.xr?.isPresenting) return;
    cam.position.set(0, 1.55, 0.45);
    cam.lookAt(this.workbenchOrigin.x, this.workbenchOrigin.y, this.workbenchOrigin.z);
  }

  toggleXrPassthrough() {
    const trans = xb.core.transition;
    if (!trans) return;
    if (trans.currentMode === 'AR') {
      trans.toVR({ color: 0x0b101b });
    } else {
      trans.toAR();
    }
  }

  onXRSessionStarted() {
    audioEngine.resume();
    const caps = getCachedPlatformCapabilities();
    const scene = xb.core.scene;
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    if (caps.preferredXrMode === 'immersive-ar' && scene) {
      scene.background = null;
      scene.fog = null;
      if (renderer && 'setClearAlpha' in renderer) {
        renderer.setClearAlpha(0);
      }
    }
    this.emitState();
  }

  onXRSessionEnded() {
    const scene = xb.core.scene;
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    if (scene && !rokidManager.settings.enabled) {
      scene.background = new THREE.Color(0x0b101b);
      scene.fog = new THREE.FogExp2(0x0b101b, 0.045);
    }
    if (renderer && 'setClearAlpha' in renderer) {
      renderer.setClearAlpha(1);
    }
    this.emitState();
  }

  getActiveDeviceProfile(): DeviceProfile {
    if (rokidManager.settings.enabled) return 'rokid_max';
    if (vrModeManager.isActive() || xb.core.renderer?.xr?.isPresenting) return 'vr_headset';
    if (window.innerWidth <= 768) return 'mobile';
    return 'desktop';
  }

  switchModule(moduleId: BuiltinModuleId, broadcast = false) {
    if (moduleId === 'custom' && !this.customModuleDef) return;
    this.loadModule(moduleId, broadcast);
  }

  importQrModel(name: string, parts: CustomQrPartDef[]) {
    this.customModuleDef = buildCustomModuleFromQr(name, parts);
    this.loadModule('custom', true);
    this.lastActionToast = `QR Model: ${name}`;
    void logAnalyticsEvent({
      moduleId: 'custom',
      actionType: 'qr_imported',
      accuracyPct: 100,
      durationMs: 0,
      collisions: 0,
      deviceMode: this.getActiveDeviceProfile(),
    });
    this.emitState();
  }

  importQrRoomBounds(bounds: RoomBoundsSpec) {
    this.currentRoomBounds = { ...bounds };
    this.renderRoomBoundsVisual();
    const label = bounds.name ? `${bounds.name}: ` : 'Room Scale: ';
    this.lastActionToast = `${label}${bounds.width.toFixed(1)}×${bounds.depth.toFixed(1)}×${bounds.height.toFixed(1)}m`;
    void logAnalyticsEvent({
      moduleId: this.activeModule.id,
      actionType: 'qr_imported',
      accuracyPct: 100,
      durationMs: 0,
      collisions: 0,
      deviceMode: this.getActiveDeviceProfile(),
    });
    this.emitState();
  }

  private renderRoomBoundsVisual() {
    while (this.roomBoundaryGroup.children.length > 0) {
      const ch = this.roomBoundaryGroup.children[0];
      this.roomBoundaryGroup.remove(ch);
      if (ch instanceof THREE.LineSegments || ch instanceof THREE.Mesh) {
        ch.geometry.dispose();
        const mat = ch.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    }

    const { width, depth, height, originX, originY, originZ, yawDeg = 0 } = this.currentRoomBounds;
    this.roomBoundaryGroup.position.set(originX, originY, originZ);
    this.roomBoundaryGroup.rotation.set(0, THREE.MathUtils.degToRad(yawDeg), 0);

    // Outer calibrated room-scale volume wireframe
    const box = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(box);
    const lines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.45 }),
    );
    lines.position.set(0, height * 0.5, 0);
    this.roomBoundaryGroup.add(lines);
    box.dispose();

    // Grounded translucent floor safety perimeter (polygonOffset prevents z-fighting)
    const floorGeo = new THREE.PlaneGeometry(width, depth);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, 0.005, 0);
    this.roomBoundaryGroup.add(floorMesh);

    // 4 instanced corner calibration beacons
    const pylonH = Math.min(0.45, height * 0.25);
    const pylonGeo = new THREE.CylinderGeometry(0.018, 0.024, pylonH, 12);
    const pylonMat = new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      roughness: 0.3,
      metalness: 0.5,
    });
    const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, 4);
    const dummy = new THREE.Object3D();
    const hw = width * 0.5;
    const hd = depth * 0.5;
    const corners: Array<[number, number]> = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    for (let i = 0; i < 4; i++) {
      dummy.position.set(corners[i][0], pylonH * 0.5, corners[i][1]);
      dummy.updateMatrix();
      pylons.setMatrixAt(i, dummy.matrix);
    }
    pylons.instanceMatrix.needsUpdate = true;
    pylons.computeBoundingSphere();
    this.roomBoundaryGroup.add(pylons);
  }

  private clearActiveParts() {
    for (const part of this.partNodes) {
      if (part.rigidBody && this.physicsRef) {
        try {
          this.physicsRef.blendedWorld.removeRigidBody(part.rigidBody);
        } catch {
          // Ignore cleanup
        }
      }
      this.remove(part);
      this.remove(part.ghostMesh);
      part.ghostMesh.geometry.dispose();
      part.ghostMat.dispose();
    }
    this.partNodes = [];
  }

  private loadModule(moduleId: BuiltinModuleId, broadcast: boolean) {
    if (this.recorder.isPlayingOrPaused()) {
      this.recorder.exitPlayback();
      this.playbackTrailGroup.visible = false;
    } else if (this.recorder.isRecording()) {
      this.recorder.cancelRecording();
    }
    this.clearActiveParts();
    this.activeModule =
      moduleId === 'custom' && this.customModuleDef
        ? this.customModuleDef
        : SIMULATION_MODULES[moduleId === 'custom' ? 'turbine' : moduleId];
    this.explodedTarget = 0;
    this.explodedCurrent = 0;
    this.completed = false;
    this.collisions = 0;
    this.accuracySamples = [];
    this.moduleStartMs = performance.now();
    this.lastSelectedPartLabel = '';
    if (this.opticalBeamMesh) this.opticalBeamMesh.visible = false;
    if (this.uiExplodedSlider) this.uiExplodedSlider.value = 0;

    for (let i = 0; i < this.activeModule.parts.length; i++) {
      const spec = this.activeModule.parts[i];
      const visual = spec.buildMesh(this.materials, this.isSoftwareGl);
      visual.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = !this.isSoftwareGl;
          obj.receiveShadow = true;
        }
      });

      const [hx, hy, hz] = spec.colliderHalfExtents;
      const ghostGeo = new THREE.BoxGeometry(hx * 1.9, hy * 1.9, hz * 1.9);
      const ghostMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.22,
      });
      const ghostMesh = new THREE.Mesh(ghostGeo, ghostMat);
      this.getTargetWorldPosition(spec, _targetWorldPos);
      ghostMesh.position.copy(_targetWorldPos);
      this.add(ghostMesh);

      const node = new AssemblyPartNode(spec, visual, ghostMesh, ghostMat, this);
      // Root part (index 0) starts snapped as assembly anchor; others start on workbench
      if (i === 0) {
        node.snapped = true;
        node.position.copy(_targetWorldPos);
        ghostMesh.visible = false;
      } else {
        node.snapped = false;
        node.position.set(
          this.workbenchOrigin.x + spec.workbenchOffset[0],
          this.tabletopY + spec.colliderHalfExtents[1] + spec.workbenchOffset[1],
          this.workbenchOrigin.z + spec.workbenchOffset[2],
        );
      }

      this.add(node);
      this.partNodes.push(node);

      if (this.physicsRef) {
        this.createPartRigidBody(node);
        if (node.snapped && node.rigidBody) {
          node.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }
      }
    }

    if (broadcast) {
      multiplayerClient.send({ type: 'module:switch', moduleId: this.activeModule.id });
    }

    void logAnalyticsEvent({
      moduleId: this.activeModule.id,
      actionType: 'session_started',
      accuracyPct: 100,
      durationMs: 0,
      collisions: 0,
      deviceMode: this.getActiveDeviceProfile(),
    });

    this.refreshSpatialCardText();
    this.emitState();
  }

  getTargetWorldPosition(spec: AssemblyPartSpec, out: THREE.Vector3, explodedFactor = 0): THREE.Vector3 {
    out.set(
      this.workbenchOrigin.x + spec.targetOffset[0] + spec.explodedOffset[0] * explodedFactor,
      this.workbenchOrigin.y + spec.targetOffset[1] + spec.explodedOffset[1] * explodedFactor,
      this.workbenchOrigin.z + spec.targetOffset[2] + spec.explodedOffset[2] * explodedFactor,
    );
    return out;
  }

  notifyPartGrabbed(part: AssemblyPartNode) {
    if (this.recorder.isRecording()) {
      this.recorder.recordEvent(
        'grab',
        part.spec.id,
        part.spec.labels[this.currentLang],
        100,
        part.position,
        this.explodedCurrent,
        this.capturePartPoses(),
      );
    }
  }

  notifyPartSelected(spec: AssemblyPartSpec) {
    this.lastActionToast = '';
    this.lastSelectedPartLabel = spec.labels[this.currentLang];
    this.refreshSpatialCardText();
    this.emitState();
  }

  handlePartReleased(part: AssemblyPartNode) {
    this.getTargetWorldPosition(part.spec, _targetWorldPos);
    const dist = part.position.distanceTo(_targetWorldPos);

    if (dist <= part.spec.snapRadius) {
      const accuracy = Math.max(60, Math.min(100, 100 - (dist / part.spec.snapRadius) * 25));
      this.snapPart(part, accuracy, true);
    } else {
      // Drop under Rapier dynamic gravity
      if (part.rigidBody) {
        part.rigidBody.setTranslation(
          { x: part.position.x, y: Math.max(this.tabletopY + 0.05, part.position.y), z: part.position.z },
          true,
        );
        part.rigidBody.setRotation(
          { x: part.quaternion.x, y: part.quaternion.y, z: part.quaternion.z, w: part.quaternion.w },
          true,
        );
        part.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      }
      if (this.recorder.isRecording()) {
        this.recorder.recordEvent(
          'release',
          part.spec.id,
          part.spec.labels[this.currentLang],
          0,
          part.position,
          this.explodedCurrent,
          this.capturePartPoses(),
        );
      }
      multiplayerClient.send({
        type: 'part:release',
        partId: part.spec.id,
        pos: { x: part.position.x, y: part.position.y, z: part.position.z },
        quat: { x: part.quaternion.x, y: part.quaternion.y, z: part.quaternion.z, w: part.quaternion.w },
      });
    }
  }

  private snapPart(part: AssemblyPartNode, accuracyPct: number, broadcast: boolean) {
    part.snapped = true;
    part.isManipulated = false;
    part.ghostMesh.visible = false;
    this.getTargetWorldPosition(part.spec, _targetWorldPos, this.explodedCurrent);
    part.position.copy(_targetWorldPos);
    part.quaternion.identity();

    if (part.rigidBody) {
      part.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      part.rigidBody.setNextKinematicTranslation({
        x: part.position.x,
        y: part.position.y,
        z: part.position.z,
      });
      part.rigidBody.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    }

    this.accuracySamples.push(accuracyPct);
    part.getWorldPosition(_v1);
    audioEngine.playSnapAt(_v1, accuracyPct);

    if (this.recorder.isRecording()) {
      this.recorder.recordEvent(
        'snap',
        part.spec.id,
        part.spec.labels[this.currentLang],
        accuracyPct,
        part.position,
        this.explodedCurrent,
        this.capturePartPoses(),
      );
    }

    if (broadcast) {
      multiplayerClient.send({
        type: 'part:snap',
        partId: part.spec.id,
        pos: { x: part.position.x, y: part.position.y, z: part.position.z },
        quat: { x: 0, y: 0, z: 0, w: 1 },
      });
    }

    const elapsed = performance.now() - this.moduleStartMs;
    void logAnalyticsEvent({
      moduleId: this.activeModule.id,
      actionType: 'part_snapped',
      accuracyPct,
      durationMs: elapsed,
      collisions: this.collisions,
      deviceMode: this.getActiveDeviceProfile(),
    });

    this.checkCompletion();
    this.refreshSpatialCardText();
    this.emitState();
  }

  private checkCompletion() {
    const allSnapped = this.partNodes.length > 0 && this.partNodes.every((p) => p.snapped);
    if (allSnapped && !this.completed) {
      this.completed = true;
      audioEngine.playModuleCompleteAt(this.workbenchOrigin);
      if (this.opticalBeamMesh) {
        this.opticalBeamMesh.visible = this.activeModule.id === 'spectrometer';
      }
      const avg =
        this.accuracySamples.length > 0
          ? this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
          : 100;
      if (this.recorder.isRecording()) {
        this.recorder.recordEvent(
          'complete',
          this.activeModule.id,
          TRANSLATIONS[this.currentLang].modules[this.activeModule.titleKey],
          avg,
          this.workbenchOrigin,
          this.explodedCurrent,
          this.capturePartPoses(),
        );
      }
      void logAnalyticsEvent({
        moduleId: this.activeModule.id,
        actionType: 'module_completed',
        accuracyPct: avg,
        durationMs: performance.now() - this.moduleStartMs,
        collisions: this.collisions,
        deviceMode: this.getActiveDeviceProfile(),
      });
    }
  }

  snapNextPart() {
    if (this.recorder.isPlayingOrPaused()) return;
    const next = this.partNodes.find((p) => !p.snapped);
    if (!next) return;
    this.snapPart(next, 98.5, true);
  }

  autoAssembleAll() {
    if (this.recorder.isPlayingOrPaused()) return;
    for (const part of this.partNodes) {
      if (!part.snapped) {
        this.snapPart(part, 100, true);
      }
    }
  }

  resetAssembly(broadcast = true) {
    this.loadModule(this.activeModule.id, false);
    if (broadcast) {
      multiplayerClient.send({ type: 'room:reset' });
    }
  }

  setExplodedAmount(amount: number, broadcast = false) {
    if (this.recorder.isPlayingOrPaused()) return;
    this.explodedTarget = THREE.MathUtils.clamp(amount, 0, 1);
    if (this.uiExplodedSlider) this.uiExplodedSlider.value = this.explodedTarget;
    if (this.recorder.isRecording()) {
      this.recorder.recordEvent(
        'exploded',
        this.activeModule.id,
        `${Math.round(this.explodedTarget * 100)}%`,
        100,
        this.workbenchOrigin,
        this.explodedTarget,
        this.capturePartPoses(),
      );
    }
    if (broadcast) {
      multiplayerClient.send({ type: 'exploded:change', amount: this.explodedTarget });
    }
    this.emitState();
  }

  triggerCameraGestureAction(gesture: string) {
    if (gesture === 'Thumb_Up') {
      this.snapNextPart();
      this.lastActionToast = 'Gesture: Snap Next';
    } else if (gesture === 'Victory') {
      this.setExplodedAmount(this.explodedTarget > 0.3 ? 0 : 0.85, true);
      this.lastActionToast = 'Gesture: Exploded View';
    } else if (gesture === 'ILoveYou') {
      this.resetAssembly(true);
      this.lastActionToast = 'Gesture: Reset Assembly';
    } else if (gesture === 'Closed_Fist') {
      this.lastActionToast = 'Gesture: Grab Ready';
    }
    void logAnalyticsEvent({
      moduleId: this.activeModule.id,
      actionType: 'gesture_triggered',
      accuracyPct: 100,
      durationMs: 0,
      collisions: this.collisions,
      deviceMode: this.getActiveDeviceProfile(),
    });
    this.emitState();
  }

  exportCurrentTransforms(): PartTransformRecord[] {
    return this.partNodes.map((p) => ({
      id: p.spec.id,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      snapped: p.snapped,
    }));
  }

  applySavedMapping(mapping: SavedSpatialMapping) {
    this.currentRoomBounds = { ...mapping.roomBounds };
    this.renderRoomBoundsVisual();
    rokidManager.updateSettings({
      fovDegrees: mapping.rokidProfile.fov,
      ipdMm: mapping.rokidProfile.ipdMm,
      sbsStereo: mapping.rokidProfile.sbsMode,
    });
    const modId = (mapping.moduleId as BuiltinModuleId) || 'turbine';
    if (modId in SIMULATION_MODULES) {
      this.loadModule(modId, false);
    }
    for (const saved of mapping.partTransforms) {
      const part = this.partNodes.find((p) => p.spec.id === saved.id);
      if (part) {
        part.position.set(saved.x, saved.y, saved.z);
        part.snapped = saved.snapped;
        part.ghostMesh.visible = !saved.snapped;
        if (part.rigidBody) {
          part.rigidBody.setTranslation({ x: saved.x, y: saved.y, z: saved.z }, true);
          part.rigidBody.setBodyType(
            saved.snapped
              ? RAPIER.RigidBodyType.KinematicPositionBased
              : RAPIER.RigidBodyType.Dynamic,
            true,
          );
        }
      }
    }
    this.checkCompletion();
    this.refreshSpatialCardText();
    this.emitState();
  }

  addLocalAnnotation(text: string) {
    if (!text.trim()) return;
    multiplayerClient.send({
      type: 'annotation:add',
      text: text.trim().slice(0, 80),
      pos: {
        x: this.workbenchOrigin.x,
        y: this.workbenchOrigin.y + 0.36,
        z: this.workbenchOrigin.z,
      },
    });
  }

  private renderAnnotation(ann: SpatialAnnotation) {
    const marker = new THREE.Group();
    marker.position.set(ann.pos.x, ann.pos.y, ann.pos.z);
    const pin = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.024, 0),
      new THREE.MeshBasicMaterial({ color: ann.color || '#38bdf8' }),
    );
    marker.add(pin);
    const card = new xb.UICard({
      size: { width: 0.34, height: 'auto' },
      style: { padding: 8, backgroundColor: '#0f172a', borderRadius: 10 },
      children: [
        new xb.UIText({
          text: `${ann.author}: ${ann.text}`,
          style: { fontSize: 14, color: '#f8fafc' },
        }),
      ],
    });
    card.position.set(0, 0.08, 0);
    card.add(new xb.FaceCamera({ mode: 'spherical' }));
    marker.add(card);
    this.annotationContainer.add(marker);
  }

  private syncRemoteAvatars(peers: PeerInfo[]) {
    const selfId = multiplayerClient.getSelfId();
    const keepIds = new Set<string>();
    for (const peer of peers) {
      if (peer.id === selfId) continue;
      keepIds.add(peer.id);
      if (!this.remoteAvatars.has(peer.id)) {
        const g = new THREE.Group();
        const visorMat = new THREE.MeshPhysicalMaterial({
          color: peer.color,
          metalness: 0.5,
          roughness: 0.2,
          clearcoat: 0.9,
        });
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.11), visorMat);
        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(0.11, 0.008, 8, 24),
          new THREE.MeshBasicMaterial({ color: peer.color }),
        );
        halo.rotation.x = Math.PI / 2;
        halo.position.y = 0.08;
        const nameText = new xb.UIText({
          text: peer.name,
          style: { fontSize: 13, color: peer.color },
        });
        const nameCard = new xb.UICard({
          size: { width: 0.28, height: 'auto' },
          style: { padding: 6, backgroundColor: '#0f172a', borderRadius: 8 },
          children: [nameText],
        });
        nameCard.position.set(0, 0.16, 0);
        nameCard.add(new xb.FaceCamera({ mode: 'spherical' }));

        const handSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.025, 12, 12),
          new THREE.MeshBasicMaterial({ color: peer.color }),
        );
        handSphere.visible = false;
        this.avatarContainer.add(handSphere);

        g.add(head, halo, nameCard);
        g.position.set(peer.headPos.x, peer.headPos.y, peer.headPos.z);
        this.avatarContainer.add(g);

        this.remoteAvatars.set(peer.id, {
          group: g,
          halo,
          nameText,
          peerName: peer.name,
          voiceEnabled: Boolean(peer.voiceEnabled),
          voiceMuted: Boolean(peer.muted),
          lastHudLabel: peer.name,
          targetHeadPos: new THREE.Vector3(peer.headPos.x, peer.headPos.y, peer.headPos.z),
          targetHeadQuat: new THREE.Quaternion(
            peer.headQuat.x,
            peer.headQuat.y,
            peer.headQuat.z,
            peer.headQuat.w,
          ),
          handSphere,
          hasHand: false,
          targetHandPos: new THREE.Vector3(),
        });
        voiceChatManager.attachPeerPositionalAudio(peer.id, g);
      }
      const av = this.remoteAvatars.get(peer.id);
      if (av) {
        av.peerName = peer.name;
        av.voiceEnabled = Boolean(peer.voiceEnabled);
        av.voiceMuted = Boolean(peer.muted);
        const suffix = peer.voiceEnabled ? (peer.muted ? ' [MUTE]' : ' [3D MIC]') : '';
        const nextLabel = `${peer.name}${suffix}`;
        if (nextLabel !== av.lastHudLabel) {
          av.lastHudLabel = nextLabel;
          av.nameText.text = nextLabel;
        }
      }
    }

    for (const [id, av] of this.remoteAvatars.entries()) {
      if (!keepIds.has(id)) {
        voiceChatManager.detachPeerPositionalAudio(id);
        this.avatarContainer.remove(av.group);
        this.avatarContainer.remove(av.handSphere);
        this.remoteAvatars.delete(id);
      }
    }
  }

  private handleMultiplayerEvent(ev: MultiplayerEvent) {
    const selfId = multiplayerClient.getSelfId();
    if (ev.type === 'connected') {
      if (ev.room.moduleId && ev.room.moduleId !== this.activeModule.id) {
        const mod = ev.room.moduleId as BuiltinModuleId;
        if (mod in SIMULATION_MODULES) this.loadModule(mod, false);
      }
      this.explodedTarget = ev.room.explodedAmount ?? 0;
      this.syncRemoteAvatars(ev.room.participants);
      for (const ann of ev.room.annotations) {
        this.renderAnnotation(ann);
      }
      for (const rp of ev.room.parts) {
        const localPart = this.partNodes.find((p) => p.spec.id === rp.id);
        if (localPart) {
          localPart.position.set(rp.pos.x, rp.pos.y, rp.pos.z);
          localPart.quaternion.set(rp.quat.x, rp.quat.y, rp.quat.z, rp.quat.w);
          if (rp.snapped) this.snapPart(localPart, 100, false);
        }
      }
    } else if (ev.type === 'disconnected') {
      this.syncRemoteAvatars([]);
    } else if (ev.type === 'peers' || ev.type === 'voice:state') {
      this.syncRemoteAvatars(ev.participants);
    } else if (ev.type === 'avatar:pose') {
      const av = this.remoteAvatars.get(ev.clientId);
      if (av) {
        av.targetHeadPos.set(ev.headPos.x, ev.headPos.y, ev.headPos.z);
        av.targetHeadQuat.set(ev.headQuat.x, ev.headQuat.y, ev.headQuat.z, ev.headQuat.w);
        if (ev.handPos) {
          av.hasHand = true;
          av.targetHandPos.set(ev.handPos.x, ev.handPos.y, ev.handPos.z);
        } else {
          av.hasHand = false;
        }
      }
    } else if (ev.type === 'part:grab' && ev.clientId !== selfId) {
      const part = this.partNodes.find((p) => p.spec.id === ev.partId);
      if (part) part.lockedByPeer = ev.clientId;
    } else if (ev.type === 'part:move' && ev.clientId !== selfId) {
      const part = this.partNodes.find((p) => p.spec.id === ev.partId);
      if (part) {
        part.snapped = false;
        part.position.set(ev.pos.x, ev.pos.y, ev.pos.z);
        part.quaternion.set(ev.quat.x, ev.quat.y, ev.quat.z, ev.quat.w);
        if (part.rigidBody) {
          part.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
          part.rigidBody.setNextKinematicTranslation(ev.pos);
          part.rigidBody.setNextKinematicRotation(ev.quat);
        }
      }
    } else if (ev.type === 'part:snap' && ev.clientId !== selfId) {
      const part = this.partNodes.find((p) => p.spec.id === ev.partId);
      if (part) {
        part.lockedByPeer = null;
        this.snapPart(part, 100, false);
      }
    } else if (ev.type === 'part:release' && ev.clientId !== selfId) {
      const part = this.partNodes.find((p) => p.spec.id === ev.partId);
      if (part) {
        part.lockedByPeer = null;
        if (ev.pos) part.position.set(ev.pos.x, ev.pos.y, ev.pos.z);
        if (ev.quat) part.quaternion.set(ev.quat.x, ev.quat.y, ev.quat.z, ev.quat.w);
      }
    } else if (ev.type === 'module:switch' && ev.clientId !== selfId) {
      const mod = ev.moduleId as BuiltinModuleId;
      if (mod in SIMULATION_MODULES) this.loadModule(mod, false);
    } else if (ev.type === 'exploded:change' && ev.clientId !== selfId) {
      this.setExplodedAmount(ev.amount, false);
    } else if (ev.type === 'room:reset' && ev.clientId !== selfId) {
      this.loadModule(this.activeModule.id, false);
    } else if (ev.type === 'annotation:add') {
      this.renderAnnotation(ev.annotation);
    }
  }

  private setupPlaybackTrailVisuals() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(this.playbackTrailPositions, 3),
    );
    geom.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    this.playbackTrailLine = new THREE.Line(geom, mat);
    this.playbackTrailLine.frustumCulled = false;

    const ringGeo = new THREE.RingGeometry(0.036, 0.052, 28);
    ringGeo.rotateX(-Math.PI / 2);
    this.playbackEventMarkerMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.playbackEventMarker = new THREE.Mesh(ringGeo, this.playbackEventMarkerMat);
    this.playbackEventMarker.visible = false;

    this.playbackTrailGroup.add(this.playbackTrailLine, this.playbackEventMarker);
    this.playbackTrailGroup.visible = false;
  }

  private capturePartPoses(): SpatialFramePartPose[] {
    return this.partNodes.map((p) => ({
      id: p.spec.id,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      qx: p.quaternion.x,
      qy: p.quaternion.y,
      qz: p.quaternion.z,
      qw: p.quaternion.w,
      snapped: p.snapped,
    }));
  }

  startSpatialRecording() {
    if (this.recorder.isPlayingOrPaused()) {
      this.exitPlayback();
    }
    if (this.recorder.isRecording()) return;
    audioEngine.resume();
    this.recorder.startRecording(
      this.activeModule.id,
      this.getActiveDeviceProfile(),
      this.capturePartPoses(),
      this.explodedCurrent,
    );
    this.lastActionToast = TRANSLATIONS[this.currentLang].recordings.recordingStarted;
    this.refreshSpatialCardText();
    this.emitState();
  }

  async stopAndSaveSpatialRecording(name?: string, isShared = false): Promise<SpatialRecording | null> {
    if (!this.recorder.isRecording()) return null;
    const avgAcc =
      this.accuracySamples.length > 0
        ? this.accuracySamples.reduce((a, b) => a + b, 0) / this.accuracySamples.length
        : 100;
    const defaultName = `${TRANSLATIONS[this.currentLang].modules[this.activeModule.titleKey]} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const payload = this.recorder.stopRecording(
      name?.trim() || defaultName,
      isShared,
      this.capturePartPoses(),
      this.explodedCurrent,
      avgAcc,
    );
    const saved = await saveSpatialRecording(payload).catch(() =>
      offlineStore.getLocalRecordings()[0] ?? null,
    );
    if (saved) {
      for (const cb of this.recordingSavedListeners) cb(saved);
      this.lastActionToast = `${TRANSLATIONS[this.currentLang].recordings.savedPrefix}: ${saved.name}`;
    }
    this.refreshSpatialCardText();
    this.emitState();
    return saved;
  }

  async toggleRecording(name?: string, isShared = false): Promise<SpatialRecording | null> {
    if (this.recorder.isRecording()) {
      return this.stopAndSaveSpatialRecording(name, isShared);
    }
    this.startSpatialRecording();
    return null;
  }

  playRecording(recording: SpatialRecording) {
    if (!recording.frames || recording.frames.length === 0) return;
    audioEngine.resume();
    if (this.recorder.isRecording()) {
      this.recorder.cancelRecording();
    }
    if (recording.moduleId === 'custom' && this.customModuleDef) {
      this.loadModule('custom', false);
    } else if (recording.moduleId in SIMULATION_MODULES) {
      this.loadModule(recording.moduleId as BuiltinModuleId, false);
    }

    const evaluated = this.recorder.loadForPlayback(recording, true);
    for (const part of this.partNodes) {
      if (part.rigidBody) {
        part.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      }
    }
    if (evaluated) {
      this.applyPlaybackEvaluation(evaluated);
    }
    this.playbackTrailGroup.visible = true;
    this.lastActionToast = `▶ ${recording.name}`;
    this.refreshSpatialCardText();
    this.emitState();
  }

  togglePlaybackPause() {
    if (!this.recorder.isPlayingOrPaused()) return;
    audioEngine.resume();
    this.recorder.togglePlayPause();
    this.refreshSpatialCardText();
    this.emitState();
  }

  seekPlayback(ms: number) {
    const evaluated = this.recorder.seek(ms);
    if (evaluated) {
      this.applyPlaybackEvaluation(evaluated);
      this.refreshSpatialCardText();
      this.emitState();
    }
  }

  setPlaybackSpeed(speed: number) {
    this.recorder.setSpeed(speed);
  }

  stepPlaybackEvent(direction: 1 | -1) {
    audioEngine.resume();
    const res = this.recorder.stepToEvent(direction);
    if (!res) return;
    this.applyPlaybackEvaluation(res.evaluated);
    this.triggerPlaybackEventFeedback(res.event);
    this.refreshSpatialCardText();
    this.emitState();
  }

  exitPlayback() {
    if (!this.recorder.isPlayingOrPaused() && !this.recorder.getActiveRecording()) return;
    this.recorder.exitPlayback();
    this.playbackTrailGroup.visible = false;
    if (this.playbackEventMarker) this.playbackEventMarker.visible = false;
    this.loadModule(this.activeModule.id, false);
    this.lastActionToast = '';
    this.refreshSpatialCardText();
    this.emitState();
  }

  private applyPlaybackEvaluation(evaluated: EvaluatedPlaybackPose) {
    this.explodedCurrent = evaluated.exploded;
    this.explodedTarget = evaluated.exploded;
    if (this.uiExplodedSlider) this.uiExplodedSlider.value = evaluated.exploded;

    for (const part of this.partNodes) {
      const pose = evaluated.parts.get(part.spec.id);
      if (!pose) continue;
      part.position.set(pose.x, pose.y, pose.z);
      part.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
      part.snapped = pose.snapped;
      part.isManipulated = false;
      part.ghostMesh.visible = !pose.snapped;
      if (part.rigidBody) {
        if (part.rigidBody.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) {
          part.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        }
        part.rigidBody.setNextKinematicTranslation({ x: pose.x, y: pose.y, z: pose.z });
        part.rigidBody.setNextKinematicRotation({ x: pose.qx, y: pose.qy, z: pose.qz, w: pose.qw });
      }
    }

    const allSnapped = this.partNodes.length > 0 && this.partNodes.every((p) => p.snapped);
    this.completed = allSnapped;
    if (this.opticalBeamMesh) {
      this.opticalBeamMesh.visible = allSnapped && this.activeModule.id === 'spectrometer';
    }

    this.updatePlaybackTrajectoryTrail(evaluated.activePartId);
  }

  private updatePlaybackTrajectoryTrail(activePartId: string | null) {
    if (!this.playbackTrailLine || !activePartId) {
      if (this.playbackTrailLine) {
        this.playbackTrailLine.geometry.setDrawRange(0, 0);
      }
      return;
    }
    const pts = this.recorder.getTrajectoryPoints(activePartId);
    const maxPts = Math.min(pts.length, 452);
    for (let i = 0; i < maxPts; i++) {
      this.playbackTrailPositions[i * 3] = pts[i].x;
      this.playbackTrailPositions[i * 3 + 1] = pts[i].y;
      this.playbackTrailPositions[i * 3 + 2] = pts[i].z;
    }
    const attr = this.playbackTrailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.playbackTrailLine.geometry.setDrawRange(0, maxPts);
  }

  private triggerPlaybackEventFeedback(ev: SpatialRecordingEvent) {
    _v1.set(ev.x, ev.y, ev.z);
    if (ev.type === 'snap') {
      audioEngine.playSnapAt(_v1, ev.accuracyPct || 95);
    } else if (ev.type === 'collision') {
      audioEngine.playCollisionAt(_v1, 0.72);
    } else if (ev.type === 'complete') {
      audioEngine.playModuleCompleteAt(this.workbenchOrigin);
    }

    if (this.playbackEventMarker && this.playbackEventMarkerMat) {
      this.playbackEventMarker.position.set(ev.x, Math.max(this.tabletopY + 0.008, ev.y), ev.z);
      this.playbackEventMarker.visible = true;
      this.playbackMarkerPulse = 1.0;
      const colorHex =
        ev.type === 'snap' || ev.type === 'complete'
          ? 0x34d399
          : ev.type === 'collision'
            ? 0xf59e0b
            : 0x38bdf8;
      this.playbackEventMarkerMat.color.setHex(colorHex);
    }
    this.lastActionToast = `${ev.type.toUpperCase()}: ${ev.partLabel || ev.partId}`;
  }

  physicsStep() {
    if (this.recorder.isPlayingOrPaused()) return;
    for (const part of this.partNodes) {
      if (!part.rigidBody || part.isManipulated || part.snapped || part.lockedByPeer) continue;
      if (part.rigidBody.bodyType() === RAPIER.RigidBodyType.Dynamic) {
        const t = part.rigidBody.translation();
        const r = part.rigidBody.rotation();
        const prevY = part.position.y;
        part.position.set(t.x, t.y, t.z);
        part.quaternion.set(r.x, r.y, r.z, r.w);

        // Detect tabletop bounce/impact
        const v = part.rigidBody.linvel();
        if (prevY > this.tabletopY + 0.08 && t.y <= this.tabletopY + 0.08 && Math.abs(v.y) > 0.35) {
          this.collisions += 1;
          part.getWorldPosition(_v1);
          audioEngine.playCollisionAt(_v1, Math.min(1, Math.abs(v.y) / 3));
          if (this.recorder.isRecording()) {
            this.recorder.recordEvent(
              'collision',
              part.spec.id,
              part.spec.labels[this.currentLang],
              0,
              part.position,
              this.explodedCurrent,
              this.capturePartPoses(),
            );
          }
        }

        // Safety floor recovery
        if (t.y < 0.15) {
          part.rigidBody.setTranslation(
            {
              x: this.workbenchOrigin.x + part.spec.workbenchOffset[0],
              y: this.tabletopY + 0.12,
              z: this.workbenchOrigin.z + part.spec.workbenchOffset[2],
            },
            true,
          );
          part.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    }
  }

  update() {
    const dt = Math.min(0.05, xb.getDeltaTime() || 0.016);
    rokidManager.updatePerFrame(dt);
    vrModeManager.updatePerFrame(dt);
    audioEngine.syncListener(xb.core.camera);

    if (this.recorder.isPlayingOrPaused()) {
      if (this.recorder.getMode() === 'playing') {
        const res = this.recorder.advancePlayback(dt);
        if (res) {
          this.applyPlaybackEvaluation(res.evaluated);
          for (const ev of res.crossedEvents) {
            this.triggerPlaybackEventFeedback(ev);
          }
          if (res.reachedEnd) {
            this.refreshSpatialCardText();
            this.emitState();
          }
        }
      }
      if (this.playbackEventMarker && this.playbackEventMarker.visible) {
        this.playbackMarkerPulse = Math.max(0, this.playbackMarkerPulse - dt * 1.4);
        const s = 1 + (1 - this.playbackMarkerPulse) * 0.65;
        this.playbackEventMarker.scale.setScalar(s);
        if (this.playbackEventMarkerMat) {
          this.playbackEventMarkerMat.opacity = Math.max(0.15, this.playbackMarkerPulse * 0.9);
        }
      }
      for (const part of this.partNodes) {
        if (this.completed && part.snapped && part.spec.spinAxis && part.spec.spinSpeed) {
          if (part.spec.spinAxis === 'z') part.visualGroup.rotation.z += part.spec.spinSpeed * dt;
          else if (part.spec.spinAxis === 'y') part.visualGroup.rotation.y += part.spec.spinSpeed * dt;
          else part.visualGroup.rotation.x += part.spec.spinSpeed * dt;
        }
      }
    } else {
      // Smooth exponential damping for exploded-view inspection
      this.explodedCurrent = THREE.MathUtils.damp(this.explodedCurrent, this.explodedTarget, 8, dt);

      for (const part of this.partNodes) {
        if (part.snapped && !part.isManipulated) {
          this.getTargetWorldPosition(part.spec, _targetWorldPos, this.explodedCurrent);
          part.position.x = THREE.MathUtils.damp(part.position.x, _targetWorldPos.x, 12, dt);
          part.position.y = THREE.MathUtils.damp(part.position.y, _targetWorldPos.y, 12, dt);
          part.position.z = THREE.MathUtils.damp(part.position.z, _targetWorldPos.z, 12, dt);

          if (part.rigidBody) {
            part.rigidBody.setNextKinematicTranslation({
              x: part.position.x,
              y: part.position.y,
              z: part.position.z,
            });
          }

          // Live kinematic simulation once module is fully assembled!
          if (this.completed && part.spec.spinAxis && part.spec.spinSpeed) {
            if (part.spec.spinAxis === 'z') part.visualGroup.rotation.z += part.spec.spinSpeed * dt;
            else if (part.spec.spinAxis === 'y') part.visualGroup.rotation.y += part.spec.spinSpeed * dt;
            else part.visualGroup.rotation.x += part.spec.spinSpeed * dt;
          }
        }
      }

      if (this.recorder.isRecording()) {
        this.recorder.sampleTick(this.explodedCurrent, this.capturePartPoses());
      }
    }

    // Smooth remote peer avatar interpolation + WebRTC speaking halo & 3D spatial distance indicator
    const nowMs = performance.now();
    const pulse = 1.18 + Math.sin(nowMs * 0.015) * 0.12;
    const shouldRefreshDistanceLabels =
      this.remoteAvatars.size > 0 && Boolean(xb.core.camera) && nowMs - this.lastAvatarDistanceSyncMs > 250;
    if (shouldRefreshDistanceLabels && xb.core.camera) {
      this.lastAvatarDistanceSyncMs = nowMs;
      xb.core.camera.getWorldPosition(_peerPos);
    }

    for (const [peerId, av] of this.remoteAvatars.entries()) {
      av.group.position.x = THREE.MathUtils.damp(av.group.position.x, av.targetHeadPos.x, 10, dt);
      av.group.position.y = THREE.MathUtils.damp(av.group.position.y, av.targetHeadPos.y, 10, dt);
      av.group.position.z = THREE.MathUtils.damp(av.group.position.z, av.targetHeadPos.z, 10, dt);
      av.group.quaternion.slerp(av.targetHeadQuat, 1 - Math.exp(-10 * dt));
      const speaking = voiceChatManager.isPeerSpeaking(peerId);
      const targetHaloScale = speaking ? pulse : 1.0;
      av.halo.scale.setScalar(THREE.MathUtils.damp(av.halo.scale.x, targetHaloScale, 14, dt));
      av.handSphere.visible = av.hasHand;
      if (av.hasHand) {
        av.handSphere.position.x = THREE.MathUtils.damp(av.handSphere.position.x, av.targetHandPos.x, 14, dt);
        av.handSphere.position.y = THREE.MathUtils.damp(av.handSphere.position.y, av.targetHandPos.y, 14, dt);
        av.handSphere.position.z = THREE.MathUtils.damp(av.handSphere.position.z, av.targetHandPos.z, 14, dt);
      }
      if (shouldRefreshDistanceLabels) {
        const dist = _peerPos.distanceTo(av.group.position);
        const suffix = av.voiceEnabled ? (av.voiceMuted ? ' [MUTE]' : ' [3D MIC]') : '';
        const nextLabel = `${av.peerName} · ${dist.toFixed(1)}m${suffix}`;
        if (nextLabel !== av.lastHudLabel) {
          av.lastHudLabel = nextLabel;
          av.nameText.text = nextLabel;
        }
      }
    }

    // Broadcast local head & hand pose over WebSocket ~15 Hz when in a multiplayer room
    if (multiplayerClient.isConnected() && xb.core.camera) {
      const now = performance.now();
      if (now - this.lastPoseBroadcastMs > 66) {
        this.lastPoseBroadcastMs = now;
        xb.core.camera.getWorldPosition(_peerPos);
        xb.core.camera.getWorldQuaternion(_peerQuat);
        let handPosPayload: { x: number; y: number; z: number } | null = null;
        const tip = xb.user.hands?.getIndexTip?.();
        if (tip) {
          tip.getWorldPosition(_v1);
          handPosPayload = { x: _v1.x, y: _v1.y, z: _v1.z };
        }
        multiplayerClient.send({
          type: 'avatar:pose',
          headPos: { x: _peerPos.x, y: _peerPos.y, z: _peerPos.z },
          headQuat: { x: _peerQuat.x, y: _peerQuat.y, z: _peerQuat.z, w: _peerQuat.w },
          handPos: handPosPayload,
        });
      }
    }

    // Validate spatial UI card layout once after first completed UI frame
    if (!this.uiValidated && this.spatialCard) {
      const report = xb.ui.validate(this.spatialCard);
      if (report.ready) {
        this.uiValidated = true;
        if (!report.ok) {
          console.table(report.issues);
        }
      }
    }
  }

  onKeyDown(event: xb.KeyEvent) {
    if (event.code === 'Digit1') this.switchModule('turbine', true);
    else if (event.code === 'Digit2') this.switchModule('gearbox', true);
    else if (event.code === 'Digit3') this.switchModule('robotarm', true);
    else if (event.code === 'Digit4') this.switchModule('spectrometer', true);
    else if (event.code === 'KeyR') this.resetAssembly(true);
    else if (event.code === 'KeyE') {
      this.setExplodedAmount(this.explodedTarget > 0.3 ? 0 : 0.85, true);
    }
  }

  dispose() {
    this.unsubMultiplayer?.();
    this.unsubVoice?.();
    this.unsubVoiceCmd?.();
    this.unsubVrMode?.();
    this.vrEnvGroup.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        (obj.material as THREE.Material).dispose();
      }
    });
    this.recorder.cancelRecording();
    this.recorder.exitPlayback();
    if (this.playbackTrailLine) {
      this.playbackTrailLine.geometry.dispose();
      (this.playbackTrailLine.material as THREE.Material).dispose();
    }
    if (this.playbackEventMarker) {
      this.playbackEventMarker.geometry.dispose();
      this.playbackEventMarkerMat?.dispose();
    }
    for (const peerId of this.remoteAvatars.keys()) {
      voiceChatManager.detachPeerPositionalAudio(peerId);
    }
    audioEngine.detachSpatialListener();
    this.clearActiveParts();
  }
}
