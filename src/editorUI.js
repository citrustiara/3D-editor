import * as THREE from "https://esm.sh/three@0.165.0";
import { state, colors, layers, mapFields, objectFields, getHistorySnapshot, pushUndoSnapshot } from "./editorState.js";
import { selectable, numberOr, positive, getSelectedData, clearSelection, rebuildMap, updateBoundsHelper, gridSize, snap } from "./editorMap.js";
import { getActiveWeapon, rebuildWeaponScene, renderWeaponList } from "./editorWeapon.js";
import { grid, boundsHelper, weaponGrid, mapGroup, transform } from "./editorScene.js";

const $ = (selector) => document.querySelector(selector);

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function numberToHex(value) {
  return `#${numberOr(value, 0).toString(16).padStart(6, "0").slice(-6)}`;
}

export function roundMaybe(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
}

export function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleCase(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

export function getByPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

export function setByPath(object, path, value) {
  const parts = path.split(".");
  let target = object;
  while (parts.length > 1) {
    const key = parts.shift();
    target[key] ||= {};
    target = target[key];
  }
  target[parts[0]] = value;
}

export function renderMapFields() {
  const el = $("#map-fields");
  if (el) el.innerHTML = mapFields.map(([path, label, type, wide]) => fieldTemplate("map", path, label, getByPath(state.map, path), type, wide)).join("");
}

export function renderInspector() {
  const inspector = $("#inspector");
  const empty = $("#inspector-empty");
  if (!inspector || !empty) return;

  if (state.selectionSet.length === 0) {
    inspector.innerHTML = "";
    empty.style.display = "block";
    const label = $("#selection-label");
    if (label) label.textContent = "Nothing selected";
    return;
  }

  if (state.selectionSet.length > 1) {
    const counts = {};
    for (const entry of state.selectionSet) {
      const label = labels[entry.kind] || entry.kind;
      counts[label] = (counts[label] || 0) + 1;
    }
    const summary = Object.entries(counts).map(([k, v]) => `${v}× ${k}`).join(", ");
    const label = $("#selection-label");
    if (label) label.textContent = `${state.selectionSet.length} objects selected`;
    empty.style.display = "none";
    inspector.innerHTML = `<div class="empty-state" style="border-style:solid;border-color:rgba(60,182,163,0.4)">
      <strong>${state.selectionSet.length} objects selected</strong><br>${summary}<br><br>
      <span style="color:var(--muted);font-size:11px">Use Move / Rotate / Scale to transform together.<br>
      Delete or Duplicate applies to all selected.</span></div>`;
    return;
  }

  const data = getSelectedData();
  if (!data) {
    clearSelection();
    return;
  }

  const fields = objectFields[state.selected.kind] || [];
  const labelsMap = {
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
  const labelText = labelsMap[state.selected.kind] || state.selected.kind;
  const title = `${labelText} ${state.selected.index + 1}${data.name ? ` · ${data.name}` : ""}`;
  const label = $("#selection-label");
  if (label) label.textContent = title;
  empty.style.display = "none";
  inspector.innerHTML = fields.map(([path, label, type, wide]) => fieldTemplate("object", path, label, getByPath(data, path), type, wide)).join("");
}

export function renderVisibility() {
  const el = $("#visibility-fields");
  if (el) el.innerHTML = Object.keys(layers).map((key) => `
    <label>
      <span>${titleCase(key)}</span>
      <input type="checkbox" data-layer="${key}" ${layers[key] ? "checked" : ""} />
    </label>
  `).join("");
}

export function fieldTemplate(scope, path, label, value, type = "text", wide = false) {
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

export function renderWeaponFields() {
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
  const el = $("#weapon-fields");
  if (weapon && el) {
    el.innerHTML = fields.map(([path, label, type, wide]) => fieldTemplate("weapon", path, label, getByPath(weapon, path), type, wide)).join("");
  }
  updateWeaponOutput();
}

export function updateWeaponOutput() {
  const el = $("#weapon-output");
  if (!el) return;
  if (state.editingMode === "weapon") {
    if (state.loadedSingleWeapon) {
      const current = getActiveWeapon() || {};
      el.value = JSON.stringify(current, null, 2);
    } else {
      el.value = JSON.stringify(state.weaponsData, null, 2);
    }
  } else {
    el.value = JSON.stringify({ [state.weaponConfig.id || "weapon"]: state.weaponConfig }, null, 2);
  }
}

export function updateExport() {
  const output = JSON.stringify(cleanForExport(state.map), null, 2);
  const el = $("#export-output");
  if (el) el.value = output;
  const manifest = $("#manifest-entry");
  if (manifest) {
    const id = slug(state.map.id || state.map.name || "new-map");
    manifest.value = `"fps/${id}.json"`;
  }
}

export function cleanForExport(source) {
  const clone = structuredClone(source);
  for (const key of ["boxes", "platforms", "collision", "decor"]) {
    if (clone[key]) {
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
  }
  if (clone.ramps) {
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
  }
  if (clone.spawnPoints) {
    clone.spawnPoints = clone.spawnPoints.map((spawn) => ({ x: roundMaybe(spawn.x), z: roundMaybe(spawn.z) }));
  }
  return clone;
}

export function forEachNamedObject(callback) {
  for (const kind of ["boxes", "platforms", "ramps", "collision", "decor"]) {
    if (state.map[kind]) {
      state.map[kind].forEach((object, index) => callback(kind, object, index));
    }
  }
}

export function rectInsideAnyFloor(x, z, sx, sz) {
  return state.map.floors.some((floor) => {
    const halfX = positive(floor.sx, 0) / 2;
    const halfZ = positive(floor.sz, 0) / 2;
    const fx = numberOr(floor.x, 0);
    const fz = numberOr(floor.z, 0);
    return x - sx / 2 >= fx - halfX && x + sx / 2 <= fx + halfX && z - sz / 2 >= fz - halfZ && z + sz / 2 <= fz + halfZ;
  });
}

export function isBoxInsideAnyFloor(box) {
  const sx = positive(box.sx, 0);
  const sz = positive(box.sz, 0);
  return rectInsideAnyFloor(numberOr(box.x, 0), numberOr(box.z, 0), sx, sz);
}

export function isRampInsideAnyFloor(ramp) {
  const size = Math.max(positive(ramp.width, 0), positive(ramp.length, 0));
  return rectInsideAnyFloor(numberOr(ramp.x, 0), numberOr(ramp.z, 0), size, size);
}

export function pointInsideAnyFloor(x, z) {
  return state.map.floors.some((floor) => {
    const halfX = positive(floor.sx, 0) / 2;
    const halfZ = positive(floor.sz, 0) / 2;
    const fx = numberOr(floor.x, 0);
    const fz = numberOr(floor.z, 0);
    return x >= fx - halfX && x <= fx + halfX && z >= fz - halfZ && z <= fz + halfZ;
  });
}

export function spawnIntersectsCollision(spawn) {
  const solids = [...(state.map.boxes || []), ...(state.map.collision || []), ...(state.map.decor || []).filter((item) => item.collidable)];
  return solids.some((box) => {
    const sx = positive(box.sx, 0) / 2 + 1;
    const sz = positive(box.sz, 0) / 2 + 1;
    return Math.abs(numberOr(spawn.x, 0) - numberOr(box.x, 0)) < sx && Math.abs(numberOr(spawn.z, 0) - numberOr(box.z, 0)) < sz;
  });
}

export function validateMap() {
  const issues = [];
  if (!state.map.id || !slug(state.map.id)) issues.push(["error", "Map ID is missing or cannot be used as a file name."]);
  if (!state.map.name) issues.push(["warn", "Map name is empty."]);
  if ((state.map.spawnPoints || []).length < 2) issues.push(["error", "FPS maps need at least two spawn points."]);
  if (!(state.map.floors || []).length) issues.push(["error", "At least one floor rectangle is required."]);

  const seenNames = new Map();
  forEachNamedObject((kind, object, index) => {
    if (!object.name) return;
    const key = object.name.toLowerCase();
    if (seenNames.has(key)) issues.push(["warn", `Duplicate object name "${object.name}" in ${kind} ${index + 1}.`]);
    seenNames.set(key, true);
  });

  const labelsMap = {
    boxes: "Box",
    platforms: "Platform",
    ramps: "Ramp",
    collision: "Collision",
    decor: "Decor",
    assets: "Asset",
    floors: "Floor",
    spawnPoints: "Spawn",
  };

  for (const [kind, list] of [["boxes", state.map.boxes], ["platforms", state.map.platforms], ["decor", state.map.decor], ["collision", state.map.collision]]) {
    if (list) {
      list.forEach((box, index) => {
        if (!isBoxInsideAnyFloor(box)) issues.push(["warn", `${labelsMap[kind]} ${index + 1} sits outside the floor layout.`]);
        if (positive(box.sx, 0) <= 0 || positive(box.sy, 0) <= 0 || positive(box.sz, 0) <= 0) issues.push(["error", `${labelsMap[kind]} ${index + 1} has a non-positive size.`]);
      });
    }
  }

  if (state.map.ramps) {
    state.map.ramps.forEach((ramp, index) => {
      if (!isRampInsideAnyFloor(ramp)) issues.push(["warn", `Ramp ${index + 1} sits outside the floor layout.`]);
      if (positive(ramp.length, 0) <= 0 || positive(ramp.width, 0) <= 0) issues.push(["error", `Ramp ${index + 1} has a non-positive size.`]);
      if (positive(ramp.height, 0) / Math.max(0.01, positive(ramp.length, 1)) > 0.45) issues.push(["warn", `Ramp ${index + 1} is steep; FPS movement may feel abrupt.`]);
    });
  }

  if (state.map.spawnPoints) {
    state.map.spawnPoints.forEach((spawn, index) => {
      if (!pointInsideAnyFloor(spawn.x, spawn.z)) issues.push(["error", `Spawn ${index + 1} is outside every floor.`]);
      if (spawnIntersectsCollision(spawn)) issues.push(["error", `Spawn ${index + 1} overlaps solid gameplay geometry.`]);
    });
  }

  if (state.map.assets) {
    state.map.assets.forEach((asset, index) => {
      if (!asset.url || !asset.url.trim()) issues.push(["warn", `Asset ${index + 1} is missing a GLB/GLTF URL.`]);
      if (asset.collidable) issues.push(["warn", `Asset ${index + 1} is marked collidable; export simple collision boxes for predictable gameplay.`]);
    });
  }

  if (!issues.length) issues.push(["ok", "Map passes the editor checks."]);
  return issues;
}

export function renderValidationOutput(issues) {
  const el = $("#validation-output");
  if (el) el.innerHTML = issues.map(([level, message]) => `
    <div class="issue">
      <span class="badge ${level}">${level}</span>
      <span>${escapeHtml(message)}</span>
    </div>
  `).join("");
}

export function switchTab(name) {
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
  
  if (name === "weapon" && state.editingMode !== "weapon") {
    const before = getHistorySnapshot();
    setEditorMode("weapon");
    pushUndoSnapshot(before);
  } else if (name === "map" && state.editingMode !== "map") {
    const before = getHistorySnapshot();
    setEditorMode("map");
    pushUndoSnapshot(before);
  }
}

export function setEditorMode(mode) {
  state.editingMode = mode;
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
      gridSizeInput.value = "0.02";
    } else {
      gridSizeInput.min = "0.25";
      gridSizeInput.step = "0.25";
      gridSizeInput.value = "1.0";
    }
    updateSnapSettings();
  }
  
  clearSelection();
  renderAll();
}

export function updateSnapSettings() {
  const enabled = $("#snap-enabled").checked;
  const size = gridSize();
  const radians = THREE.MathUtils.degToRad(Math.max(1, Number($("#rotate-snap").value) || 15));
  transform.setTranslationSnap(enabled ? size : null);
  transform.setScaleSnap(enabled ? size : null);
  transform.setRotationSnap(enabled ? radians : null);
}

export function setInputValue(scope, path, rawValue, checked, inputType) {
  if (state.editingMode === "weapon") {
    const target = scope === "map" ? null : scope === "object" ? getSelectedData() : getActiveWeapon();
    if (!target) return;
    const value = parseFieldValue(rawValue, checked, inputType);
    setByPath(target, path, value);
    rebuildWeaponScene();
    updateWeaponOutput();
    return;
  }
  const target = scope === "map" ? state.map : scope === "object" ? getSelectedData() : state.weaponConfig;
  if (!target) return;
  const value = parseFieldValue(rawValue, checked, inputType);
  setByPath(target, path, value);
  if (scope === "weapon") {
    updateWeaponOutput();
    return;
  }
  renderAll();
}

export function parseFieldValue(rawValue, checked, inputType) {
  if (inputType === "checkbox") return checked;
  if (inputType === "color") return parseInt(rawValue.replace("#", ""), 16);
  if (inputType === "number") return Number(rawValue);
  return rawValue;
}

export function renderAll() {
  if (state.editingMode === "weapon") {
    grid.visible = false;
    boundsHelper.visible = false;
    weaponGrid.visible = true;
    mapGroup.visible = false;
    rebuildWeaponScene();
  } else {
    grid.visible = true;
    boundsHelper.visible = layers.bounds;
    weaponGrid.visible = false;
    mapGroup.visible = true;
    rebuildMap();
    updateBoundsHelper();
  }
  renderMapFields();
  renderInspector();
  renderVisibility();
  renderWeaponFields();
  updateExport();
}
