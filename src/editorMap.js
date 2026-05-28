import * as THREE from "https://esm.sh/three@0.165.0";
import { GLTFLoader } from "https://esm.sh/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { makeRampGeometry, normalizeRamp } from "./physics/ramps.js";
import { state, colors, layers, getHistorySnapshot, pushUndoSnapshot, createSampleMap, normalizeMap } from "./editorState.js";
import { scene, camera, transform, mapGroup, weaponGroup, boundsHelper } from "./editorScene.js";
import { getActiveWeapon, uniquePartName } from "./editorWeapon.js";
import { renderInspector, switchTab, renderAll } from "./editorUI.js";

const $ = (selector) => document.querySelector(selector);

export const selectable = [];
export const assetCache = new Map();
export const loader = new GLTFLoader();

export function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function snap(value, size) {
  return Math.round(value / size) * size;
}

export function gridSize() {
  const minVal = state.editingMode === "weapon" ? 0.001 : 0.1;
  const gridEl = $("#grid-size");
  return Math.max(minVal, Number(gridEl ? gridEl.value : 1) || (state.editingMode === "weapon" ? 0.02 : 1));
}

export function rebuildMap() {
  state.selected = keepSelectionReference(state.selected);
  transform.detach();
  selectable.length = 0;
  mapGroup.clear();

  if (layers.floors) {
    state.map.floors.forEach((floor, index) => addSelectable(createFloorMesh(floor), "floors", index));
  }

  if (layers.boxes) {
    state.map.boxes.forEach((box, index) => addSelectable(createBoxMesh(box, "boxes"), "boxes", index));
  }

  if (layers.platforms) {
    state.map.platforms.forEach((box, index) => addSelectable(createBoxMesh(box, "platforms"), "platforms", index));
  }

  if (layers.ramps) {
    state.map.ramps.forEach((ramp, index) => addSelectable(createRampMesh(ramp), "ramps", index));
  }

  if (layers.collision) {
    state.map.collision.forEach((box, index) => addSelectable(createBoxMesh(box, "collision"), "collision", index));
  }

  if (layers.decor) {
    state.map.decor.forEach((box, index) => addSelectable(createBoxMesh(box, "decor"), "decor", index));
  }

  if (layers.spawns) {
    state.map.spawnPoints.forEach((spawn, index) => addSelectable(createSpawnMesh(spawn, index), "spawnPoints", index));
  }

  if (layers.assets) {
    state.map.assets.forEach((asset, index) => addAssetMesh(asset, index));
  }

  if (state.selectionSet.length > 0) {
    state.selectionSet = state.selectionSet.filter(e => {
      if (state.editingMode === "weapon") return false;
      return state.map[e.kind]?.[e.index] != null;
    });
    state.selected = state.selectionSet.length > 0 ? state.selectionSet[0] : null;

    if (state.selectionSet.length === 1) {
      const mesh = selectable.find(m => m.userData.kind === state.selected.kind && m.userData.index === state.selected.index);
      if (mesh) selectMesh(mesh);
      else clearSelection();
    } else if (state.selectionSet.length > 1) {
      for (const entry of state.selectionSet) {
        const mesh = selectable.find(m => m.userData.kind === entry.kind && m.userData.index === entry.index);
        if (mesh) { mesh.userData.selected = true; applyHighlight(mesh, true); }
      }
      buildMultiGroup();
    } else {
      clearSelection();
    }
  }
}

export function addSelectable(mesh, kind, index) {
  mesh.userData.kind = kind;
  mesh.userData.index = index;
  selectable.push(mesh);
  if (state.editingMode === "weapon") {
    weaponGroup.add(mesh);
  } else {
    mapGroup.add(mesh);
  }
}

export function createFloorMesh(floor) {
  const geometry = new THREE.BoxGeometry(Math.max(0.1, floor.sx || 10), 0.08, Math.max(0.1, floor.sz || 10));
  const material = new THREE.MeshStandardMaterial({ color: numberOr(state.map.floor, colors.floor), roughness: 0.8, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.position.set(numberOr(floor.x, 0), -0.04, numberOr(floor.z, 0));
  return mesh;
}

export function createBoxMesh(box, kind) {
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

export function createRampMesh(ramp) {
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

export function createSpawnMesh(spawn, index) {
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

export function addAssetMesh(asset, index) {
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

export function createAssetPlaceholder(asset) {
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

export function attachAssetClone(source, asset, placeholder) {
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

export function applyAssetTransform(mesh, asset) {
  const position = asset.position || {};
  const rotation = asset.rotation || {};
  mesh.position.set(numberOr(position.x, 0), numberOr(position.y, 0), numberOr(position.z, 0));
  mesh.rotation.set(numberOr(rotation.x, 0), numberOr(rotation.y, 0), numberOr(rotation.z, 0));
  const scale = positive(asset.scale, 1);
  mesh.scale.setScalar(scale);
}

export function updateBoundsHelper() {
  boundsHelper.visible = layers.bounds;
  const bx = positive(state.map.bounds?.x, 50);
  const bz = positive(state.map.bounds?.z, 50);
  const y = 0.03;
  const points = [
    -bx, y, -bz, bx, y, -bz,
    bx, y, -bz, bx, y, bz,
    -bx, y, bz, bx, y, bz,
    -bx, y, -bz, -bx, y, bz,
  ];
  boundsHelper.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
}

export function selectMesh(mesh) {
  clearMultiGroup();
  state.selected = { kind: mesh.userData.kind, index: mesh.userData.index };
  state.selectionSet = [{ kind: mesh.userData.kind, index: mesh.userData.index }];
  clearHighlight();
  mesh.userData.selected = true;
  applyHighlight(mesh, true);
  transform.attach(mesh);
  renderInspector();
  switchTab("inspect");
}

export function toggleMeshInSelection(mesh) {
  const kind = mesh.userData.kind, index = mesh.userData.index;
  const idx = state.selectionSet.findIndex(s => s.kind === kind && s.index === index);
  if (idx >= 0) {
    state.selectionSet.splice(idx, 1);
    mesh.userData.selected = false;
    applyHighlight(mesh, false);
  } else {
    state.selectionSet.push({ kind, index });
    mesh.userData.selected = true;
    applyHighlight(mesh, true);
  }
  state.selected = state.selectionSet.length === 1 ? { ...state.selectionSet[0] } : state.selectionSet.length > 0 ? state.selectionSet[0] : null;
  updateTransformTarget();
  renderInspector();
  if (state.selectionSet.length > 0) switchTab("inspect");
}

export function updateTransformTarget() {
  if (state.selectionSet.length === 0) {
    clearMultiGroup();
    transform.detach();
  } else if (state.selectionSet.length === 1) {
    clearMultiGroup();
    const m = findMeshByEntry(state.selectionSet[0]);
    if (m) transform.attach(m);
  } else {
    buildMultiGroup();
  }
}

export function buildMultiGroup() {
  clearMultiGroup();
  const meshes = state.selectionSet.map(e => findMeshByEntry(e)).filter(Boolean);
  if (meshes.length < 2) return;
  const centroid = new THREE.Vector3();
  meshes.forEach(m => centroid.add(m.position));
  centroid.divideScalar(meshes.length);
  state.multiGroup = new THREE.Group();
  state.multiGroup.position.copy(centroid);
  state.multiGroup.userData._isMultiGroup = true;
  state.multiGroup.userData._offsets = meshes.map(m => ({
    kind: m.userData.kind, index: m.userData.index,
    offset: m.position.clone().sub(centroid),
    initRot: m.rotation.clone(),
    initScale: m.scale.clone(),
  }));
  scene.add(state.multiGroup);
  transform.attach(state.multiGroup);
}

export function clearMultiGroup() {
  if (!state.multiGroup) return;
  if (transform.object === state.multiGroup) transform.detach();
  scene.remove(state.multiGroup);
  state.multiGroup = null;
}

export function syncMultiGroupToMeshes(bakeScale) {
  if (!state.multiGroup || !state.multiGroup.userData._offsets) return;
  const gPos = state.multiGroup.position, gQuat = state.multiGroup.quaternion, gScale = state.multiGroup.scale;
  for (const info of state.multiGroup.userData._offsets) {
    const mesh = findMeshByEntry(info);
    if (!mesh) continue;
    const off = info.offset.clone().applyQuaternion(gQuat).multiply(gScale);
    mesh.position.copy(gPos).add(off);
    const mq = new THREE.Quaternion().setFromEuler(info.initRot);
    mq.premultiply(gQuat);
    mesh.rotation.setFromQuaternion(mq);
    if (bakeScale) mesh.scale.copy(info.initScale).multiply(gScale);
  }
}

export function refreshMultiGroupOffsets() {
  if (!state.multiGroup) return;
  clearMultiGroup();
  if (state.selectionSet.length > 1) buildMultiGroup();
}

export function findMeshByEntry(entry) {
  return selectable.find(m => m.userData.kind === entry.kind && m.userData.index === entry.index) || null;
}

export function clearSelection() {
  state.selected = null;
  state.selectionSet = [];
  clearHighlight();
  clearMultiGroup();
  transform.detach();
  transform.axis = null;
  transform.showX = true;
  transform.showY = true;
  transform.showZ = true;
  renderInspector();
}

export function clearHighlight() {
  selectable.forEach((item) => {
    if (item.userData.selected) applyHighlight(item, false);
    item.userData.selected = false;
  });
}

export function applyHighlight(mesh, enabled) {
  mesh.traverse((child) => {
    if (child.material && child.material.emissive) {
      child.material.emissive.set(enabled ? 0xffffff : 0x000000);
      child.material.emissiveIntensity = enabled ? 0.1 : 0;
    }
  });
}

export function getSelectedData() {
  if (!state.selected) return null;
  if (state.editingMode === "weapon") {
    if (state.selected.kind === "parts") return getActiveWeapon()?.parts?.[state.selected.index] || null;
    if (state.selected.kind === "muzzle") return getActiveWeapon()?.muzzle || null;
    return null;
  }
  return state.map[state.selected.kind]?.[state.selected.index] || null;
}

export function keepSelectionReference(current) {
  if (!current) return null;
  return state.map[current.kind]?.[current.index] ? current : null;
}

export function nudgeData(data) {
  if ("x" in data) data.x += 2;
  if ("z" in data) data.z += 2;
  if (data.position) {
    data.position.x += 2;
    data.position.z += 2;
  }
}

export function uniqueName(prefix) {
  let counter = 1;
  const existing = new Set();
  ["boxes", "platforms", "collision", "decor", "assets"].forEach(key => {
    (state.map[key] || []).forEach(item => { if (item.name) existing.add(item.name); });
  });
  while (existing.has(`${prefix}-${counter}`)) counter++;
  return `${prefix}-${counter}`;
}

export function sceneCenterOnGround() {
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

export function addObject(kind) {
  const center = sceneCenterOnGround();
  const before = getHistorySnapshot();
  if (kind === "box") {
    state.map.boxes.push({ name: uniqueName("box"), x: center.x, y: 0, z: center.z, sx: 4, sy: 2, sz: 4, rotX: 0, rotY: 0, rotZ: 0, color: colors.box, visible: true });
    selectAfterRebuild("boxes", state.map.boxes.length - 1);
  } else if (kind === "platform") {
    state.map.platforms.push({ name: uniqueName("platform"), x: center.x, y: 1, z: center.z, sx: 8, sy: 1, sz: 8, rotX: 0, rotY: 0, rotZ: 0, color: colors.platform, isPlatform: true, visible: true });
    selectAfterRebuild("platforms", state.map.platforms.length - 1);
  } else if (kind === "ramp") {
    state.map.ramps.push({ name: uniqueName("ramp"), x: center.x, y: 1, z: center.z, width: 6, length: 12, height: 3, rot: 0, color: colors.ramp });
    selectAfterRebuild("ramps", state.map.ramps.length - 1);
  } else if (kind === "collision") {
    state.map.collision.push({ name: uniqueName("collision"), x: center.x, y: 0, z: center.z, sx: 4, sy: 4, sz: 4, rotX: 0, rotY: 0, rotZ: 0 });
    selectAfterRebuild("collision", state.map.collision.length - 1);
  } else if (kind === "decor") {
    state.map.decor.push({ name: uniqueName("decor"), x: center.x, y: 0, z: center.z, sx: 3, sy: 5, sz: 1, rotX: 0, rotY: 0, rotZ: 0, color: colors.decor, collidable: false, visible: true });
    selectAfterRebuild("decor", state.map.decor.length - 1);
  } else if (kind === "spawn") {
    state.map.spawnPoints.push({ x: center.x, z: center.z });
    selectAfterRebuild("spawnPoints", state.map.spawnPoints.length - 1);
  } else if (kind === "floor") {
    state.map.floors.push({ x: center.x, z: center.z, sx: 24, sz: 18 });
    selectAfterRebuild("floors", state.map.floors.length - 1);
  } else if (kind === "asset") {
    state.map.assets.push({ url: "assets/models/model.glb", position: { x: center.x, y: 0, z: center.z }, rotation: { x: 0, y: 0, z: 0 }, scale: 1, collidable: false });
    selectAfterRebuild("assets", state.map.assets.length - 1);
  }
  pushUndoSnapshot(before);
}

export function selectAfterRebuild(kind, index) {
  state.selected = { kind, index };
  state.selectionSet = [{ kind, index }];
  renderAll();
  switchTab("inspect");
}

export function duplicateSelection() {
  const before = getHistorySnapshot();
  if (state.editingMode === "weapon") {
    const weapon = getActiveWeapon();
    if (!weapon || !state.selected || state.selected.kind !== "parts") return;
    const newEntries = [];
    for (const entry of state.selectionSet) {
      if (entry.kind !== "parts") continue;
      const part = weapon.parts?.[entry.index];
      if (!part) continue;
      const copy = structuredClone(part);
      copy.name = uniquePartName(copy.type);
      copy.x += 0.05;
      weapon.parts.push(copy);
      newEntries.push({ kind: "parts", index: weapon.parts.length - 1 });
    }
    if (!newEntries.length) return;
    pushUndoSnapshot(before);
    state.selectionSet = newEntries;
    state.selected = newEntries[0];
    renderAll();
    switchTab("inspect");
    return;
  }
  if (!state.selectionSet.length) return;
  const newEntries = [];
  for (const entry of state.selectionSet) {
    const data = state.map[entry.kind]?.[entry.index];
    if (!data) continue;
    const copy = structuredClone(data);
    if ("name" in copy) copy.name = uniqueName(copy.name || entry.kind);
    nudgeData(copy);
    state.map[entry.kind].push(copy);
    newEntries.push({ kind: entry.kind, index: state.map[entry.kind].length - 1 });
  }
  if (!newEntries.length) return;
  pushUndoSnapshot(before);
  state.selectionSet = newEntries;
  state.selected = newEntries[0];
  renderAll();
  switchTab("inspect");
}

export function deleteSelection() {
  const before = getHistorySnapshot();
  if (state.editingMode === "weapon") {
    const weapon = getActiveWeapon();
    if (!weapon || !state.selectionSet.length) return;
    const indices = state.selectionSet
      .filter(e => e.kind === "parts")
      .map(e => e.index)
      .sort((a, b) => b - a);
    for (const i of indices) weapon.parts.splice(i, 1);
    clearSelection();
    pushUndoSnapshot(before);
    renderAll();
    return;
  }
  if (!state.selectionSet.length) return;
  const byKind = {};
  for (const entry of state.selectionSet) {
    (byKind[entry.kind] ||= []).push(entry.index);
  }
  for (const kind in byKind) {
    byKind[kind].sort((a, b) => b - a);
    for (const i of byKind[kind]) state.map[kind].splice(i, 1);
  }
  clearSelection();
  pushUndoSnapshot(before);
  renderAll();
}
