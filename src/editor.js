import * as THREE from "https://esm.sh/three@0.165.0";
import { 
  state, colors, layers, restoreHistorySnapshot, getHistorySnapshot, pushUndoSnapshot, undoChange, redoChange, createSampleMap, normalizeMap, configureHistoryRestoreHooks
} from "./editorState.js";
import { 
  scene, camera, renderer, orbit, transform, fpsTest, mapGroup, weaponGroup, grid, weaponGrid, boundsHelper 
} from "./editorScene.js";
import { 
  selectable, loader, selectMesh, toggleMeshInSelection, updateTransformTarget, buildMultiGroup, clearMultiGroup, 
  syncMultiGroupToMeshes, refreshMultiGroupOffsets, findMeshByEntry, clearSelection, clearHighlight, applyHighlight, 
  getSelectedData, keepSelectionReference, addObject, selectAfterRebuild, duplicateSelection, deleteSelection, 
  uniqueName, snap, gridSize, updateBoundsHelper, sceneCenterOnGround, positive, numberOr 
} from "./editorMap.js";
import { 
  getActiveWeapon, keepWeaponSelectionReference, rebuildWeaponScene, loadDefaultWeapons, renderWeaponList, addWeaponPart, uniquePartName 
} from "./editorWeapon.js";
import { 
  renderMapFields, renderInspector, renderVisibility, fieldTemplate, renderWeaponFields, updateWeaponOutput, 
  updateExport, cleanForExport, validateMap, renderValidationOutput, switchTab, setEditorMode, updateSnapSettings, 
  setInputValue, parseFieldValue, renderAll, slug, escapeHtml, roundMaybe 
} from "./editorUI.js";

const $ = (selector) => document.querySelector(selector);
const viewport = $("#viewport");
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const frameClock = new THREE.Clock();

// Wire up FpsTestRuntime onExit callback
fpsTest.onExit = () => {
  restoreEditorAfterQuickTest();
  setEditorMode("map");
  const overlay = $("#test-overlay");
  if (overlay) overlay.classList.add("hidden");
  clearSelection();
  renderAll();
};

function restoreEditorAfterQuickTest() {
  transform.enabled = true;
  transform.axis = null;
  orbit.enabled = true;
  if (state.editorCameraState) {
    camera.position.copy(state.editorCameraState.position);
    camera.rotation.copy(state.editorCameraState.rotation);
    orbit.target.copy(state.editorCameraState.target);
    orbit.update();
    state.editorCameraState = null;
  }
}

configureHistoryRestoreHooks({
  beforeRestore: () => {
    if (fpsTest.active) fpsTest.stop();
  },
  afterRestore: () => {
    clearMultiGroup();
    renderAll();
  },
});

function onPointerDown(event) {
  if (state.isTransforming || transform.axis) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(selectable, true);
  const isMultiKey = event.shiftKey || event.ctrlKey || event.metaKey;
  if (!hits.length) {
    if (!isMultiKey) clearSelection();
    return;
  }
  let target = hits[0].object;
  while (target.parent && !target.userData.kind) target = target.parent;
  if (!target.userData.kind) return;
  if (isMultiKey) {
    toggleMeshInSelection(target);
  } else {
    selectMesh(target);
  }
}

function setTransformMode(mode) {
  transform.setMode(mode);
  document.querySelectorAll("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
}

function syncDataFromMesh(mesh, bakeScale = false) {
  const kind = mesh.userData.kind;
  if (state.editingMode === "weapon") {
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

  const data = state.map[kind]?.[mesh.userData.index];
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

async function exportCurrentFile() {
  const isWeapon = state.editingMode === "weapon";
  if (isWeapon) {
    updateWeaponOutput();
  } else {
    updateExport();
  }
  
  const data = isWeapon ? $("#weapon-output").value : $("#export-output").value;
  const fileName = isWeapon
    ? (state.loadedSingleWeapon ? `${state.activeWeaponId}.json` : "weapons.json")
    : `${slug(state.map.id || state.map.name || "new-map")}.json`;

  let handle = isWeapon ? state.weaponFileHandle : state.mapFileHandle;

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
          state.weaponFileHandle = handle;
        } else {
          state.mapFileHandle = handle;
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
        if (isWeapon) state.weaponFileHandle = null;
        else state.mapFileHandle = null;
      }
    }
  }

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
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Map JSON must be an object.");
    }
    const before = getHistorySnapshot();
    state.map = normalizeMap(parsed);
    state.selected = null;
    state.selectionSet = [];
    clearMultiGroup();
    pushUndoSnapshot(before);
    renderAll();
  } catch (error) {
    alert(`Error loading map JSON: ${error.message}`);
  }
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
    state.mapFileHandle = handle;
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
      state.weaponsData = data;
      state.activeWeaponId = Object.keys(state.weaponsData.weapons || {})[0] || "pistol";
      state.loadedSingleWeapon = false;
    } else if (data.parts) {
      state.weaponsData = {
        version: 1,
        weapons: {
          [id]: data
        }
      };
      state.activeWeaponId = id;
      state.loadedSingleWeapon = true;
    } else {
      throw new Error("Invalid weapons JSON format: must contain 'weapons' or 'parts'");
    }
    pushUndoSnapshot(before);
    renderWeaponList();
    if (state.editingMode === "weapon") {
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
    state.weaponFileHandle = handle;
    const file = await handle.getFile();
    await loadWeaponFile(file);
  } catch (err) {
    if (err.name !== 'AbortError') console.error(err);
  }
}

function startQuickTest() {
  clearSelection();
  state.editorCameraState = {
    position: camera.position.clone(),
    rotation: camera.rotation.clone(),
    target: orbit.target.clone(),
  };
  transform.detach();
  transform.enabled = false;
  orbit.enabled = false;
  $("#test-overlay").classList.remove("hidden");
  fpsTest.start(cleanForExport(state.map), 0);
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

// Event Listeners
viewport.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("contextmenu", (event) => {
  if (fpsTest.active) event.preventDefault();
});

transform.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
  state.isTransforming = event.value;
  if (event.value) {
    state.transformStartSnapshot = getHistorySnapshot();
  } else {
    if (state.multiGroup && transform.object === state.multiGroup) {
      syncMultiGroupToMeshes(transform.mode === "scale");
      for (const entry of state.selectionSet) {
        const mesh = findMeshByEntry(entry);
        if (mesh) syncDataFromMesh(mesh, transform.mode === "scale");
      }
      refreshMultiGroupOffsets();
    }
    pushUndoSnapshot(state.transformStartSnapshot);
    state.transformStartSnapshot = null;
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
  if (state.multiGroup && object === state.multiGroup) {
    syncMultiGroupToMeshes(false);
    for (const entry of state.selectionSet) {
      const mesh = findMeshByEntry(entry);
      if (mesh) syncDataFromMesh(mesh, false);
    }
  } else {
    syncDataFromMesh(object, false);
  }
});

transform.addEventListener("mouseUp", () => {
  const object = transform.object;
  if (!object) return;
  if (state.multiGroup && object === state.multiGroup) {
    syncMultiGroupToMeshes(transform.mode === "scale");
    for (const entry of state.selectionSet) {
      const mesh = findMeshByEntry(entry);
      if (mesh) syncDataFromMesh(mesh, transform.mode === "scale");
    }
    refreshMultiGroupOffsets();
  } else {
    syncDataFromMesh(object, transform.mode === "scale");
  }
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
  state.activeWeaponId = e.target.value;
  clearSelection();
  pushUndoSnapshot(before);
  renderAll();
});

$("#weapons-file")?.addEventListener("change", (event) => {
  loadWeaponFile(event.target.files[0]);
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
  state.map = createSampleMap();
  state.selected = null;
  state.selectionSet = [];
  pushUndoSnapshot(before);
  renderAll();
});
$("#validate-map").addEventListener("click", () => {
  renderValidationOutput(validateMap());
  switchTab("map");
});
$("#export-map").addEventListener("click", exportCurrentFile);
$("#quick-test").addEventListener("click", startQuickTest);
$("#exit-test").addEventListener("click", () => fpsTest.stop());
$("#copy-manifest").addEventListener("click", () => navigator.clipboard.writeText($("#manifest-entry").value));
$("#map-file").addEventListener("change", (event) => {
  loadMapFile(event.target.files[0]);
  event.target.value = "";
});
$("#grid-size").addEventListener("change", updateSnapSettings);
$("#rotate-snap").addEventListener("change", updateSnapSettings);
$("#snap-enabled").addEventListener("change", updateSnapSettings);

document.addEventListener("focusin", (event) => {
  const input = event.target.closest("[data-scope]");
  if (!input) return;
  state.pendingInputSnapshot = getHistorySnapshot();
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-scope]");
  if (input) {
    const snapshot = state.pendingInputSnapshot || getHistorySnapshot();
    pushUndoSnapshot(snapshot);
    state.pendingInputSnapshot = null;
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
  const key = event.key.toLowerCase();
  const hasCommandModifier = event.ctrlKey || event.metaKey;
  const isUndo = hasCommandModifier && key === "z" && !event.shiftKey;
  const isRedo = hasCommandModifier && (key === "y" || (key === "z" && event.shiftKey));
  const isSave = hasCommandModifier && key === "s";
  const isSelectAll = (event.ctrlKey || event.metaKey) && event.code === "KeyA";
  const isDuplicate = (event.ctrlKey || event.metaKey) && event.code === "KeyD";
  const isDelete = event.code === "Delete" || event.code === "KeyX";

  const target = event.target;
  const isInInput = target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && target.type !== "checkbox");

  if (isSave) {
    event.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    exportCurrentFile();
    return;
  }

  if (isUndo || isRedo) {
    event.preventDefault();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (isRedo) redoChange();
    else undoChange();
    return;
  }

  if (isInInput) {
    return;
  }

  if (isSelectAll) {
    event.preventDefault();
    if (fpsTest.active || !selectable.length) return;
    state.selectionSet = selectable.map(m => ({ kind: m.userData.kind, index: m.userData.index }));
    state.selected = state.selectionSet[0] || null;
    clearHighlight();
    selectable.forEach(m => { m.userData.selected = true; applyHighlight(m, true); });
    if (state.selectionSet.length > 1) buildMultiGroup();
    else if (state.selectionSet.length === 1) { const m = findMeshByEntry(state.selectionSet[0]); if (m) transform.attach(m); }
    renderInspector();
    return;
  }

  if (isDuplicate) {
    event.preventDefault();
    duplicateSelection();
    return;
  }

  if (isDelete && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    deleteSelection();
    return;
  }

  return;
});

window.addEventListener("resize", resize);

// Startup Initialization
resize();
renderWeaponFields();
renderAll();
loadDefaultWeapons();
updateSnapSettings();
animate();
