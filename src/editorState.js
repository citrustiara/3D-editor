export const colors = {
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

export const labels = {
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

export const layers = {
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

export const mapFields = [
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

export const objectFields = {
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
  ramps: [
    ["name", "Name", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["width", "Width", "number"],
    ["length", "Length", "number"],
    ["height", "Height", "number"],
    ["rot", "Rot Y", "number"],
    ["color", "Color", "color"],
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
    ["visible", "Visible", "checkbox"],
  ],
  floors: [
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["sx", "Width", "number"],
    ["sz", "Depth", "number"],
    ["color", "Color", "color"],
  ],
  spawnPoints: [
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
  ],
  assets: [
    ["name", "Name", "text", true],
    ["url", "GLTF/GLB URL", "text", true],
    ["x", "X", "number"],
    ["y", "Y Base", "number"],
    ["z", "Z", "number"],
    ["rotX", "Rot X", "number"],
    ["rotY", "Rot Y", "number"],
    ["rotZ", "Rot Z", "number"],
    ["scale.x", "Scale X", "number"],
    ["scale.y", "Scale Y", "number"],
    ["scale.z", "Scale Z", "number"],
    ["collidable", "Collidable", "checkbox"],
  ],
};

export const state = {
  map: createSampleMap(),
  selected: null,
  selectionSet: [],
  multiGroup: null,
  isTransforming: false,
  weaponConfig: createWeaponConfig(),
  editorCameraState: null,
  pendingInputSnapshot: null,
  transformStartSnapshot: null,
  editingMode: "map",
  weaponsData: null,
  activeWeaponId: "pistol",
  loadedSingleWeapon: false,
  mapFileHandle: null,
  weaponFileHandle: null,
  snapEnabled: true,
  gridSize: 1.0,
  rotateSnap: 15.0,
};

export const history = {
  undo: [],
  redo: [],
  limit: 80,
};

const $ = (selector) => document.querySelector(selector);
const restoreHooks = {
  beforeRestore: null,
  afterRestore: null,
};

export function configureHistoryRestoreHooks(hooks = {}) {
  restoreHooks.beforeRestore = hooks.beforeRestore || null;
  restoreHooks.afterRestore = hooks.afterRestore || null;
}

export function createSampleMap() {
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

export function createWeaponConfig() {
  return {
    id: "rifle",
    model: "assets/models/rifle.glb",
    scale: 1,
    firstPersonOffset: { x: 0.24, y: -0.18, z: -0.6 },
    thirdPersonOffset: { x: 0.12, y: 0.62, z: 0.18 },
    muzzle: { x: 0, y: 0.05, z: -1.1 },
  };
}

export function normalizeMap(nextMap) {
  const base = createSampleMap();
  const normalized = { ...base, ...nextMap };
  normalized.bounds = { ...base.bounds, ...(nextMap.bounds || {}) };
  for (const key of ["spawnPoints", "floors", "boxes", "platforms", "ramps", "collision", "decor", "assets"]) {
    normalized[key] = Array.isArray(nextMap[key]) ? nextMap[key] : [];
  }
  return normalized;
}

export function getHistorySnapshot() {
  return JSON.stringify({
    map: state.map,
    weaponsData: state.weaponsData,
    activeWeaponId: state.activeWeaponId,
    loadedSingleWeapon: state.loadedSingleWeapon,
    selected: state.selected,
    selectionSet: state.selectionSet,
    editingMode: state.editingMode
  });
}

export function pushUndoSnapshot(snapshot) {
  if (!snapshot) return;
  const current = getHistorySnapshot();
  if (snapshot === current) return;
  history.undo.push(snapshot);
  if (history.undo.length > history.limit) history.undo.shift();
  history.redo.length = 0;
  updateHistoryButtons();
}

export function undoChange() {
  const previous = history.undo.pop();
  if (!previous) return;
  history.redo.push(getHistorySnapshot());
  restoreHistorySnapshot(previous);
}

export function redoChange() {
  const next = history.redo.pop();
  if (!next) return;
  history.undo.push(getHistorySnapshot());
  restoreHistorySnapshot(next);
}

export function restoreHistorySnapshot(snapshotStr) {
  restoreHooks.beforeRestore?.();
  const snapshot = JSON.parse(snapshotStr);
  state.map = normalizeMap(snapshot.map);
  state.weaponsData = snapshot.weaponsData;
  state.activeWeaponId = snapshot.activeWeaponId;
  state.loadedSingleWeapon = snapshot.loadedSingleWeapon;
  state.selected = snapshot.selected;
  state.selectionSet = snapshot.selectionSet || (state.selected ? [state.selected] : []);
  state.editingMode = snapshot.editingMode;

  clearMultiGroup();
  const modeSelect = $("#editor-mode-select");
  if (modeSelect) modeSelect.value = state.editingMode;

  restoreHooks.afterRestore?.();
  updateHistoryButtons();
}

export function updateHistoryButtons() {
  const undoBtn = $("#undo-action");
  const redoBtn = $("#redo-action");
  if (undoBtn) undoBtn.disabled = history.undo.length === 0;
  if (redoBtn) redoBtn.disabled = history.redo.length === 0;
}
