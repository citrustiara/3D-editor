import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { FpsTestRuntime } from "./physics/fpsTestRuntime.js";
import { makeRampGeometry } from "./physics/ramps.js";

const $ = (selector) => document.querySelector(selector);
const viewport = $("#viewport");

const layers = {
  floors: true,
  boxes: true,
  platforms: true,
  ramps: true,
  collision: true,
  decor: true,
  assets: true,
  spawns: true,
  bounds: true,
};

const colors = {
  floor: 0x2d3b40,
  gridA: 0x78e0cc,
  gridB: 0x334455,
  edge: 0x1a3a35,
  box: 0x5ab3ff,
  platform: 0x67c474,
  ramp: 0xf1b84b,
  collision: 0xe35d5b,
  decor: 0xb6a0ff,
  spawn0: 0x3cb6a3,
  spawn1: 0xf1b84b,
  asset: 0xb8c3cc,
};

const labels = {
  boxes: "Box",
  platforms: "Platform",
  ramps: "Ramp",
  collision: "Collision",
  decor: "Decor",
  assets: "Asset",
  floors: "Floor",
  spawnPoints: "Spawn",
  parts: "Part",
  muzzle: "Muzzle Point",
};

let map = createSampleMap();
let selected = null;
let isTransforming = false;
let weaponConfig = createWeaponConfig();
let editorCameraState = null;
let pendingInputSnapshot = null;
let transformStartSnapshot = null;
let editingMode = "map";
let weaponsData = null;
let activeWeaponId = "pistol";
let loadedSingleWeapon = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(map.sky);
scene.fog = new THREE.Fog(map.fog, map.fogNear, map.fogFar);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(36, 36, 48);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0, 0);

const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
scene.add(transform);

const fpsTest = new FpsTestRuntime({
  scene,
  camera,
  domElement: renderer.domElement,
  onExit: exitQuickTest,
  onStatus: (text) => {
    $("#test-status").textContent = text || "Spawn test active";
  },
});

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const mapGroup = new THREE.Group();
scene.add(mapGroup);

const weaponGroup = new THREE.Group();
scene.add(weaponGroup);

const grid = new THREE.GridHelper(220, 220, colors.gridA, colors.gridB);
grid.position.y = 0.01;
scene.add(grid);

const weaponGrid = new THREE.GridHelper(4, 40, 0xffaa00, 0x554433);
weaponGrid.position.y = 0.005;
weaponGrid.visible = false;
scene.add(weaponGrid);

const boundsHelper = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: colors.edge }));
scene.add(boundsHelper);

const hemi = new THREE.HemisphereLight(0xffffff, 0x283034, 1.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(40, 68, 32);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
scene.add(sun);

const loader = new GLTFLoader();
const assetCache = new Map();
const selectable = [];
const scratchBox = new THREE.Box3();
const frameClock = new THREE.Clock();
const history = {
  undo: [],
  redo: [],
  limit: 80,
};
let mapFileHandle = null;
let weaponFileHandle = null;

const mapFields = [
  ["id", "ID", "text", true],
  ["name", "Name", "text", true],
  ["sky", "Sky", "color"],
  ["fog", "Fog", "color"],
  ["fogNear", "Fog Near", "number"],
  ["fogFar", "Fog Far", "number"],
  ["bounds.x", "Bounds X", "number"],
  ["bounds.z", "Bounds Z", "number"],
  ["floor", "Floor Color", "color"],
  ["gridA", "Grid A", "color"],
  ["gridB", "Grid B", "color"],
  ["edge", "Edge Color", "color"],
];

const objectFields = {
  boxes: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sy", "Height", "number"],
    ["sz", "Depth", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
    ["color", "Color", "color"],
    ["visible", "Visible", "checkbox"],
  ],
  platforms: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sy", "Height", "number"],
    ["sz", "Depth", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
    ["color", "Color", "color"],
    ["isPlatform", "Is Platform", "checkbox"],
  ],
  collision: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sy", "Height", "number"],
    ["sz", "Depth", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
  ],
  decor: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sy", "Height", "number"],
    ["sz", "Depth", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
    ["color", "Color", "color"],
    ["collidable", "Collidable", "checkbox"],
  ],
  ramps: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Low Y", "number"],
    ["z", "Z", "number"],
    ["width", "Width", "number"],
    ["length", "Length", "number"],
    ["height", "Rise", "number"],
    ["rot", "Rotation", "number"],
    ["color", "Color", "color"],
  ],
  floors: [
    ["x", "X", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sz", "Depth", "number"],
  ],
  spawnPoints: [
    ["x", "X", "number"],
    ["z", "Z", "number"],
  ],
  assets: [
    ["url", "URL", "text", true],
    ["position.x", "X", "number"],
    ["position.y", "Y", "number"],
    ["position.z", "Z", "number"],
    ["rotation.x", "Rot X", "number"],
    ["rotation.y", "Rot Y", "number"],
    ["rotation.z", "Rot Z", "number"],
    ["scale", "Scale", "number"],
    ["collidable", "Collidable", "checkbox"],
  ],
  parts: [
    ["name", "Name", "text", true],
    ["type", "Type", "text", true],
    ["x", "X Offset", "number"],
    ["y", "Y Offset", "number"],
    ["z", "Z Offset", "number"],
    ["sx", "Size X / Radius", "number"],
    ["sy", "Size Y / Height", "number"],
    ["sz", "Size Z", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
    ["color", "Color", "color"],
  ],
  muzzle: [
    ["x", "Muzzle X", "number"],
    ["y", "Muzzle Y", "number"],
    ["z", "Muzzle Z", "number"],
  ],
};

function createSampleMap() {
  return {
    version: 1,
    id: "new-arena",
    name: "New Arena",
    sky: 0x10151a,
    fog: 0x10151a,
    fogNear: 80,
    fogFar: 210,
    bounds: { x: 92, z: 52 },
    spawnPoints: [{ x: -28, z: 0 }, { x: 28, z: 0 }],
    floors: [{ x: 0, z: 0, sx: 96, sz: 56 }],
    floor: colors.floor,
    gridA: colors.gridA,
    gridB: colors.gridB,
    edge: colors.edge,
    boxes: [
      { name: "cover-a", x: -14, y: 0, z: -7, sx: 6, sy: 3, sz: 6, rotX: 0, rotY: 0.2, rotZ: 0, color: colors.box, visible: true },
      { name: "cover-b", x: 14, y: 0, z: 7, sx: 6, sy: 3, sz: 6, rotX: 0, rotY: -0.2, rotZ: 0, color: colors.box, visible: true },
    ],
    platforms: [
      { name: "mid-platform", x: 0, y: 0.7, z: 0, sx: 16, sy: 1.4, sz: 10, rotX: 0, rotY: 0, rotZ: 0, color: colors.platform, isPlatform: true, visible: true },
    ],
    ramps: [
      { name: "ramp-north", x: 0, y: 1, z: 12, width: 8, length: 16, height: 3.6, rot: 0, color: colors.ramp },
    ],
    collision: [],
    decor: [
      { name: "banner-left", x: -36, y: 0, z: -23, sx: 8, sy: 5, sz: 1, rotX: 0, rotY: 0, rotZ: 0, color: colors.decor, collidable: false, visible: true },
    ],
    assets: [],
  };
}

function getActiveWeapon() {
  if (!weaponsData || !weaponsData.weapons) return null;
  return weaponsData.weapons[activeWeaponId] || null;
}

function rebuildWeaponScene() {
  selected = keepWeaponSelectionReference(selected);
  transform.detach();
  selectable.length = 0;
  weaponGroup.clear();

  if (editingMode !== "weapon") return;

  const weapon = getActiveWeapon();
  if (!weapon) return;

  if (Array.isArray(weapon.parts)) {
    weapon.parts.forEach((part, index) => {
      let geom;
      const sx = positive(part.sx || 0.1, 0.1);
      const sy = positive(part.sy || 0.1, 0.1);
      const sz = positive(part.sz || 0.1, 0.1);
      if (part.type === "cylinder") {
        geom = new THREE.CylinderGeometry(sx, sz, sy, 16);
      } else if (part.type === "sphere") {
        geom = new THREE.SphereGeometry(sx, 16, 16);
      } else {
        geom = new THREE.BoxGeometry(sx, sy, sz);
      }
      
      const mat = new THREE.MeshStandardMaterial({
        color: part.color ?? 0x555555,
        roughness: 0.5,
        metalness: 0.3,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(part.x || 0, part.y || 0, part.z || 0);
      mesh.rotation.set(part.rotX || 0, part.rotY || 0, part.rotZ || 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      mesh.userData.baseScale = { sx, sy, sz };
      addSelectable(mesh, "parts", index);
    });
  }

  const muzzle = weapon.muzzle || { x: 0, y: 0.08, z: -1.0 };
  const muzzleGeom = new THREE.SphereGeometry(0.04, 16, 16);
  const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.8 });
  const muzzleMesh = new THREE.Mesh(muzzleGeom, muzzleMat);
  muzzleMesh.position.set(muzzle.x, muzzle.y, muzzle.z);
  addSelectable(muzzleMesh, "muzzle", 0);

  if (selected) {
    const mesh = selectable.find((item) => item.userData.kind === selected.kind && item.userData.index === selected.index);
    if (mesh) selectMesh(mesh);
    else clearSelection();
  }
}

function keepWeaponSelectionReference(current) {
  if (!current) return null;
  const weapon = getActiveWeapon();
  if (!weapon) return null;
  if (current.kind === "parts" && weapon.parts?.[current.index]) return current;
  if (current.kind === "muzzle") return current;
  return null;
}

async function loadDefaultWeapons() {
  try {
    const response = await fetch("../GolfShooter/assets/weapons/weapons.json");
    if (response.ok) {
      const data = await response.json();
      if (data) {
        weaponsData = data;
        const weapons = weaponsData.weapons || {};
        await Promise.all(Object.keys(weapons).map(async (id) => {
          try {
            const res = await fetch(`../GolfShooter/assets/weapons/models/${id}.json`);
            if (res.ok) {
              const modelData = await res.json();
              if (modelData) {
                if (modelData.parts) weapons[id].parts = modelData.parts;
                if (modelData.muzzle) weapons[id].muzzle = modelData.muzzle;
              }
            }
          } catch (e) {
            console.warn(`Could not load model for ${id}`, e);
          }
        }));
        renderWeaponList();
        if (editingMode === "weapon") rebuildWeaponScene();
        return;
      }
    }
  } catch (e) {
    console.warn("Could not auto-load weapons.json, using fallback.", e);
  }
  
  weaponsData = {
    version: 1,
    weapons: {
      pistol: {
        label: "Pistol",
        parts: [
          { name: "frame", type: "box", x: 0, y: -0.04, z: -0.05, sx: 0.12, sy: 0.18, sz: 0.34, rotX: 0, rotY: 0, rotZ: 0, color: 0x1b1f24 }
        ],
        muzzle: { x: 0, y: 0.08, z: -0.5 }
      }
    }
  };
  renderWeaponList();
}

function renderWeaponList() {
  const select = $("#active-weapon-select");
  if (!select || !weaponsData || !weaponsData.weapons) return;
  select.innerHTML = Object.keys(weaponsData.weapons).map(id => `
    <option value="${id}">${weaponsData.weapons[id].label || titleCase(id)}</option>
  `).join("");
  select.value = activeWeaponId;
  updateWeaponOutput();
}

function addWeaponPart(type) {
  const weapon = getActiveWeapon();
  if (!weapon) return;
  const before = getHistorySnapshot();
  weapon.parts ||= [];
  const part = {
    name: uniquePartName(type),
    type: type,
    x: 0,
    y: 0,
    z: 0,
    sx: type === "sphere" || type === "cylinder" ? 0.05 : 0.1,
    sy: type === "cylinder" ? 0.2 : 0.1,
    sz: 0.1,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    color: 0x1b1f24
  };
  weapon.parts.push(part);
  pushUndoSnapshot(before);
  renderAll();
  selectAfterRebuild("parts", weapon.parts.length - 1);
}

function uniquePartName(base) {
  const weapon = getActiveWeapon();
  if (!weapon || !weapon.parts) return base;
  let counter = 1;
  while (weapon.parts.some(p => p.name === `${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

function createWeaponConfig() {
  return {
    id: "rifle",
    model: "assets/models/rifle.glb",
    scale: 1,
    firstPersonOffset: { x: 0.24, y: -0.18, z: -0.6 },
    thirdPersonOffset: { x: 0.12, y: 0.62, z: 0.18 },
    muzzle: { x: 0, y: 0.05, z: -1.1 },
  };
}

function normalizeMap(nextMap) {
  const base = createSampleMap();
  const normalized = { ...base, ...nextMap };
  normalized.bounds = { ...base.bounds, ...(nextMap.bounds || {}) };
  for (const key of ["spawnPoints", "floors", "boxes", "platforms", "ramps", "collision", "decor", "assets"]) {
    normalized[key] = Array.isArray(nextMap[key]) ? nextMap[key] : [];
  }
  return normalized;
}

function getHistorySnapshot() {
  return JSON.stringify({
    map,
    weaponsData,
    activeWeaponId,
    loadedSingleWeapon,
    selected,
    editingMode
  });
}

function pushUndoSnapshot(snapshot) {
  if (!snapshot) return;
  const current = getHistorySnapshot();
  if (snapshot === current) return;
  history.undo.push(snapshot);
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo.length = 0;
  updateHistoryButtons();
}

function undoChange() {
  const previous = history.undo.pop();
  if (!previous) return;
  history.redo.push(getHistorySnapshot());
  restoreHistorySnapshot(previous);
}

function redoChange() {
  const next = history.redo.pop();
  if (!next) return;
  history.undo.push(getHistorySnapshot());
  restoreHistorySnapshot(next);
}

function restoreHistorySnapshot(snapshotStr) {
  if (fpsTest.active) fpsTest.stop();
  const snapshot = JSON.parse(snapshotStr);
  map = normalizeMap(snapshot.map);
  weaponsData = snapshot.weaponsData;
  activeWeaponId = snapshot.activeWeaponId;
  loadedSingleWeapon = snapshot.loadedSingleWeapon;
  selected = snapshot.selected;
  editingMode = snapshot.editingMode;

  const modeSelect = $("#editor-mode-select");
  if (modeSelect) modeSelect.value = editingMode;

  renderAll();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("#undo-action").disabled = history.undo.length === 0;
  $("#redo-action").disabled = history.redo.length === 0;
}

function renderAll() {
  if (editingMode === "weapon") {
    grid.visible = false;
    boundsHelper.visible = false;
    weaponGrid.visible = true;
    mapGroup.visible = false;
    weaponGroup.visible = true;
    rebuildWeaponScene();
    renderWeaponFields();
    renderInspector();
  } else {
    grid.visible = true;
    boundsHelper.visible = layers.bounds;
    weaponGrid.visible = false;
    mapGroup.visible = true;
    weaponGroup.visible = false;
    scene.background = new THREE.Color(numberOr(map.sky, colors.floor));
    scene.fog = new THREE.Fog(numberOr(map.fog, map.sky), numberOr(map.fogNear, 60), numberOr(map.fogFar, 180));
    grid.material.color.set(numberOr(map.gridA, colors.gridA));
    grid.material.vertexColors = false;
    rebuildMap();
    updateBoundsHelper();
    renderMapFields();
    renderInspector();
    renderVisibility();
    updateExport();
    renderValidation(validateMap());
  }
}

function rebuildMap() {
  selected = keepSelectionReference(selected);
  transform.detach();
  selectable.length = 0;
  mapGroup.clear();

  if (layers.floors) {
    map.floors.forEach((floor, index) => addSelectable(createFloorMesh(floor, index), "floors", index));
  }

  if (layers.boxes) {
    map.boxes.forEach((box, index) => addSelectable(createBoxMesh(box, "boxes"), "boxes", index));
  }

  if (layers.platforms) {
    map.platforms.forEach((box, index) => addSelectable(createBoxMesh(box, "platforms"), "platforms", index));
  }

  if (layers.ramps) {
    map.ramps.forEach((ramp, index) => addSelectable(createRampMesh(ramp), "ramps", index));
  }

  if (layers.collision) {
    map.collision.forEach((box, index) => addSelectable(createBoxMesh(box, "collision"), "collision", index));
  }

  if (layers.decor) {
    map.decor.forEach((box, index) => addSelectable(createBoxMesh(box, "decor"), "decor", index));
  }

  if (layers.spawns) {
    map.spawnPoints.forEach((spawn, index) => addSelectable(createSpawnMesh(spawn, index), "spawnPoints", index));
  }

  if (layers.assets) {
    map.assets.forEach((asset, index) => addAssetMesh(asset, index));
  }

  if (selected) {
    const mesh = selectable.find((item) => item.userData.kind === selected.kind && item.userData.index === selected.index);
    if (mesh) selectMesh(mesh);
    else clearSelection();
  }
}

function addSelectable(mesh, kind, index) {
  mesh.userData.kind = kind;
  mesh.userData.index = index;
  selectable.push(mesh);
  if (editingMode === "weapon") {
    weaponGroup.add(mesh);
  } else {
    mapGroup.add(mesh);
  }
}

function createFloorMesh(floor) {
  const geometry = new THREE.BoxGeometry(Math.max(0.1, floor.sx || 10), 0.08, Math.max(0.1, floor.sz || 10));
  const material = new THREE.MeshStandardMaterial({ color: numberOr(map.floor, colors.floor), roughness: 0.8, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.position.set(numberOr(floor.x, 0), -0.04, numberOr(floor.z, 0));
  return mesh;
}

function createBoxMesh(box, kind) {
  const sx = positive(box.sx, 4);
  const sy = positive(box.sy, 2);
  const sz = positive(box.sz, 4);
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  const color = kind === "collision" ? colors.collision : numberOr(box.color, colors[kind] || colors.box);
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: kind === "collision" || box.visible === false,
    opacity: kind === "collision" ? 0.33 : box.visible === false ? 0.18 : 0.94,
    roughness: 0.64,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = kind !== "collision";
  mesh.receiveShadow = true;
  mesh.position.set(numberOr(box.x, 0), numberOr(box.y, 0) + sy / 2, numberOr(box.z, 0));
  mesh.rotation.set(numberOr(box.rotX, 0), numberOr(box.rotY, 0), numberOr(box.rotZ, 0));
  mesh.userData.baseScale = { sx, sy, sz };

  if (kind === "collision") {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: colors.collision }));
    mesh.add(edges);
  }

  return mesh;
}

function createRampMesh(ramp) {
  const width = positive(ramp.width, 4);
  const length = positive(ramp.length, 8);
  const height = positive(ramp.height, 2);
  const y = numberOr(ramp.y, 1);
  const geometry = makeRampGeometry({ ...ramp, width, length, height });
  const material = new THREE.MeshStandardMaterial({ color: numberOr(ramp.color, colors.ramp), roughness: 0.72 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(numberOr(ramp.x, 0), y, numberOr(ramp.z, 0));
  mesh.rotation.y = numberOr(ramp.rot, 0);
  mesh.userData.baseScale = { width, length, height };
  return mesh;
}

function createSpawnMesh(spawn, index) {
  const group = new THREE.Group();
  const color = index === 0 ? colors.spawn0 : colors.spawn1;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.08, 12, 48),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 1.2, 4),
    new THREE.MeshStandardMaterial({ color })
  );
  cone.position.y = 0.75;
  cone.rotation.y = Math.PI / 4;
  group.add(ring, cone);
  group.position.set(numberOr(spawn.x, 0), 0, numberOr(spawn.z, 0));
  return group;
}

function addAssetMesh(asset, index) {
  const placeholder = createAssetPlaceholder(asset);
  addSelectable(placeholder, "assets", index);
  const url = (asset.url || "").trim();
  if (!url) return;

  if (assetCache.has(url)) {
    attachAssetClone(assetCache.get(url), asset, placeholder);
    return;
  }

  loader.load(
    url,
    (gltf) => {
      assetCache.set(url, gltf.scene);
      attachAssetClone(gltf.scene, asset, placeholder);
    },
    undefined,
    () => {
      placeholder.userData.loadFailed = true;
      placeholder.children.forEach((child) => {
        if (child.material) child.material.color.set(colors.collision);
      });
    }
  );
}

function createAssetPlaceholder(asset) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(3, 3, 3),
    new THREE.MeshStandardMaterial({ color: colors.asset, transparent: true, opacity: 0.38 })
  );
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), new THREE.LineBasicMaterial({ color: colors.asset }));
  box.add(edges);
  group.add(box);
  applyAssetTransform(group, asset);
  return group;
}

function attachAssetClone(source, asset, placeholder) {
  while (placeholder.children.length) placeholder.remove(placeholder.children[0]);
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  placeholder.add(clone);
  applyAssetTransform(placeholder, asset);
}

function applyAssetTransform(mesh, asset) {
  const position = asset.position || {};
  const rotation = asset.rotation || {};
  mesh.position.set(numberOr(position.x, 0), numberOr(position.y, 0), numberOr(position.z, 0));
  mesh.rotation.set(numberOr(rotation.x, 0), numberOr(rotation.y, 0), numberOr(rotation.z, 0));
  const scale = positive(asset.scale, 1);
  mesh.scale.setScalar(scale);
}

function updateBoundsHelper() {
  boundsHelper.visible = layers.bounds;
  const bx = positive(map.bounds?.x, 50);
  const bz = positive(map.bounds?.z, 50);
  const y = 0.03;
  const points = [
    -bx, y, -bz, bx, y, -bz,
    bx, y, -bz, bx, y, bz,
    bx, y, bz, -bx, y, bz,
    -bx, y, bz, -bx, y, -bz,
  ];
  boundsHelper.geometry.dispose();
  boundsHelper.geometry = new THREE.BufferGeometry();
  boundsHelper.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
}

function renderMapFields() {
  $("#map-fields").innerHTML = mapFields.map(([path, label, type, wide]) => fieldTemplate("map", path, label, getByPath(map, path), type, wide)).join("");
}

function renderInspector() {
  const inspector = $("#inspector");
  const empty = $("#inspector-empty");
  if (!selected) {
    inspector.innerHTML = "";
    empty.style.display = "block";
    $("#selection-label").textContent = "Nothing selected";
    return;
  }

  const data = getSelectedData();
  if (!data) {
    clearSelection();
    return;
  }

  const fields = objectFields[selected.kind] || [];
  const title = `${labels[selected.kind]} ${selected.index + 1}${data.name ? ` · ${data.name}` : ""}`;
  $("#selection-label").textContent = title;
  empty.style.display = "none";
  inspector.innerHTML = fields.map(([path, label, type, wide]) => fieldTemplate("object", path, label, getByPath(data, path), type, wide)).join("");
}

function renderVisibility() {
  $("#visibility-fields").innerHTML = Object.keys(layers).map((key) => `
    <label>
      <span>${titleCase(key)}</span>
      <input type="checkbox" data-layer="${key}" ${layers[key] ? "checked" : ""} />
    </label>
  `).join("");
}

function fieldTemplate(scope, path, label, value, type = "text", wide = false) {
  const id = `${scope}-${path.replaceAll(".", "-")}`;
  const valueText = type === "color" ? numberToHex(value) : value ?? "";
  if (type === "checkbox") {
    return `
      <label class="field ${wide ? "wide" : ""}" for="${id}">
        <span>${label}</span>
        <input id="${id}" type="checkbox" data-scope="${scope}" data-path="${path}" ${value ? "checked" : ""} />
      </label>
    `;
  }
  return `
    <label class="field ${wide ? "wide" : ""}" for="${id}">
      <span>${label}</span>
      <input id="${id}" type="${type === "color" ? "color" : type}" data-scope="${scope}" data-path="${path}" value="${escapeHtml(valueText)}" ${type === "number" ? 'step="0.01"' : ""} />
    </label>
  `;
}

function renderWeaponFields() {
  const fields = [
    ["label", "Label", "text"],
    ["ammo", "Ammo", "number"],
    ["damage", "Damage", "number"],
    ["crit", "Crit Multiplier", "number"],
    ["reload", "Reload Time", "number"],
    ["fireDelay", "Fire Delay (ms)", "number"],
    ["range", "Range", "number"],
    ["spread", "Spread", "number"],
    ["aimSpread", "Aim Spread", "number"],
    ["moveScale", "Move Speed Multiplier", "number"],
    ["scale", "Render Scale", "number"],
    ["firstPersonOffset.x", "FP Offset X", "number"],
    ["firstPersonOffset.y", "FP Offset Y", "number"],
    ["firstPersonOffset.z", "FP Offset Z", "number"],
    ["muzzle.x", "Muzzle X", "number"],
    ["muzzle.y", "Muzzle Y", "number"],
    ["muzzle.z", "Muzzle Z", "number"],
  ];
  const weapon = getActiveWeapon();
  if (weapon) {
    $("#weapon-fields").innerHTML = fields.map(([path, label, type, wide]) => fieldTemplate("weapon", path, label, getByPath(weapon, path), type, wide)).join("");
  }
  updateWeaponOutput();
}

function selectMesh(mesh) {
  selected = { kind: mesh.userData.kind, index: mesh.userData.index };
  clearHighlight();
  mesh.userData.selected = true;
  applyHighlight(mesh, true);
  transform.attach(mesh);
  renderInspector();
  switchTab("inspect");
}

function clearSelection() {
  selected = null;
  clearHighlight();
  transform.detach();
  renderInspector();
}

function clearHighlight() {
  selectable.forEach((item) => {
    if (item.userData.selected) applyHighlight(item, false);
    item.userData.selected = false;
  });
}

function applyHighlight(mesh, enabled) {
  mesh.traverse((child) => {
    if (child.material && child.material.emissive) {
      child.material.emissive.set(enabled ? 0xffffff : 0x000000);
      child.material.emissiveIntensity = enabled ? 0.1 : 0;
    }
  });
}

function getSelectedData() {
  if (!selected) return null;
  if (editingMode === "weapon") {
    if (selected.kind === "parts") return getActiveWeapon()?.parts?.[selected.index] || null;
    if (selected.kind === "muzzle") return getActiveWeapon()?.muzzle || null;
    return null;
  }
  return map[selected.kind]?.[selected.index] || null;
}

function keepSelectionReference(current) {
  if (!current) return null;
  return map[current.kind]?.[current.index] ? current : null;
}

function onPointerDown(event) {
  if (fpsTest.active) return;
  if (isTransforming || event.button !== 0) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(selectable, true);
  if (!hits.length) {
    clearSelection();
    return;
  }
  let target = hits[0].object;
  while (target.parent && !target.userData.kind) target = target.parent;
  if (target.userData.kind) selectMesh(target);
}

function addObject(kind) {
  const center = sceneCenterOnGround();
  const before = getHistorySnapshot();
  if (kind === "box") {
    map.boxes.push({ name: uniqueName("box"), x: center.x, y: 0, z: center.z, sx: 4, sy: 2, sz: 4, rotX: 0, rotY: 0, rotZ: 0, color: colors.box, visible: true });
    selectAfterRebuild("boxes", map.boxes.length - 1);
  } else if (kind === "platform") {
    map.platforms.push({ name: uniqueName("platform"), x: center.x, y: 1, z: center.z, sx: 8, sy: 1, sz: 8, rotX: 0, rotY: 0, rotZ: 0, color: colors.platform, isPlatform: true, visible: true });
    selectAfterRebuild("platforms", map.platforms.length - 1);
  } else if (kind === "ramp") {
    map.ramps.push({ name: uniqueName("ramp"), x: center.x, y: 1, z: center.z, width: 6, length: 12, height: 3, rot: 0, color: colors.ramp });
    selectAfterRebuild("ramps", map.ramps.length - 1);
  } else if (kind === "collision") {
    map.collision.push({ name: uniqueName("collision"), x: center.x, y: 0, z: center.z, sx: 4, sy: 4, sz: 4, rotX: 0, rotY: 0, rotZ: 0 });
    selectAfterRebuild("collision", map.collision.length - 1);
  } else if (kind === "decor") {
    map.decor.push({ name: uniqueName("decor"), x: center.x, y: 0, z: center.z, sx: 3, sy: 5, sz: 1, rotX: 0, rotY: 0, rotZ: 0, color: colors.decor, collidable: false, visible: true });
    selectAfterRebuild("decor", map.decor.length - 1);
  } else if (kind === "spawn") {
    map.spawnPoints.push({ x: center.x, z: center.z });
    selectAfterRebuild("spawnPoints", map.spawnPoints.length - 1);
  } else if (kind === "floor") {
    map.floors.push({ x: center.x, z: center.z, sx: 24, sz: 18 });
    selectAfterRebuild("floors", map.floors.length - 1);
  } else if (kind === "asset") {
    map.assets.push({ url: "assets/models/model.glb", position: { x: center.x, y: 0, z: center.z }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, collidable: false });
    selectAfterRebuild("assets", map.assets.length - 1);
  }
  pushUndoSnapshot(before);
}

function selectAfterRebuild(kind, index) {
  selected = { kind, index };
  renderAll();
  switchTab("inspect");
}

function duplicateSelection() {
  const before = getHistorySnapshot();
  if (editingMode === "weapon") {
    const weapon = getActiveWeapon();
    if (!weapon || !selected || selected.kind !== "parts") return;
    const part = weapon.parts?.[selected.index];
    if (!part) return;
    const copy = structuredClone(part);
    copy.name = uniquePartName(copy.type);
    copy.x += 0.05;
    weapon.parts.push(copy);
    pushUndoSnapshot(before);
    renderAll();
    selectAfterRebuild("parts", weapon.parts.length - 1);
    return;
  }
  const data = getSelectedData();
  if (!selected || !data) return;
  const copy = structuredClone(data);
  if ("name" in copy) copy.name = uniqueName(copy.name || selected.kind);
  nudgeData(copy);
  map[selected.kind].push(copy);
  pushUndoSnapshot(before);
  selectAfterRebuild(selected.kind, map[selected.kind].length - 1);
}

function deleteSelection() {
  const before = getHistorySnapshot();
  if (editingMode === "weapon") {
    const weapon = getActiveWeapon();
    if (!weapon || !selected || selected.kind !== "parts") return;
    weapon.parts.splice(selected.index, 1);
    clearSelection();
    pushUndoSnapshot(before);
    renderAll();
    return;
  }
  if (!selected) return;
  map[selected.kind].splice(selected.index, 1);
  clearSelection();
  pushUndoSnapshot(before);
  renderAll();
}

function nudgeData(data) {
  if ("x" in data) data.x += 2;
  if ("z" in data) data.z += 2;
  if (data.position) {
    data.position.x += 2;
    data.position.z += 2;
  }
}

function sceneCenterOnGround() {
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  const distance = camera.position.y / Math.max(0.2, -direction.y);
  const point = camera.position.clone().add(direction.multiplyScalar(distance));
  const size = gridSize();
  if ($("#snap-enabled").checked) {
    point.x = snap(point.x, size);
    point.z = snap(point.z, size);
  }
  return point;
}

function syncDataFromMesh(mesh, bakeScale = false) {
  const kind = mesh.userData.kind;
  if (editingMode === "weapon") {
    if (kind === "muzzle") {
      const target = getActiveWeapon()?.muzzle;
      if (target) {
        target.x = roundMaybe(mesh.position.x);
        target.y = roundMaybe(mesh.position.y);
        target.z = roundMaybe(mesh.position.z);
      }
    } else if (kind === "parts") {
      const target = getActiveWeapon()?.parts?.[mesh.userData.index];
      if (target) {
        target.x = roundMaybe(mesh.position.x);
        target.y = roundMaybe(mesh.position.y);
        target.z = roundMaybe(mesh.position.z);
        target.rotX = roundMaybe(mesh.rotation.x);
        target.rotY = roundMaybe(mesh.rotation.y);
        target.rotZ = roundMaybe(mesh.rotation.z);
        if (bakeScale) {
          const base = mesh.userData.baseScale || {};
          target.sx = roundMaybe(positive(base.sx, target.sx) * Math.abs(mesh.scale.x));
          target.sy = roundMaybe(positive(base.sy, target.sy) * Math.abs(mesh.scale.y));
          target.sz = roundMaybe(positive(base.sz, target.sz) * Math.abs(mesh.scale.z));
        }
      }
    }
    if (bakeScale) rebuildWeaponScene();
    else {
      renderWeaponFields();
      renderInspector();
      updateWeaponOutput();
    }
    return;
  }

  const data = map[kind]?.[mesh.userData.index];
  if (!data) return;

  if (kind === "spawnPoints") {
    data.x = roundMaybe(mesh.position.x);
    data.z = roundMaybe(mesh.position.z);
  } else if (kind === "floors") {
    data.x = roundMaybe(mesh.position.x);
    data.z = roundMaybe(mesh.position.z);
    if (bakeScale) {
      data.sx = roundMaybe(positive(data.sx, 10) * Math.abs(mesh.scale.x));
      data.sz = roundMaybe(positive(data.sz, 10) * Math.abs(mesh.scale.z));
    }
  } else if (kind === "ramps") {
    const base = mesh.userData.baseScale || {};
    data.x = roundMaybe(mesh.position.x);
    data.y = roundMaybe(mesh.position.y);
    data.z = roundMaybe(mesh.position.z);
    data.rot = roundMaybe(mesh.rotation.y);
    if (bakeScale) {
      data.width = roundMaybe(positive(base.width, data.width) * Math.abs(mesh.scale.x));
      data.height = roundMaybe(positive(base.height, data.height) * Math.abs(mesh.scale.y));
      data.length = roundMaybe(positive(base.length, data.length) * Math.abs(mesh.scale.z));
    }
  } else if (kind === "assets") {
    data.position ||= {};
    data.rotation ||= {};
    data.position.x = roundMaybe(mesh.position.x);
    data.position.y = roundMaybe(mesh.position.y);
    data.position.z = roundMaybe(mesh.position.z);
    data.rotation.x = roundMaybe(mesh.rotation.x);
    data.rotation.y = roundMaybe(mesh.rotation.y);
    data.rotation.z = roundMaybe(mesh.rotation.z);
    if (bakeScale) data.scale = roundMaybe(mesh.scale.x);
  } else {
    const sy = positive(data.sy, 2);
    const base = mesh.userData.baseScale || {};
    data.x = roundMaybe(mesh.position.x);
    data.y = roundMaybe(mesh.position.y - sy / 2);
    data.z = roundMaybe(mesh.position.z);
    data.rotX = roundMaybe(mesh.rotation.x);
    data.rotY = roundMaybe(mesh.rotation.y);
    data.rotZ = roundMaybe(mesh.rotation.z);
    if (bakeScale) {
      data.sx = roundMaybe(positive(base.sx, data.sx) * Math.abs(mesh.scale.x));
      data.sy = roundMaybe(positive(base.sy, data.sy) * Math.abs(mesh.scale.y));
      data.sz = roundMaybe(positive(base.sz, data.sz) * Math.abs(mesh.scale.z));
    }
  }

  if (bakeScale) renderAll();
  else {
    renderInspector();
    updateExport();
  }
}

function setTransformMode(mode) {
  transform.setMode(mode);
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
}

function updateSnapSettings() {
  const enabled = $("#snap-enabled").checked;
  const size = gridSize();
  const radians = rotationSnapRadians();
  transform.setTranslationSnap(enabled ? size : null);
  transform.setScaleSnap(enabled ? size : null);
  transform.setRotationSnap(enabled ? radians : null);
}

function setInputValue(scope, path, rawValue, checked, inputType) {
  if (editingMode === "weapon") {
    const target = scope === "map" ? null : scope === "object" ? getSelectedData() : getActiveWeapon();
    if (!target) return;
    const value = parseFieldValue(rawValue, checked, inputType);
    setByPath(target, path, value);
    rebuildWeaponScene();
    updateWeaponOutput();
    return;
  }
  const target = scope === "map" ? map : scope === "object" ? getSelectedData() : weaponConfig;
  if (!target) return;
  const value = parseFieldValue(rawValue, checked, inputType);
  setByPath(target, path, value);
  if (scope === "weapon") {
    updateWeaponOutput();
    return;
  }
  renderAll();
}

function parseFieldValue(rawValue, checked, inputType) {
  if (inputType === "checkbox") return checked;
  if (inputType === "color") return parseInt(rawValue.replace("#", ""), 16);
  if (inputType === "number") return roundMaybe(Number(rawValue) || 0);
  return rawValue;
}

function updateExport() {
  const output = JSON.stringify(cleanForExport(map), null, 2);
  $("#export-output").value = output;
  const id = slug(map.id || map.name || "new-map");
  $("#manifest-entry").value = `"fps/${id}.json"`;
}

function updateWeaponOutput() {
  if (editingMode === "weapon") {
    if (loadedSingleWeapon) {
      const current = weaponsData.weapons[activeWeaponId] || {};
      $("#weapon-output").value = JSON.stringify(current, null, 2);
    } else {
      $("#weapon-output").value = JSON.stringify(weaponsData, null, 2);
    }
  } else {
    $("#weapon-output").value = JSON.stringify({ [weaponConfig.id || "weapon"]: weaponConfig }, null, 2);
  }
}

function cleanForExport(source) {
  const clone = structuredClone(source);
  for (const key of ["boxes", "platforms", "collision", "decor"]) {
    clone[key] = clone[key].map((box) => ({
      ...box,
      x: roundMaybe(box.x),
      y: roundMaybe(box.y),
      z: roundMaybe(box.z),
      sx: roundMaybe(box.sx),
      sy: roundMaybe(box.sy),
      sz: roundMaybe(box.sz),
      rotX: roundMaybe(box.rotX || 0),
      rotY: roundMaybe(box.rotY || 0),
      rotZ: roundMaybe(box.rotZ || 0),
    }));
  }
  clone.ramps = clone.ramps.map((ramp) => ({
    ...ramp,
    x: roundMaybe(ramp.x),
    y: roundMaybe(ramp.y ?? 1),
    z: roundMaybe(ramp.z),
    width: roundMaybe(ramp.width),
    length: roundMaybe(ramp.length),
    height: roundMaybe(ramp.height),
    rot: roundMaybe(ramp.rot || 0),
  }));
  clone.spawnPoints = clone.spawnPoints.map((spawn) => ({ x: roundMaybe(spawn.x), z: roundMaybe(spawn.z) }));
  return clone;
}

function validateMap() {
  const issues = [];
  if (!map.id || !slug(map.id)) issues.push(["error", "Map ID is missing or cannot be used as a file name."]);
  if (!map.name) issues.push(["warn", "Map name is empty."]);
  if (map.spawnPoints.length < 2) issues.push(["error", "FPS maps need at least two spawn points."]);
  if (!map.floors.length) issues.push(["error", "At least one floor rectangle is required."]);

  const seenNames = new Map();
  forEachNamedObject((kind, object, index) => {
    if (!object.name) return;
    const key = object.name.toLowerCase();
    if (seenNames.has(key)) issues.push(["warn", `Duplicate object name "${object.name}" in ${kind} ${index + 1}.`]);
    seenNames.set(key, true);
  });

  for (const [kind, list] of [["boxes", map.boxes], ["platforms", map.platforms], ["decor", map.decor], ["collision", map.collision]]) {
    list.forEach((box, index) => {
      if (!isBoxInsideAnyFloor(box)) issues.push(["warn", `${labels[kind]} ${index + 1} sits outside the floor layout.`]);
      if (positive(box.sx, 0) <= 0 || positive(box.sy, 0) <= 0 || positive(box.sz, 0) <= 0) issues.push(["error", `${labels[kind]} ${index + 1} has a non-positive size.`]);
    });
  }

  map.ramps.forEach((ramp, index) => {
    if (!isRampInsideAnyFloor(ramp)) issues.push(["warn", `Ramp ${index + 1} sits outside the floor layout.`]);
    if (positive(ramp.length, 0) <= 0 || positive(ramp.width, 0) <= 0) issues.push(["error", `Ramp ${index + 1} has a non-positive size.`]);
    if (positive(ramp.height, 0) / Math.max(0.01, positive(ramp.length, 1)) > 0.45) issues.push(["warn", `Ramp ${index + 1} is steep; FPS movement may feel abrupt.`]);
  });

  map.spawnPoints.forEach((spawn, index) => {
    if (!pointInsideAnyFloor(spawn.x, spawn.z)) issues.push(["error", `Spawn ${index + 1} is outside every floor.`]);
    if (spawnIntersectsCollision(spawn)) issues.push(["error", `Spawn ${index + 1} overlaps solid gameplay geometry.`]);
  });

  map.assets.forEach((asset, index) => {
    if (!asset.url || !asset.url.trim()) issues.push(["warn", `Asset ${index + 1} is missing a GLB/GLTF URL.`]);
    if (asset.collidable) issues.push(["warn", `Asset ${index + 1} is marked collidable; export simple collision boxes for predictable gameplay.`]);
  });

  if (!issues.length) issues.push(["ok", "Map passes the editor checks."]);
  return issues;
}

function renderValidation(issues) {
  $("#validation-output").innerHTML = issues.map(([level, message]) => `
    <div class="issue">
      <span class="badge ${level}">${level}</span>
      <span>${escapeHtml(message)}</span>
    </div>
  `).join("");
}

function forEachNamedObject(callback) {
  for (const kind of ["boxes", "platforms", "ramps", "collision", "decor"]) {
    map[kind].forEach((object, index) => callback(kind, object, index));
  }
}

function isBoxInsideAnyFloor(box) {
  const sx = positive(box.sx, 0);
  const sz = positive(box.sz, 0);
  return rectInsideAnyFloor(numberOr(box.x, 0), numberOr(box.z, 0), sx, sz);
}

function isRampInsideAnyFloor(ramp) {
  const size = Math.max(positive(ramp.width, 0), positive(ramp.length, 0));
  return rectInsideAnyFloor(numberOr(ramp.x, 0), numberOr(ramp.z, 0), size, size);
}

function rectInsideAnyFloor(x, z, sx, sz) {
  return map.floors.some((floor) => {
    const halfX = positive(floor.sx, 0) / 2;
    const halfZ = positive(floor.sz, 0) / 2;
    const fx = numberOr(floor.x, 0);
    const fz = numberOr(floor.z, 0);
    return x - sx / 2 >= fx - halfX && x + sx / 2 <= fx + halfX && z - sz / 2 >= fz - halfZ && z + sz / 2 <= fz + halfZ;
  });
}

function pointInsideAnyFloor(x, z) {
  return map.floors.some((floor) => {
    const halfX = positive(floor.sx, 0) / 2;
    const halfZ = positive(floor.sz, 0) / 2;
    const fx = numberOr(floor.x, 0);
    const fz = numberOr(floor.z, 0);
    return x >= fx - halfX && x <= fx + halfX && z >= fz - halfZ && z <= fz + halfZ;
  });
}

function spawnIntersectsCollision(spawn) {
  const solids = [...map.boxes, ...map.collision, ...map.decor.filter((item) => item.collidable)];
  return solids.some((box) => {
    const sx = positive(box.sx, 0) / 2 + 1;
    const sz = positive(box.sz, 0) / 2 + 1;
    return Math.abs(numberOr(spawn.x, 0) - numberOr(box.x, 0)) < sx && Math.abs(numberOr(spawn.z, 0) - numberOr(box.z, 0)) < sz;
  });
}

function uniqueName(prefix) {
  const cleanPrefix = slug(prefix) || "object";
  const names = new Set();
  forEachNamedObject((kind, object) => {
    if (object.name) names.add(object.name.toLowerCase());
  });
  let index = 1;
  let candidate = `${cleanPrefix}-${index}`;
  while (names.has(candidate.toLowerCase())) {
    index += 1;
    candidate = `${cleanPrefix}-${index}`;
  }
  return candidate;
}

function previewWeaponModel() {
  const existing = scene.getObjectByName("weapon-preview");
  if (existing) scene.remove(existing);
  const group = new THREE.Group();
  group.name = "weapon-preview";
  group.position.set(-8, 4, -10);
  scene.add(group);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), new THREE.MeshStandardMaterial({ color: colors.accent || colors.ramp }));
  marker.position.set(weaponConfig.muzzle.x, weaponConfig.muzzle.y, weaponConfig.muzzle.z);
  group.add(marker);

  loader.load(
    weaponConfig.model,
    (gltf) => {
      group.add(gltf.scene);
      gltf.scene.scale.setScalar(positive(weaponConfig.scale, 1));
    },
    undefined,
    () => {
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.7), new THREE.MeshStandardMaterial({ color: colors.asset }));
      placeholder.scale.setScalar(positive(weaponConfig.scale, 1));
      group.add(placeholder);
    }
  );
}

function startQuickTest() {
  clearSelection();
  editorCameraState = {
    position: camera.position.clone(),
    rotation: camera.rotation.clone(),
    target: orbit.target.clone(),
  };
  transform.detach();
  transform.enabled = false;
  orbit.enabled = false;
  $("#test-overlay").classList.remove("hidden");
  fpsTest.start(cleanForExport(map), 0);
}

function exitQuickTest() {
  $("#test-overlay").classList.add("hidden");
  transform.enabled = true;
  orbit.enabled = true;
  if (editorCameraState) {
    camera.position.copy(editorCameraState.position);
    camera.rotation.copy(editorCameraState.rotation);
    orbit.target.copy(editorCameraState.target);
    orbit.update();
  }
  editorCameraState = null;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  
  if (name === "weapon" && editingMode !== "weapon") {
    const before = getHistorySnapshot();
    setEditorMode("weapon");
    pushUndoSnapshot(before);
  } else if (name === "map" && editingMode !== "map") {
    const before = getHistorySnapshot();
    setEditorMode("map");
    pushUndoSnapshot(before);
  }
}

function setEditorMode(mode) {
  editingMode = mode;
  const modeSelect = $("#editor-mode-select");
  if (modeSelect) modeSelect.value = mode;
  
  const mapPlace = $("#map-place-tools");
  const weaponPlace = $("#weapon-place-tools");
  if (mapPlace) mapPlace.style.display = mode === "weapon" ? "none" : "grid";
  if (weaponPlace) weaponPlace.style.display = mode === "weapon" ? "grid" : "none";
  
  const quickTest = $("#quick-test");
  const validateMapBtn = $("#validate-map");
  const mapLoadBtn = $("#map-load-button");
  const sampleMapBtn = $("#sample-map");
  const exportMapBtn = $("#export-map");
  
  const weaponLoadBtn = $("#weapon-load-button");
  const exportWeaponsBtn = $("#export-weapons");
  
  const displayVal = mode === "weapon" ? "none" : "";
  if (quickTest) quickTest.style.display = displayVal;
  if (validateMapBtn) validateMapBtn.style.display = displayVal;
  if (mapLoadBtn) mapLoadBtn.style.display = mode === "weapon" ? "none" : "inline-flex";
  if (sampleMapBtn) sampleMapBtn.style.display = displayVal;
  if (exportMapBtn) exportMapBtn.style.display = displayVal;
  
  const weaponDisplayVal = mode === "weapon" ? "inline-flex" : "none";
  if (weaponLoadBtn) weaponLoadBtn.style.display = weaponDisplayVal;
  if (exportWeaponsBtn) exportWeaponsBtn.style.display = weaponDisplayVal;
  
  const gridSizeInput = $("#grid-size");
  if (gridSizeInput) {
    if (mode === "weapon") {
      gridSizeInput.min = "0.01";
      gridSizeInput.step = "0.01";
      gridSizeInput.value = "0.02"; // default weapon snap grid: 2cm
    } else {
      gridSizeInput.min = "0.25";
      gridSizeInput.step = "0.25";
      gridSizeInput.value = "1.0"; // default map snap grid: 1m
    }
    updateSnapSettings();
  }
  
  clearSelection();
  renderAll();
}

async function exportCurrentFile() {
  const isWeapon = editingMode === "weapon";
  if (isWeapon) {
    updateWeaponOutput();
  } else {
    updateExport();
  }
  
  const data = isWeapon ? $("#weapon-output").value : $("#export-output").value;
  const fileName = isWeapon
    ? (loadedSingleWeapon ? `${activeWeaponId}.json` : "weapons.json")
    : `${slug(map.id || map.name || "new-map")}.json`;

  let handle = isWeapon ? weaponFileHandle : mapFileHandle;

  if (window.showSaveFilePicker) {
    if (!handle) {
      try {
        handle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'JSON Files',
            accept: { 'application/json': ['.json'] }
          }]
        });
        if (isWeapon) {
          weaponFileHandle = handle;
        } else {
          mapFileHandle = handle;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn("Save file picker failed, falling back to download", err);
      }
    }

    if (handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
        console.log("Saved successfully via File System Access API");
        return;
      } catch (err) {
        console.warn("Writing to handle failed, falling back to download or trying new picker", err);
        if (isWeapon) weaponFileHandle = null;
        else mapFileHandle = null;
      }
    }
  }

  // Fallback to blob download if picker is unsupported or failed
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadMapFile(file) {
  if (!file) return;
  const text = await file.text();
  const before = getHistorySnapshot();
  map = normalizeMap(JSON.parse(text));
  selected = null;
  pushUndoSnapshot(before);
  renderAll();
}

async function loadMapViaPicker() {
  if (!window.showOpenFilePicker) return;
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'JSON Files',
        accept: { 'application/json': ['.json'] }
      }],
      multiple: false
    });
    mapFileHandle = handle;
    const file = await handle.getFile();
    await loadMapFile(file);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

async function loadWeaponFile(file) {
  if (!file) return;
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    const id = file.name.replace(/\.json$/i, "");
    const before = getHistorySnapshot();
    if (data.weapons) {
      weaponsData = data;
      activeWeaponId = Object.keys(weaponsData.weapons || {})[0] || "pistol";
      loadedSingleWeapon = false;
    } else if (data.parts) {
      weaponsData = {
        version: 1,
        weapons: {
          [id]: data
        }
      };
      activeWeaponId = id;
      loadedSingleWeapon = true;
    } else {
      throw new Error("Invalid weapons JSON format: must contain 'weapons' or 'parts'");
    }
    pushUndoSnapshot(before);
    renderWeaponList();
    if (editingMode === "weapon") {
      clearSelection();
      rebuildWeaponScene();
    }
  } catch (e) {
    alert("Error parsing weapons JSON: " + e.message);
  }
}

async function loadWeaponViaPicker() {
  if (!window.showOpenFilePicker) return;
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'JSON Files',
        accept: { 'application/json': ['.json'] }
      }],
      multiple: false
    });
    weaponFileHandle = handle;
    const file = await handle.getFile();
    await loadWeaponFile(file);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

function getByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setByPath(object, path, value) {
  const parts = path.split(".");
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] ||= {};
    target = target[key];
  }
  target[parts[0]] = value;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function numberToHex(value) {
  return `#${numberOr(value, 0).toString(16).padStart(6, "0").slice(-6)}`;
}

function roundMaybe(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
}

function snap(value, size) {
  return Math.round(value / size) * size;
}

function gridSize() {
  const minVal = editingMode === "weapon" ? 0.001 : 0.1;
  return Math.max(minVal, Number($("#grid-size").value) || (editingMode === "weapon" ? 0.02 : 1));
}

function rotationSnapRadians() {
  return THREE.MathUtils.degToRad(Math.max(1, Number($("#rotate-snap").value) || 15));
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  const dt = frameClock.getDelta();
  if (fpsTest.active) fpsTest.update(dt);
  else orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

viewport.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", (event) => {
  if (fpsTest.active) event.preventDefault();
});

transform.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
  isTransforming = event.value;
  if (event.value) {
    transformStartSnapshot = getHistorySnapshot();
  } else {
    pushUndoSnapshot(transformStartSnapshot);
    transformStartSnapshot = null;
  }
});

transform.addEventListener("objectChange", () => {
  const object = transform.object;
  if (!object) return;
  if ($("#snap-enabled").checked && transform.mode === "translate") {
    const size = gridSize();
    object.position.x = snap(object.position.x, size);
    object.position.y = snap(object.position.y, size);
    object.position.z = snap(object.position.z, size);
  }
  syncDataFromMesh(object, false);
});

transform.addEventListener("mouseUp", () => {
  if (transform.object) syncDataFromMesh(transform.object, transform.mode === "scale");
});

document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addObject(button.dataset.add)));
document.querySelectorAll("[data-add-part]").forEach((button) => button.addEventListener("click", () => addWeaponPart(button.dataset.addPart)));
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setTransformMode(button.dataset.mode)));
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

$("#editor-mode-select")?.addEventListener("change", (e) => {
  const before = getHistorySnapshot();
  setEditorMode(e.target.value);
  pushUndoSnapshot(before);
});

$("#active-weapon-select")?.addEventListener("change", (e) => {
  const before = getHistorySnapshot();
  activeWeaponId = e.target.value;
  clearSelection();
  pushUndoSnapshot(before);
  renderAll();
});

$("#weapons-file")?.addEventListener("change", (event) => {
  loadWeaponFile(event.target.files[0]);
});

$("#map-load-button")?.addEventListener("click", (event) => {
  if (window.showOpenFilePicker) {
    event.preventDefault();
    loadMapViaPicker();
  }
});

$("#weapon-load-button")?.addEventListener("click", (event) => {
  if (window.showOpenFilePicker) {
    event.preventDefault();
    loadWeaponViaPicker();
  }
});

$("#export-weapons")?.addEventListener("click", () => {
  exportCurrentFile();
});

$("#select-muzzle-tool")?.addEventListener("click", () => {
  const muzzleMesh = selectable.find(item => item.userData.kind === "muzzle");
  if (muzzleMesh) selectMesh(muzzleMesh);
});

$("#duplicate-object").addEventListener("click", duplicateSelection);
$("#delete-object").addEventListener("click", deleteSelection);
$("#undo-action").addEventListener("click", undoChange);
$("#redo-action").addEventListener("click", redoChange);
$("#sample-map").addEventListener("click", () => {
  const before = getHistorySnapshot();
  map = createSampleMap();
  selected = null;
  pushUndoSnapshot(before);
  renderAll();
});
$("#validate-map").addEventListener("click", () => {
  renderValidation(validateMap());
  switchTab("map");
});
$("#export-map").addEventListener("click", exportCurrentFile);
$("#quick-test").addEventListener("click", startQuickTest);
$("#exit-test").addEventListener("click", () => fpsTest.stop());
$("#copy-manifest").addEventListener("click", () => navigator.clipboard.writeText($("#manifest-entry").value));
$("#map-file").addEventListener("change", (event) => loadMapFile(event.target.files[0]));
$("#grid-size").addEventListener("change", updateSnapSettings);
$("#rotate-snap").addEventListener("change", updateSnapSettings);
$("#snap-enabled").addEventListener("change", updateSnapSettings);

document.addEventListener("focusin", (event) => {
  const input = event.target.closest("[data-scope]");
  if (!input) return;
  pendingInputSnapshot = getHistorySnapshot();
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-scope]");
  if (input) {
    const snapshot = pendingInputSnapshot || getHistorySnapshot();
    pushUndoSnapshot(snapshot);
    pendingInputSnapshot = null;
    setInputValue(input.dataset.scope, input.dataset.path, input.value, input.checked, input.type);
    return;
  }

  const layerInput = event.target.closest("[data-layer]");
  if (layerInput) {
    layers[layerInput.dataset.layer] = layerInput.checked;
    renderAll();
  }
});

document.addEventListener("keydown", (event) => {
  const isUndo = (event.ctrlKey || event.metaKey) && event.code === "KeyZ";
  const isRedo = (event.ctrlKey || event.metaKey) && (event.code === "KeyY" || (event.shiftKey && event.code === "KeyZ"));
  const isSave = (event.ctrlKey || event.metaKey) && event.code === "KeyS";

  if (isSave) {
    event.preventDefault();
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    exportCurrentFile();
    return;
  }

  if (!isUndo && !isRedo) return;

  const target = event.target;
  if (target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type === "text")) {
    return;
  }

  event.preventDefault();
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  if (isRedo) redoChange();
  else undoChange();
});

window.addEventListener("resize", resize);
resize();
renderWeaponFields();
renderAll();
loadDefaultWeapons();
updateHistoryButtons();
updateSnapSettings();
animate();
