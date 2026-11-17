import * as THREE from 'three';
import type { SupportedLang } from '../i18n/translations.ts';

export type BuiltinModuleId = 'turbine' | 'gearbox' | 'robotarm' | 'spectrometer' | 'custom';

export interface AssemblyPartSpec {
  id: string;
  labels: Record<SupportedLang, string>;
  /** Local offset relative to assembly center when fully assembled */
  targetOffset: [number, number, number];
  /** Offset added per unit of exploded-view slider (0..1) */
  explodedOffset: [number, number, number];
  /** Initial scattered workbench offset before snapping */
  workbenchOffset: [number, number, number];
  /** Half-extents for Rapier cuboid collider */
  colliderHalfExtents: [number, number, number];
  /** Mass in kg for Rapier dynamic physics */
  mass: number;
  /** Snap radius in meters */
  snapRadius: number;
  /** Optional kinematic spin axis when module is completed */
  spinAxis?: 'x' | 'y' | 'z';
  spinSpeed?: number;
  buildMesh: (materials: MaterialPalette, isSoftwareGl: boolean) => THREE.Group;
}

export interface ModuleDefinition {
  id: BuiltinModuleId;
  titleKey: 'turbineTitle' | 'gearboxTitle' | 'robotarmTitle' | 'spectrometerTitle' | 'customTitle';
  descKey: 'turbineDesc' | 'gearboxDesc' | 'robotarmDesc' | 'spectrometerDesc' | 'customDesc';
  accentHex: string;
  parts: AssemblyPartSpec[];
}

export interface MaterialPalette {
  titanium: THREE.MeshPhysicalMaterial;
  anodizedBlue: THREE.MeshPhysicalMaterial;
  anodizedAmber: THREE.MeshPhysicalMaterial;
  darkCarbon: THREE.MeshStandardMaterial;
  brass: THREE.MeshPhysicalMaterial;
  ceramic: THREE.MeshStandardMaterial;
  emeraldAccent: THREE.MeshStandardMaterial;
  opticalGlass: THREE.MeshPhysicalMaterial;
  emissiveLaser: THREE.MeshBasicMaterial;
}

export function createBrushedMetalTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#c8d1dc';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const v = 180 + Math.floor(Math.sin(y * 0.7) * 18 + (Math.random() - 0.5) * 28);
    ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    ctx.fillRect(0, y, 256, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createMaterialPalette(isSoftwareGl: boolean, maxAnisotropy = 4): MaterialPalette {
  const brushed = createBrushedMetalTexture();
  brushed.anisotropy = maxAnisotropy;

  return {
    titanium: new THREE.MeshPhysicalMaterial({
      color: 0xc2ccd6,
      map: brushed,
      metalness: 0.92,
      roughness: 0.22,
      anisotropy: 0.75,
      clearcoat: 0.25,
    }),
    anodizedBlue: new THREE.MeshPhysicalMaterial({
      color: 0x2563eb,
      metalness: 0.72,
      roughness: 0.28,
      clearcoat: 0.85,
      clearcoatRoughness: 0.14,
    }),
    anodizedAmber: new THREE.MeshPhysicalMaterial({
      color: 0xd97706,
      metalness: 0.68,
      roughness: 0.3,
      clearcoat: 0.7,
    }),
    darkCarbon: new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.25,
      roughness: 0.68,
    }),
    brass: new THREE.MeshPhysicalMaterial({
      color: 0xeab308,
      metalness: 0.94,
      roughness: 0.18,
      anisotropy: 0.6,
    }),
    ceramic: new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.08,
      roughness: 0.48,
    }),
    emeraldAccent: new THREE.MeshStandardMaterial({
      color: 0x10b981,
      metalness: 0.4,
      roughness: 0.3,
      emissive: 0x064e3b,
      emissiveIntensity: 0.4,
    }),
    opticalGlass: new THREE.MeshPhysicalMaterial({
      color: 0xbae6fd,
      metalness: 0,
      roughness: 0.05,
      transmission: isSoftwareGl ? 0 : 0.9,
      transparent: true,
      opacity: isSoftwareGl ? 0.45 : 1,
      ior: 1.55,
      thickness: 0.12,
      clearcoat: 1.0,
      depthWrite: isSoftwareGl ? false : true,
    }),
    emissiveLaser: new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    }),
  };
}

function createSpurGearGeometry(
  teeth: number,
  innerRadius: number,
  outerRadius: number,
  depth: number,
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  const toothTop = outerRadius;
  const toothRoot = outerRadius * 0.82;

  for (let i = 0; i < teeth; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.35;
    const a3 = a0 + step * 0.65;
    const a4 = a0 + step * 0.78;
    if (i === 0) {
      shape.moveTo(Math.cos(a0) * toothRoot, Math.sin(a0) * toothRoot);
    } else {
      shape.lineTo(Math.cos(a0) * toothRoot, Math.sin(a0) * toothRoot);
    }
    shape.lineTo(Math.cos(a1) * toothRoot, Math.sin(a1) * toothRoot);
    shape.lineTo(Math.cos(a2) * toothTop, Math.sin(a2) * toothTop);
    shape.lineTo(Math.cos(a3) * toothTop, Math.sin(a3) * toothTop);
    shape.lineTo(Math.cos(a4) * toothRoot, Math.sin(a4) * toothRoot);
  }
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

function buildTurbineIntakeFan(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  // Shroud ring via LatheGeometry
  const pts = [
    new THREE.Vector2(0.095, -0.03),
    new THREE.Vector2(0.112, -0.03),
    new THREE.Vector2(0.115, 0.03),
    new THREE.Vector2(0.092, 0.035),
    new THREE.Vector2(0.095, -0.03),
  ];
  const shroud = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m.anodizedBlue);
  shroud.rotation.x = Math.PI / 2;
  g.add(shroud);

  // Nose spinner cone
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.08, 24), m.titanium);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = 0.025;
  g.add(cone);

  // 10 composite fan blades
  const bladeGeo = new THREE.BoxGeometry(0.008, 0.072, 0.024);
  for (let i = 0; i < 10; i++) {
    const blade = new THREE.Mesh(bladeGeo, m.titanium);
    const angle = (i / 10) * Math.PI * 2;
    blade.position.set(Math.cos(angle) * 0.055, Math.sin(angle) * 0.055, 0);
    blade.rotation.z = angle - Math.PI / 2;
    blade.rotation.y = 0.35;
    g.add(blade);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.112, 0.004, 12, 36), m.brass);
  ring.position.z = 0.028;
  g.add(ring);
  return g;
}

function buildCompressorStage(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.076, 0.09, 28), m.darkCarbon);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.13, 18), m.titanium);
  shaft.rotation.x = Math.PI / 2;
  g.add(shaft);

  for (let row = -1; row <= 1; row += 2) {
    for (let i = 0; i < 8; i++) {
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.022, 0.026), m.titanium);
      const angle = (i / 8) * Math.PI * 2;
      vane.position.set(Math.cos(angle) * 0.086, Math.sin(angle) * 0.086, row * 0.024);
      vane.rotation.z = angle;
      g.add(vane);
    }
  }
  const flange = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.006, 10, 32), m.anodizedBlue);
  flange.position.z = -0.042;
  g.add(flange);
  return g;
}

function buildCombustorLiner(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.094, 0.094, 0.1, 28, 1, true), m.ceramic);
  outer.rotation.x = Math.PI / 2;
  g.add(outer);

  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.105, 24), m.darkCarbon);
  core.rotation.x = Math.PI / 2;
  g.add(core);

  // Fuel injector manifold pipes
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.032, 10), m.anodizedAmber);
    nozzle.position.set(Math.cos(a) * 0.068, Math.sin(a) * 0.068, 0);
    nozzle.rotation.z = a;
    g.add(nozzle);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.007, 10, 32), m.brass);
  g.add(collar);
  return g;
}

function buildTurbineImpeller(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.026, 28), m.anodizedAmber);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.055, 20), m.titanium);
  hub.rotation.x = Math.PI / 2;
  g.add(hub);

  const bladeGeo = new THREE.BoxGeometry(0.007, 0.036, 0.018);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new THREE.Mesh(bladeGeo, m.brass);
    b.position.set(Math.cos(a) * 0.074, Math.sin(a) * 0.074, 0);
    b.rotation.z = a - Math.PI / 2;
    b.rotation.y = -0.4;
    g.add(b);
  }
  return g;
}

function buildExhaustNozzle(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.092, 0.05),
    new THREE.Vector2(0.082, 0.01),
    new THREE.Vector2(0.062, -0.055),
    new THREE.Vector2(0.054, -0.055),
    new THREE.Vector2(0.072, 0.01),
    new THREE.Vector2(0.082, 0.05),
    new THREE.Vector2(0.092, 0.05),
  ];
  const cone = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m.titanium);
  cone.rotation.x = Math.PI / 2;
  g.add(cone);

  const plug = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 24), m.darkCarbon);
  plug.rotation.x = -Math.PI / 2;
  plug.position.z = -0.015;
  g.add(plug);

  const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.004, 10, 28), m.emeraldAccent);
  glowRing.position.z = -0.052;
  g.add(glowRing);
  return g;
}

function buildGearboxHousing(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.118, -0.04),
    new THREE.Vector2(0.135, -0.04),
    new THREE.Vector2(0.135, 0.04),
    new THREE.Vector2(0.118, 0.04),
    new THREE.Vector2(0.118, -0.04),
  ];
  const housing = new THREE.Mesh(new THREE.LatheGeometry(pts, 36), m.darkCarbon);
  g.add(housing);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09, 6), m.titanium);
    bolt.position.set(Math.cos(a) * 0.126, 0, Math.sin(a) * 0.126);
    g.add(bolt);
  }
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.126, 0.006, 10, 36), m.anodizedBlue);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = 0.04;
  g.add(bezel);
  return g;
}

function buildGearPart(m: MaterialPalette, teeth: number, rIn: number, rOut: number, matKey: keyof MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const gear = new THREE.Mesh(createSpurGearGeometry(teeth, rIn, rOut, 0.038), m[matKey]);
  gear.rotation.x = Math.PI / 2;
  g.add(gear);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(rIn + 0.006, rIn + 0.006, 0.052, 20), m.titanium);
  g.add(collar);

  const keyway = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.056, 0.008), m.darkCarbon);
  g.add(keyway);
  return g;
}

function buildCarrierPlate(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.014, 6), m.anodizedBlue);
  g.add(plate);

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.058, 16), m.titanium);
    pin.position.set(Math.cos(a) * 0.068, 0.025, Math.sin(a) * 0.068);
    g.add(pin);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.04, 18), m.brass);
  hub.position.y = -0.02;
  g.add(hub);
  return g;
}

function buildRobotTurretBase(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.036, 28), m.darkCarbon);
  g.add(foot);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.09, 0.042, 24), m.anodizedBlue);
  collar.position.y = 0.036;
  g.add(collar);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.084, 0.005, 10, 28), m.brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.056;
  g.add(ring);
  return g;
}

function buildRobotShoulder(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.095, 24), m.titanium);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  const capL = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.014, 24), m.anodizedAmber);
  capL.rotation.z = Math.PI / 2;
  capL.position.x = -0.048;
  g.add(capL);
  const capR = capL.clone();
  capR.position.x = 0.048;
  g.add(capR);
  return g;
}

function buildRobotBoom(m: MaterialPalette, length: number, colorMat: keyof MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.042, length, 0.048), m[colorMat]);
  g.add(arm);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, length * 0.85, 12), m.titanium);
  strut.position.z = 0.03;
  g.add(strut);
  const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.065, 20), m.darkCarbon);
  joint.rotation.z = Math.PI / 2;
  joint.position.y = length * 0.45;
  g.add(joint);
  return g;
}

function buildRobotGripper(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.04, 20), m.brass);
  g.add(wrist);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.026), m.darkCarbon);
  bar.position.y = 0.025;
  g.add(bar);
  const jawL = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.06, 0.022), m.titanium);
  jawL.position.set(-0.034, 0.062, 0);
  g.add(jawL);
  const jawR = jawL.clone();
  jawR.position.x = 0.034;
  g.add(jawR);
  return g;
}

function buildOpticalRail(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.026, 0.09), m.darkCarbon);
  g.add(rail);
  const track = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.008, 0.032), m.titanium);
  track.position.y = 0.016;
  g.add(track);
  for (let i = -1; i <= 1; i++) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.016, 16), m.brass);
    foot.position.set(i * 0.14, -0.018, 0);
    g.add(foot);
  }
  return g;
}

function buildCollimator(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.11, 24), m.anodizedBlue);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.065, 16), m.titanium);
  post.position.y = -0.045;
  g.add(post);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 16), m.opticalGlass);
  lens.scale.set(0.35, 1, 1);
  lens.position.x = 0.055;
  g.add(lens);
  return g;
}

function buildDispersionPrism(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const r = 0.048;
  shape.moveTo(0, r);
  shape.lineTo(-r * 0.866, -r * 0.5);
  shape.lineTo(r * 0.866, -r * 0.5);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  geo.center();
  const prism = new THREE.Mesh(geo, m.opticalGlass);
  prism.rotation.x = Math.PI / 2;
  g.add(prism);

  const stage = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.022, 24), m.darkCarbon);
  stage.position.y = -0.042;
  g.add(stage);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.004, 8, 24), m.brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.032;
  g.add(ring);
  return g;
}

function buildFocusingMirror(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.018, 24), m.anodizedAmber);
  housing.rotation.z = Math.PI / 2;
  housing.rotation.y = 0.45;
  g.add(housing);
  const mirrorFace = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.006, 24), m.titanium);
  mirrorFace.rotation.z = Math.PI / 2;
  mirrorFace.rotation.y = 0.45;
  mirrorFace.position.set(-0.008, 0, 0.004);
  g.add(mirrorFace);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.014, 0.065, 16), m.darkCarbon);
  post.position.y = -0.045;
  g.add(post);
  return g;
}

function buildCcdDetector(m: MaterialPalette): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.064, 0.072), m.darkCarbon);
  g.add(body);
  const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.038, 0.044), m.emeraldAccent);
  sensor.position.x = -0.028;
  g.add(sensor);
  const heatsink = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.056, 0.06), m.titanium);
  heatsink.position.x = 0.032;
  g.add(heatsink);
  return g;
}

export const SIMULATION_MODULES: Record<Exclude<BuiltinModuleId, 'custom'>, ModuleDefinition> = {
  turbine: {
    id: 'turbine',
    titleKey: 'turbineTitle',
    descKey: 'turbineDesc',
    accentHex: '#38bdf8',
    parts: [
      {
        id: 'turbine_combustor',
        labels: { en: 'Annular Combustor', ru: 'Камера сгорания', de: 'Ringbrennkammer' },
        targetOffset: [0, 0, 0],
        explodedOffset: [0, 0, 0],
        workbenchOffset: [0, 0.02, 0],
        colliderHalfExtents: [0.095, 0.095, 0.055],
        mass: 2.2,
        snapRadius: 0.14,
        buildMesh: (m) => buildCombustorLiner(m),
      },
      {
        id: 'turbine_compressor',
        labels: { en: 'Compressor Stage', ru: 'Ступень компрессора', de: 'Verdichterstufe' },
        targetOffset: [0, 0, 0.105],
        explodedOffset: [0, 0, 0.14],
        workbenchOffset: [-0.26, 0.02, 0.12],
        colliderHalfExtents: [0.09, 0.09, 0.055],
        mass: 1.8,
        snapRadius: 0.14,
        spinAxis: 'z',
        spinSpeed: 3.2,
        buildMesh: (m) => buildCompressorStage(m),
      },
      {
        id: 'turbine_fan',
        labels: { en: 'Intake Fan Rotor', ru: 'Ротор вентилятора', de: 'Einlass-Lüfterrotor' },
        targetOffset: [0, 0, 0.195],
        explodedOffset: [0, 0, 0.28],
        workbenchOffset: [-0.32, 0.02, -0.14],
        colliderHalfExtents: [0.115, 0.115, 0.04],
        mass: 1.5,
        snapRadius: 0.15,
        spinAxis: 'z',
        spinSpeed: 5.5,
        buildMesh: (m) => buildTurbineIntakeFan(m),
      },
      {
        id: 'turbine_impeller',
        labels: { en: 'HP Turbine Disc', ru: 'Диск турбины ВД', de: 'HD-Turbinenscheibe' },
        targetOffset: [0, 0, -0.095],
        explodedOffset: [0, 0, -0.15],
        workbenchOffset: [0.28, 0.02, 0.12],
        colliderHalfExtents: [0.085, 0.085, 0.03],
        mass: 1.4,
        snapRadius: 0.14,
        spinAxis: 'z',
        spinSpeed: -4.2,
        buildMesh: (m) => buildTurbineImpeller(m),
      },
      {
        id: 'turbine_nozzle',
        labels: { en: 'Exhaust Nozzle Cone', ru: 'Выходное сопло', de: 'Schubdüse' },
        targetOffset: [0, 0, -0.185],
        explodedOffset: [0, 0, -0.28],
        workbenchOffset: [0.3, 0.02, -0.14],
        colliderHalfExtents: [0.09, 0.09, 0.055],
        mass: 1.6,
        snapRadius: 0.15,
        buildMesh: (m) => buildExhaustNozzle(m),
      },
    ],
  },
  gearbox: {
    id: 'gearbox',
    titleKey: 'gearboxTitle',
    descKey: 'gearboxDesc',
    accentHex: '#34d399',
    parts: [
      {
        id: 'gear_housing',
        labels: { en: 'Ring Gear Housing', ru: 'Корпус венца', de: 'Hohlradgehäuse' },
        targetOffset: [0, -0.02, 0],
        explodedOffset: [0, -0.1, 0],
        workbenchOffset: [0, 0.02, 0],
        colliderHalfExtents: [0.135, 0.045, 0.135],
        mass: 2.5,
        snapRadius: 0.15,
        buildMesh: (m) => buildGearboxHousing(m),
      },
      {
        id: 'gear_carrier',
        labels: { en: 'Planet Carrier', ru: 'Водило сателлитов', de: 'Planetenträger' },
        targetOffset: [0, 0.025, 0],
        explodedOffset: [0, 0.14, 0],
        workbenchOffset: [-0.28, 0.02, -0.12],
        colliderHalfExtents: [0.095, 0.03, 0.095],
        mass: 1.4,
        snapRadius: 0.14,
        spinAxis: 'y',
        spinSpeed: 1.1,
        buildMesh: (m) => buildCarrierPlate(m),
      },
      {
        id: 'gear_sun',
        labels: { en: 'Sun Gear (12T)', ru: 'Солнечная шестерня', de: 'Sonnenrad (12Z)' },
        targetOffset: [0, 0.048, 0],
        explodedOffset: [0, 0.25, 0],
        workbenchOffset: [0.28, 0.02, -0.12],
        colliderHalfExtents: [0.048, 0.03, 0.048],
        mass: 0.9,
        snapRadius: 0.13,
        spinAxis: 'y',
        spinSpeed: 3.6,
        buildMesh: (m) => buildGearPart(m, 12, 0.012, 0.042, 'brass'),
      },
      {
        id: 'gear_planet_a',
        labels: { en: 'Planet Gear A (8T)', ru: 'Сателлит A (8Z)', de: 'Planetenrad A (8Z)' },
        targetOffset: [0.068, 0.048, 0],
        explodedOffset: [0.14, 0.22, 0],
        workbenchOffset: [-0.26, 0.02, 0.14],
        colliderHalfExtents: [0.036, 0.03, 0.036],
        mass: 0.7,
        snapRadius: 0.13,
        spinAxis: 'y',
        spinSpeed: -2.4,
        buildMesh: (m) => buildGearPart(m, 8, 0.01, 0.032, 'anodizedAmber'),
      },
      {
        id: 'gear_planet_b',
        labels: { en: 'Planet Gear B (8T)', ru: 'Сателлит B (8Z)', de: 'Planetenrad B (8Z)' },
        targetOffset: [-0.034, 0.048, 0.059],
        explodedOffset: [-0.09, 0.22, 0.12],
        workbenchOffset: [0.26, 0.02, 0.14],
        colliderHalfExtents: [0.036, 0.03, 0.036],
        mass: 0.7,
        snapRadius: 0.13,
        spinAxis: 'y',
        spinSpeed: -2.4,
        buildMesh: (m) => buildGearPart(m, 8, 0.01, 0.032, 'anodizedAmber'),
      },
    ],
  },
  robotarm: {
    id: 'robotarm',
    titleKey: 'robotarmTitle',
    descKey: 'robotarmDesc',
    accentHex: '#f59e0b',
    parts: [
      {
        id: 'arm_base',
        labels: { en: 'Turret Pedestal', ru: 'Поворотная база', de: 'Drehsockel' },
        targetOffset: [0, -0.05, 0],
        explodedOffset: [0, -0.06, 0],
        workbenchOffset: [0, 0.02, 0],
        colliderHalfExtents: [0.12, 0.045, 0.12],
        mass: 3.0,
        snapRadius: 0.15,
        buildMesh: (m) => buildRobotTurretBase(m),
      },
      {
        id: 'arm_shoulder',
        labels: { en: 'Shoulder Servo', ru: 'Сервопривод плеча', de: 'Schulter-Servo' },
        targetOffset: [0, 0.04, 0],
        explodedOffset: [0, 0.08, 0],
        workbenchOffset: [-0.28, 0.02, -0.12],
        colliderHalfExtents: [0.055, 0.05, 0.05],
        mass: 1.5,
        snapRadius: 0.14,
        spinAxis: 'y',
        spinSpeed: 0.7,
        buildMesh: (m) => buildRobotShoulder(m),
      },
      {
        id: 'arm_upper',
        labels: { en: 'Upper Boom Arm', ru: 'Плечевая балка', de: 'Oberarm-Ausleger' },
        targetOffset: [0, 0.16, 0],
        explodedOffset: [0, 0.2, 0],
        workbenchOffset: [-0.26, 0.02, 0.14],
        colliderHalfExtents: [0.03, 0.095, 0.035],
        mass: 1.3,
        snapRadius: 0.14,
        buildMesh: (m) => buildRobotBoom(m, 0.17, 'anodizedBlue'),
      },
      {
        id: 'arm_forearm',
        labels: { en: 'Forearm Link', ru: 'Предплечье', de: 'Unterarm-Glied' },
        targetOffset: [0.07, 0.26, 0],
        explodedOffset: [0.14, 0.28, 0],
        workbenchOffset: [0.28, 0.02, -0.12],
        colliderHalfExtents: [0.03, 0.085, 0.035],
        mass: 1.1,
        snapRadius: 0.14,
        buildMesh: (m) => {
          const g = buildRobotBoom(m, 0.14, 'anodizedAmber');
          g.rotation.z = -Math.PI / 3;
          return g;
        },
      },
      {
        id: 'arm_gripper',
        labels: { en: 'Parallel Gripper', ru: 'Параллельный захват', de: 'Parallelgreifer' },
        targetOffset: [0.15, 0.31, 0],
        explodedOffset: [0.26, 0.34, 0],
        workbenchOffset: [0.28, 0.02, 0.14],
        colliderHalfExtents: [0.05, 0.055, 0.03],
        mass: 0.8,
        snapRadius: 0.14,
        spinAxis: 'y',
        spinSpeed: 1.4,
        buildMesh: (m) => {
          const g = buildRobotGripper(m);
          g.rotation.z = -Math.PI / 3;
          return g;
        },
      },
    ],
  },
  spectrometer: {
    id: 'spectrometer',
    titleKey: 'spectrometerTitle',
    descKey: 'spectrometerDesc',
    accentHex: '#a78bfa',
    parts: [
      {
        id: 'spec_rail',
        labels: { en: 'Optical Rail Base', ru: 'Оптическая рельса', de: 'Optikschiene' },
        targetOffset: [0, -0.04, 0],
        explodedOffset: [0, -0.08, 0],
        workbenchOffset: [0, 0.02, 0],
        colliderHalfExtents: [0.19, 0.025, 0.05],
        mass: 2.2,
        snapRadius: 0.15,
        buildMesh: (m) => buildOpticalRail(m),
      },
      {
        id: 'spec_collimator',
        labels: { en: 'Collimator Lens', ru: 'Коллиматор', de: 'Kollimatorlinse' },
        targetOffset: [-0.12, 0.035, 0],
        explodedOffset: [-0.14, 0.14, 0],
        workbenchOffset: [-0.3, 0.02, -0.14],
        colliderHalfExtents: [0.06, 0.05, 0.035],
        mass: 0.9,
        snapRadius: 0.14,
        buildMesh: (m) => buildCollimator(m),
      },
      {
        id: 'spec_prism',
        labels: { en: 'Crown Glass Prism', ru: 'Дисперсионная призма', de: 'Kronglas-Prisma' },
        targetOffset: [0, 0.045, 0],
        explodedOffset: [0, 0.2, 0],
        workbenchOffset: [-0.25, 0.02, 0.15],
        colliderHalfExtents: [0.05, 0.05, 0.05],
        mass: 0.8,
        snapRadius: 0.14,
        spinAxis: 'y',
        spinSpeed: 0.4,
        buildMesh: (m) => buildDispersionPrism(m),
      },
      {
        id: 'spec_mirror',
        labels: { en: 'Focusing Mirror', ru: 'Фокусирующее зеркало', de: 'Fokussierspiegel' },
        targetOffset: [0.09, 0.035, 0.02],
        explodedOffset: [0.1, 0.14, 0.06],
        workbenchOffset: [0.26, 0.02, -0.14],
        colliderHalfExtents: [0.04, 0.05, 0.04],
        mass: 0.8,
        snapRadius: 0.14,
        buildMesh: (m) => buildFocusingMirror(m),
      },
      {
        id: 'spec_ccd',
        labels: { en: 'CCD Sensor Array', ru: 'ПЗС-детектор', de: 'CCD-Sensorfeld' },
        targetOffset: [0.16, 0.035, -0.02],
        explodedOffset: [0.22, 0.12, -0.04],
        workbenchOffset: [0.3, 0.02, 0.14],
        colliderHalfExtents: [0.045, 0.04, 0.04],
        mass: 1.0,
        snapRadius: 0.14,
        buildMesh: (m) => buildCcdDetector(m),
      },
    ],
  },
};

export interface CustomQrPartDef {
  id: string;
  label: string;
  shape: 'cylinder' | 'box' | 'torus' | 'cone';
  color: string;
  size: [number, number, number];
  targetOffset: [number, number, number];
}

export function buildCustomModuleFromQr(
  name: string,
  customParts: CustomQrPartDef[],
): ModuleDefinition {
  const safeParts = customParts.slice(0, 8);
  return {
    id: 'custom',
    titleKey: 'customTitle',
    descKey: 'customDesc',
    accentHex: '#22d3ee',
    parts: safeParts.map((cp, idx) => {
      const col = new THREE.Color(cp.color || '#38bdf8');
      return {
        id: cp.id || `qr_part_${idx}`,
        labels: {
          en: cp.label || `${name} #${idx + 1}`,
          ru: cp.label || `${name} #${idx + 1}`,
          de: cp.label || `${name} #${idx + 1}`,
        },
        targetOffset: cp.targetOffset || [0, idx * 0.07, 0],
        explodedOffset: [0, idx * 0.08, 0],
        workbenchOffset: [((idx % 2 === 0 ? -1 : 1) * (0.22 + idx * 0.04)), 0.02, (idx - 1.5) * 0.08],
        colliderHalfExtents: [0.06, 0.045, 0.06],
        mass: 1.1,
        snapRadius: 0.15,
        buildMesh: (m) => {
          const g = new THREE.Group();
          const mat = new THREE.MeshPhysicalMaterial({
            color: col,
            metalness: 0.65,
            roughness: 0.25,
            clearcoat: 0.7,
          });
          const [sx, sy, sz] = cp.size || [0.08, 0.06, 0.08];
          let geo: THREE.BufferGeometry;
          if (cp.shape === 'cylinder') geo = new THREE.CylinderGeometry(sx * 0.5, sx * 0.5, sy, 24);
          else if (cp.shape === 'torus') geo = new THREE.TorusGeometry(sx * 0.5, sy * 0.25, 14, 28);
          else if (cp.shape === 'cone') geo = new THREE.ConeGeometry(sx * 0.5, sy, 24);
          else geo = new THREE.BoxGeometry(sx, sy, sz);

          const primary = new THREE.Mesh(geo, mat);
          g.add(primary);
          const collar = new THREE.Mesh(new THREE.TorusGeometry(sx * 0.36, 0.005, 8, 24), m.titanium);
          collar.rotation.x = Math.PI / 2;
          collar.position.y = sy * 0.35;
          g.add(collar);
          const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, sy * 1.15, 12), m.brass);
          g.add(pin);
          return g;
        },
      };
    }),
  };
}
