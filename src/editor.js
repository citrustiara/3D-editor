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
};

let map = createSampleMap();
let selected = null;
let isTransforming = false;
let weaponConfig = createWeaponConfig();
let editorCameraState = null;
let pendingInputSnapshot = null;
let transformStartSnapshot = null;

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

const grid = new THREE.GridHelper(220, 220, colors.gridA, colors.gridB);
grid.position.y = 0.01;
scene.add(grid);

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

function mapSnapshot() {
  return JSON.stringify(map);
}

function pushUndoSnapshot(snapshot) {
  if (!snapshot || snapshot === mapSnapshot()) return;
  history.undo.push(snapshot);
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo.length = 0;
  updateHistoryButtons();
}

function mutateMap(label, callback) {
  const before = mapSnapshot();
  callback();
  pushUndoSnapshot(before);
  renderAll();
}

function undoMapChange() {
  const previous = history.undo.pop();
  if (!previous) return;
  history.redo.push(mapSnapshot());
  restoreMapSnapshot(previous);
}

function redoMapChange() {
  const next = history.redo.pop();
  if (!next) return;
  history.undo.push(mapSnapshot());
  restoreMapSnapshot(next);
}

function restoreMapSnapshot(snapshot) {
  fpsTest.stop();
  map = normalizeMap(JSON.parse(snapshot));
  selected = null;
  renderAll();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $("#undo-action").disabled = history.undo.length === 0;
  $("#redo-action").disabled = history.redo.length === 0;
}

function renderAll() {
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
  mapGroup.add(mesh);
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
      <input id="${id}" type="${type === "color" ? "color" : type}" data-scope="${scope}" data-path="${path}" value="${escapeHtml(valueText)}" ${type === "number" ? 'step="0.1"' : ""} />
    </label>
  `;
}

function renderWeaponFields() {
  const fields = [
    ["id", "Weapon ID", "text", true],
    ["model", "GLB URL", "text", true],
    ["scale", "Scale", "number"],
    ["firstPersonOffset.x", "FP X", "number"],
    ["firstPersonOffset.y", "FP Y", "number"],
    ["firstPersonOffset.z", "FP Z", "number"],
    ["thirdPersonOffset.x", "TP X", "number"],
    ["thirdPersonOffset.y", "TP Y", "number"],
    ["thirdPersonOffset.z", "TP Z", "number"],
    ["muzzle.x", "Muzzle X", "number"],
    ["muzzle.y", "Muzzle Y", "number"],
    ["muzzle.z", "Muzzle Z", "number"],
  ];
  $("#weapon-fields").innerHTML = fields.map(([path, label, type, wide]) => fieldTemplate("weapon", path, label, getByPath(weaponConfig, path), type, wide)).join("");
  updateWeaponOutput();
}

function selectMesh(mesh) {
  selected = { kind: mesh.userData.kind, index: mesh.userData.index };
  clearHighlight();
  mesh.userData.selected = true;
  applyHighlight(mesh, true);
  transform.attach(mesh);
  renderInspector();
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
  const before = mapSnapshot();
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
  const data = getSelectedData();
  if (!selected || !data) return;
  const before = mapSnapshot();
  const copy = structuredClone(data);
  if ("name" in copy) copy.name = uniqueName(copy.name || selected.kind);
  nudgeData(copy);
  map[selected.kind].push(copy);
  selectAfterRebuild(selected.kind, map[selected.kind].length - 1);
  pushUndoSnapshot(before);
}

function deleteSelection() {
  if (!selected) return;
  const before = mapSnapshot();
  map[selected.kind].splice(selected.index, 1);
  clearSelection();
  renderAll();
  pushUndoSnapshot(before);
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
  $("#weapon-output").value = JSON.stringify({ [weaponConfig.id || "weapon"]: weaponConfig }, null, 2);
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
}

function downloadMap() {
  updateExport();
  const blob = new Blob([$("#export-output").value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug(map.id || map.name || "new-map")}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function loadMapFile(file) {
  if (!file) return;
  const text = await file.text();
  const before = mapSnapshot();
  map = normalizeMap(JSON.parse(text));
  selected = null;
  pushUndoSnapshot(before);
  renderAll();
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
  return Math.max(0.1, Number($("#grid-size").value) || 1);
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
    transformStartSnapshot = mapSnapshot();
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
    object.position.z = snap(object.position.z, size);
  }
  syncDataFromMesh(object, false);
});

transform.addEventListener("mouseUp", () => {
  if (transform.object) syncDataFromMesh(transform.object, transform.mode === "scale");
});

document.querySelectorAll("[data-add]").forEach((button) => button.addEventListener("click", () => addObject(button.dataset.add)));
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setTransformMode(button.dataset.mode)));
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

$("#duplicate-object").addEventListener("click", duplicateSelection);
$("#delete-object").addEventListener("click", deleteSelection);
$("#undo-action").addEventListener("click", undoMapChange);
$("#redo-action").addEventListener("click", redoMapChange);
$("#sample-map").addEventListener("click", () => {
  const before = mapSnapshot();
  map = createSampleMap();
  selected = null;
  pushUndoSnapshot(before);
  renderAll();
});
$("#validate-map").addEventListener("click", () => {
  renderValidation(validateMap());
  switchTab("map");
});
$("#export-map").addEventListener("click", downloadMap);
$("#quick-test").addEventListener("click", startQuickTest);
$("#exit-test").addEventListener("click", () => fpsTest.stop());
$("#copy-manifest").addEventListener("click", () => navigator.clipboard.writeText($("#manifest-entry").value));
$("#weapon-preview").addEventListener("click", previewWeaponModel);
$("#map-file").addEventListener("change", (event) => loadMapFile(event.target.files[0]));
$("#grid-size").addEventListener("change", updateSnapSettings);
$("#rotate-snap").addEventListener("change", updateSnapSettings);
$("#snap-enabled").addEventListener("change", updateSnapSettings);

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-scope]");
  if (!input) return;
  setInputValue(input.dataset.scope, input.dataset.path, input.value, input.checked, input.type);
});

document.addEventListener("focusin", (event) => {
  const input = event.target.closest("[data-scope]");
  if (!input || input.dataset.scope === "weapon") return;
  pendingInputSnapshot = mapSnapshot();
});

document.addEventListener("change", (event) => {
  const scopedInput = event.target.closest("[data-scope]");
  if (scopedInput && scopedInput.dataset.scope !== "weapon") {
    pushUndoSnapshot(pendingInputSnapshot);
    pendingInputSnapshot = null;
    return;
  }

  const input = event.target.closest("[data-layer]");
  if (!input) return;
  layers[input.dataset.layer] = input.checked;
  renderAll();
});

document.addEventListener("keydown", (event) => {
  const isUndo = (event.ctrlKey || event.metaKey) && event.code === "KeyZ";
  const isRedo = (event.ctrlKey || event.metaKey) && (event.code === "KeyY" || (event.shiftKey && event.code === "KeyZ"));
  if (!isUndo && !isRedo) return;
  const target = event.target;
  const isTextEdit = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if (isTextEdit && target.dataset.scope) return;
  event.preventDefault();
  if (isRedo) redoMapChange();
  else undoMapChange();
});

window.addEventListener("resize", resize);
resize();
renderWeaponFields();
renderAll();
updateHistoryButtons();
updateSnapSettings();
animate();
