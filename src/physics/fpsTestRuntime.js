import * as THREE from "three";
import { makeRampGeometry, rampSurfaceY } from "./ramps.js";

const PLAYER_RADIUS = 0.42;
const PLAYER_EYE_HEIGHT = 1.58;
const PLAYER_HEIGHT = 1.78;
const GRAVITY = 24;
const WALK_SPEED = 8.5;
const SPRINT_SPEED = 12;
const JUMP_SPEED = 8.2;
const STEP_HEIGHT = 0.74;

export class FpsTestRuntime {
  constructor({ scene, camera, domElement, onExit, onStatus }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.onExit = onExit;
    this.onStatus = onStatus;
    this.active = false;
    this.keys = new Set();
    this.projectiles = [];
    this.clock = 0;
    this.map = null;
    this.yaw = 0;
    this.pitch = 0;
    this.player = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      grounded: false,
    };
    this.group = new THREE.Group();
    this.group.name = "fps-test-runtime";
    this.colliderGroup = new THREE.Group();
    this.colliderGroup.name = "fps-test-colliders";
    this.colliderGroup.visible = false;
    this.group.add(this.colliderGroup);
    this.body = makePlayerBody();
    this.group.add(this.body);
    this.raycaster = new THREE.Raycaster();
    this.statusMarker = null;

    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onKeyUp = (event) => this.handleKeyUp(event);
    this.onMouseMove = (event) => this.handleMouseMove(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerLockChange = () => this.handlePointerLockChange();
  }

  start(map, spawnIndex = 0) {
    this.stop(false);
    this.map = structuredClone(map);
    const spawn = this.map.spawnPoints?.[spawnIndex] || this.map.spawnPoints?.[0] || { x: 0, z: 0 };
    const surfaceY = this.surfaceYAt(spawn.x, spawn.z) ?? 0;
    this.player.pos.set(Number(spawn.x || 0), surfaceY + 0.02, Number(spawn.z || 0));
    this.player.vel.set(0, 0, 0);
    this.player.grounded = true;
    this.yaw = spawnIndex === 0 ? 0 : Math.PI;
    this.pitch = 0;
    this.keys.clear();
    this.projectiles.length = 0;
    this.active = true;
    this.rebuildColliders();
    this.scene.add(this.group);
    this.syncCamera();
    this.setStatus("Spawn test active");
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.domElement.requestPointerLock?.();
  }

  stop(announce = true) {
    if (!this.active && !this.scene.children.includes(this.group)) return;
    this.active = false;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.domElement.removeEventListener("pointerdown", this.onPointerDown);
    if (document.pointerLockElement === this.domElement) document.exitPointerLock?.();
    this.scene.remove(this.group);
    clearGroup(this.colliderGroup);
    this.projectiles.length = 0;
    this.setStatus("");
    if (announce) this.onExit?.();
  }

  update(dt) {
    if (!this.active) return;
    this.clock += dt;
    this.updateMovement(Math.min(dt, 0.05));
    this.updateProjectiles(Math.min(dt, 0.05));
    this.syncCamera();
  }

  handleKeyDown(event) {
    if (!this.active) return;
    if (event.code === "Escape") {
      event.preventDefault();
      this.stop();
      return;
    }
    if (event.code === "Space" && this.player.grounded) {
      this.player.vel.y = JUMP_SPEED;
      this.player.grounded = false;
    }
    this.keys.add(event.code);
    if (["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(event.code)) {
      event.preventDefault();
    }
  }

  handleKeyUp(event) {
    this.keys.delete(event.code);
  }

  handleMouseMove(event) {
    if (!this.active || document.pointerLockElement !== this.domElement) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch -= event.movementY * 0.0022;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
  }

  handlePointerDown(event) {
    if (!this.active) return;
    if (document.pointerLockElement !== this.domElement) {
      this.domElement.requestPointerLock?.();
      return;
    }
    if (event.button === 0) this.fireHitscan();
    if (event.button === 2) this.throwProbe();
    event.preventDefault();
  }

  handlePointerLockChange() {
    if (!this.active) return;
    this.setStatus(document.pointerLockElement === this.domElement ? "Spawn test active" : "Click viewport to focus test");
  }

  updateMovement(dt) {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const wish = new THREE.Vector3();
    if (this.keys.has("KeyW")) wish.add(forward);
    if (this.keys.has("KeyS")) wish.sub(forward);
    if (this.keys.has("KeyD")) wish.add(right);
    if (this.keys.has("KeyA")) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    const speed = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? SPRINT_SPEED : WALK_SPEED;
    this.player.vel.x = wish.x * speed;
    this.player.vel.z = wish.z * speed;
    this.player.vel.y -= GRAVITY * dt;

    const previousY = this.player.pos.y;
    this.player.pos.addScaledVector(this.player.vel, dt);

    this.resolveHorizontalCollisions(previousY);
    this.resolveGround(previousY);
    this.clampToArena();
    this.body.position.copy(this.player.pos);
  }

  resolveGround(previousY) {
    const surfaceY = this.surfaceYAt(this.player.pos.x, this.player.pos.z);
    if (surfaceY === null) {
      this.player.grounded = false;
      return;
    }

    const crossed = previousY >= surfaceY - STEP_HEIGHT && this.player.pos.y <= surfaceY + STEP_HEIGHT;
    if (this.player.vel.y <= 0 && crossed) {
      this.player.pos.y = surfaceY;
      this.player.vel.y = 0;
      this.player.grounded = true;
    } else {
      this.player.grounded = false;
    }
  }

  resolveHorizontalCollisions(previousY) {
    const solids = getSolidBoxes(this.map);
    for (const box of solids) {
      const yMin = Number(box.y || 0);
      const yMax = yMin + Number(box.sy || 1);
      const canStepOn = previousY >= yMax - STEP_HEIGHT && this.player.vel.y <= 0;
      if (canStepOn) continue;
      if (this.player.pos.y + PLAYER_HEIGHT < yMin || this.player.pos.y > yMax) continue;
      resolveCircleVsBox(this.player.pos, box, PLAYER_RADIUS);
    }
  }

  surfaceYAt(x, z) {
    let best = null;
    for (const floor of this.map?.floors || []) {
      if (pointInRect(x, z, floor, PLAYER_RADIUS)) best = Math.max(best ?? -Infinity, Number(floor.y || 0));
    }
    for (const platform of this.map?.platforms || []) {
      const top = Number(platform.y || 0) + Number(platform.sy || 1);
      if (pointInBoxTop(x, z, platform, PLAYER_RADIUS)) best = Math.max(best ?? -Infinity, top);
    }
    for (const box of this.map?.boxes || []) {
      const top = Number(box.y || 0) + Number(box.sy || 1);
      if (pointInBoxTop(x, z, box, PLAYER_RADIUS)) best = Math.max(best ?? -Infinity, top);
    }
    for (const ramp of this.map?.ramps || []) {
      const y = rampSurfaceY(ramp, { x, z }, PLAYER_RADIUS);
      if (y !== null) best = Math.max(best ?? -Infinity, y);
    }
    return best;
  }

  clampToArena() {
    if (pointInsideAnyFloor(this.player.pos.x, this.player.pos.z, this.map?.floors || [], PLAYER_RADIUS)) return;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const floor of this.map?.floors || []) {
      const halfX = Number(floor.sx || 1) / 2 - PLAYER_RADIUS;
      const halfZ = Number(floor.sz || 1) / 2 - PLAYER_RADIUS;
      const x = clamp(this.player.pos.x, Number(floor.x || 0) - halfX, Number(floor.x || 0) + halfX);
      const z = clamp(this.player.pos.z, Number(floor.z || 0) - halfZ, Number(floor.z || 0) + halfZ);
      const distance = (x - this.player.pos.x) ** 2 + (z - this.player.pos.z) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { x, z };
      }
    }
    if (nearest) {
      this.player.pos.x = nearest.x;
      this.player.pos.z = nearest.z;
    }
  }

  fireHitscan() {
    const origin = this.camera.position.clone();
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.raycaster.set(origin, direction);
    this.raycaster.far = 140;
    const hits = this.raycaster.intersectObjects(this.colliderGroup.children, true);
    const end = hits[0]?.point || origin.clone().addScaledVector(direction, 80);
    this.addTracer(origin, end, 0x7de7ff);
    this.addImpact(end, 0x7de7ff);
    this.setStatus(hits.length ? "Hitscan collision found" : "Hitscan clear");
  }

  throwProbe() {
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xf1b84b, emissive: 0x7a4d00, emissiveIntensity: 0.35 })
    );
    mesh.position.copy(this.camera.position).addScaledVector(direction, 0.7);
    this.group.add(mesh);
    this.projectiles.push({
      mesh,
      vel: direction.multiplyScalar(17).add(new THREE.Vector3(0, 2.4, 0)),
      life: 2.8,
    });
    this.setStatus("Probe launched");
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      projectile.life -= dt;
      projectile.vel.y -= GRAVITY * 0.72 * dt;
      const start = projectile.mesh.position.clone();
      const end = start.clone().addScaledVector(projectile.vel, dt);
      const delta = end.clone().sub(start);
      this.raycaster.set(start, delta.clone().normalize());
      this.raycaster.far = Math.max(0.01, delta.length() + 0.22);
      const hit = this.raycaster.intersectObjects(this.colliderGroup.children, true)[0];
      if (hit) {
        projectile.mesh.position.copy(hit.point);
        this.addImpact(hit.point, 0xf1b84b);
        projectile.life = 0;
        this.setStatus("Projectile collision found");
      } else {
        projectile.mesh.position.copy(end);
      }
      if (projectile.life <= 0) {
        this.group.remove(projectile.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  addTracer(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
    this.group.add(line);
    setTimeout(() => {
      this.group.remove(line);
      geometry.dispose();
      line.material.dispose();
    }, 140);
  }

  addImpact(position, color) {
    if (this.statusMarker) this.group.remove(this.statusMarker);
    this.statusMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 18, 18),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45 })
    );
    this.statusMarker.position.copy(position);
    this.group.add(this.statusMarker);
  }

  rebuildColliders() {
    clearGroup(this.colliderGroup);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    for (const floor of this.map?.floors || []) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Number(floor.sx || 1), 0.12, Number(floor.sz || 1)), material);
      mesh.position.set(Number(floor.x || 0), Number(floor.y || 0) - 0.06, Number(floor.z || 0));
      this.colliderGroup.add(mesh);
    }
    for (const box of [...getSolidBoxes(this.map), ...(this.map?.platforms || [])]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(Number(box.sx || 1), Number(box.sy || 1), Number(box.sz || 1)), material);
      mesh.position.set(Number(box.x || 0), Number(box.y || 0) + Number(box.sy || 1) / 2, Number(box.z || 0));
      mesh.rotation.set(Number(box.rotX || 0), Number(box.rotY || 0), Number(box.rotZ || 0));
      this.colliderGroup.add(mesh);
    }
    for (const ramp of this.map?.ramps || []) {
      const mesh = new THREE.Mesh(makeRampGeometry(ramp), material);
      mesh.position.set(Number(ramp.x || 0), Number(ramp.y ?? 1), Number(ramp.z || 0));
      mesh.rotation.y = Number(ramp.rot || 0);
      this.colliderGroup.add(mesh);
    }
  }

  syncCamera() {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    this.camera.position.set(this.player.pos.x, this.player.pos.y + PLAYER_EYE_HEIGHT, this.player.pos.z);
  }

  setStatus(text) {
    this.onStatus?.(text);
  }
}

function makePlayerBody() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - PLAYER_RADIUS * 2, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x3cb6a3, transparent: true, opacity: 0.25 })
  );
  body.position.y = PLAYER_HEIGHT / 2;
  group.add(body);
  return group;
}

function getSolidBoxes(map) {
  return [
    ...(map?.boxes || []),
    ...(map?.collision || []),
    ...(map?.decor || []).filter((item) => item.collidable),
  ];
}

function pointInRect(x, z, rect, margin = 0) {
  const halfX = Number(rect.sx || 1) / 2 + margin;
  const halfZ = Number(rect.sz || 1) / 2 + margin;
  return Math.abs(x - Number(rect.x || 0)) <= halfX && Math.abs(z - Number(rect.z || 0)) <= halfZ;
}

function pointInBoxTop(x, z, box, margin = 0) {
  const local = rotatePoint(x - Number(box.x || 0), z - Number(box.z || 0), -Number(box.rotY || 0));
  return Math.abs(local.x) <= Number(box.sx || 1) / 2 + margin && Math.abs(local.z) <= Number(box.sz || 1) / 2 + margin;
}

function pointInsideAnyFloor(x, z, floors, margin = 0) {
  return floors.some((floor) => pointInRect(x, z, floor, -margin));
}

function resolveCircleVsBox(position, box, radius) {
  const rot = Number(box.rotY || 0);
  const local = rotatePoint(position.x - Number(box.x || 0), position.z - Number(box.z || 0), -rot);
  const halfX = Number(box.sx || 1) / 2;
  const halfZ = Number(box.sz || 1) / 2;
  const closestX = clamp(local.x, -halfX, halfX);
  const closestZ = clamp(local.z, -halfZ, halfZ);
  let dx = local.x - closestX;
  let dz = local.z - closestZ;
  let distSq = dx * dx + dz * dz;

  if (distSq >= radius * radius) return;
  if (distSq < 0.0001) {
    const pushX = halfX - Math.abs(local.x);
    const pushZ = halfZ - Math.abs(local.z);
    if (pushX < pushZ) {
      dx = Math.sign(local.x || 1);
      dz = 0;
      distSq = 1;
      local.x += dx * (pushX + radius);
    } else {
      dx = 0;
      dz = Math.sign(local.z || 1);
      distSq = 1;
      local.z += dz * (pushZ + radius);
    }
  } else {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    local.x += (dx / dist) * push;
    local.z += (dz / dist) * push;
  }

  const world = rotatePoint(local.x, local.z, rot);
  position.x = Number(box.x || 0) + world.x;
  position.z = Number(box.z || 0) + world.z;
}

function rotatePoint(x, z, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: x * c - z * s, z: x * s + z * c };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children[0];
    group.remove(child);
    child.traverse?.((item) => {
      item.geometry?.dispose?.();
      if (Array.isArray(item.material)) item.material.forEach((material) => material.dispose?.());
      else item.material?.dispose?.();
    });
  }
}
