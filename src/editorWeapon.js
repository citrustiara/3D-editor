import * as THREE from "https://esm.sh/three@0.165.0";
import { state, colors, getHistorySnapshot, pushUndoSnapshot } from "./editorState.js";
import { transform, weaponGroup } from "./editorScene.js";
import { addSelectable, positive, numberOr, selectMesh, clearSelection, selectable, applyHighlight, buildMultiGroup, selectAfterRebuild } from "./editorMap.js";
import { renderInspector, switchTab, renderAll, updateWeaponOutput } from "./editorUI.js";

const $ = (selector) => document.querySelector(selector);

export function getActiveWeapon() {
  if (!state.weaponsData || !state.weaponsData.weapons) return null;
  return state.weaponsData.weapons[state.activeWeaponId] || null;
}

export function keepWeaponSelectionReference(current) {
  if (!current) return null;
  const weapon = getActiveWeapon();
  if (!weapon) return null;
  if (current.kind === "parts" && weapon.parts?.[current.index]) return current;
  if (current.kind === "muzzle") return current;
  return null;
}

export function rebuildWeaponScene() {
  state.selected = keepWeaponSelectionReference(state.selected);
  transform.detach();
  selectable.length = 0;
  weaponGroup.clear();

  if (state.editingMode !== "weapon") return;

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

  if (state.selectionSet.length > 0) {
    state.selectionSet = state.selectionSet.filter(e => {
      return selectable.some(m => m.userData.kind === e.kind && m.userData.index === e.index);
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

export async function loadDefaultWeapons() {
  try {
    const response = await fetch("../GolfShooter/assets/weapons/weapons.json");
    if (response.ok) {
      const data = await response.json();
      if (data) {
        state.weaponsData = data;
        const weapons = state.weaponsData.weapons || {};
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
        if (state.editingMode === "weapon") rebuildWeaponScene();
        return;
      }
    }
  } catch (e) {
    console.warn("Could not auto-load weapons.json, using fallback.", e);
  }
  
  state.weaponsData = {
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

export function renderWeaponList() {
  const select = $("#active-weapon-select");
  if (!select || !state.weaponsData || !state.weaponsData.weapons) return;
  select.innerHTML = Object.keys(state.weaponsData.weapons).map(id => `
    <option value="${id}">${state.weaponsData.weapons[id].label || titleCase(id)}</option>
  `).join("");
  select.value = state.activeWeaponId;
  updateWeaponOutput();
}

export function addWeaponPart(type) {
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

export function uniquePartName(base) {
  const weapon = getActiveWeapon();
  if (!weapon || !weapon.parts) return base;
  let counter = 1;
  while (weapon.parts.some(p => p.name === `${base}-${counter}`)) {
    counter++;
  }
  return `${base}-${counter}`;
}

export function titleCase(value) {
  return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}
