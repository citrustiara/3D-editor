import * as THREE from "three";

export function normalizeRamp(def = {}) {
  const width = Number(def.width ?? def.sx ?? 4);
  const length = Number(def.length ?? def.sz ?? 8);
  return {
    ...def,
    x: Number(def.x || 0),
    y: Number(def.y ?? 1),
    z: Number(def.z || 0),
    width,
    length,
    height: Number(def.height ?? def.sy ?? 2),
    rot: Number(def.rot ?? def.rotY ?? 0),
  };
}

export function makeRampGeometry(def = {}) {
  const ramp = normalizeRamp(def);
  const w = ramp.width / 2;
  const l = ramp.length / 2;
  const h = ramp.height;
  const vertices = new Float32Array([
    -w, 0, -l, w, 0, -l, -w, 0, l, w, 0, l,
    -w, h, l, w, h, l,
  ]);
  const indices = [
    0, 1, 3, 0, 3, 2,
    2, 3, 5, 2, 5, 4,
    0, 2, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 3,
    0, 4, 2,
    1, 3, 5,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function rampSurfaceY(rampDef, point, margin = 0) {
  const ramp = normalizeRamp(rampDef);
  const local = new THREE.Vector3(point.x - ramp.x, 0, point.z - ramp.z)
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -ramp.rot);
  if (Math.abs(local.x) > ramp.width / 2 + margin || Math.abs(local.z) > ramp.length / 2 + margin) return null;
  const t = Math.max(0, Math.min(1, (local.z + ramp.length / 2) / ramp.length));
  return ramp.y + t * ramp.height;
}

export function rampUphillDirection(rampDef) {
  const ramp = normalizeRamp(rampDef);
  return new THREE.Vector3(Math.sin(ramp.rot), 0, Math.cos(ramp.rot)).normalize();
}
