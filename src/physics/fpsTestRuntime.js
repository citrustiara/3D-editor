import * as THREE from "https://esm.sh/three@0.165.0";
import { makeRampGeometry, normalizeRamp, rampLocalPoint, rampSurfaceInfo, rampSurfaceY, rampWorldPoint } from "./ramps.js";

const PLAYER_RADIUS = 0.42;
const PLAYER_EYE_HEIGHT = 1.58;
const PLAYER_HEIGHT = 1.78;
const GRAVITY = 30;
const WALK_SPEED = 14.5;
const JUMP_SPEED = 9.2;
const FPS_RAMP_PROBE_MARGIN = 0.08;
const FPS_RAMP_LAND_EPSILON = 0.10;
const FPS_RAMP_STEP_UP = 0.46;
const FPS_RAMP_STEP_DOWN = 0.72;
const FPS_RAMP_SOLID_TOP_CLEARANCE = 0.06;
const DEATH_DROP = 10;

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
    this.solidColliders = [];
    this.platformColliders = [];
    this.rampColliders = [];
    this.spawnIndex = 0;
    this.deaths = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.player = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      grounded: false,
      groundSurface: null,
      sliding: false,
    };
    this.slideTimer = 0;
    this.slideCooldown = 0;
    this.slideKeyWasDown = false;
    this.currentCamHeight = PLAYER_EYE_HEIGHT;
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
    this.spawnIndex = spawnIndex;
    this.deaths = 0;
    this.yaw = spawnIndex === 0 ? 0 : Math.PI;
    this.pitch = 0;
    this.keys.clear();
    this.projectiles.length = 0;
    this.active = true;
    this.rebuildColliders();
    this.resetPlayerToSpawn();
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
    const p = this.player;
    const previousPosition = p.pos.clone();
    const previousY = previousPosition.y;

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (this.keys.has("KeyW")) move.add(forward);
    if (this.keys.has("KeyS")) move.sub(forward);
    if (this.keys.has("KeyA")) move.sub(right);
    if (this.keys.has("KeyD")) move.add(right);
    if (move.lengthSq() > 0) move.normalize();

    const wasGrounded = p.grounded;
    const wasGroundSurface = p.groundSurface || null;
    const slideKey = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.keys.has("ControlLeft");
    const slidePressed = slideKey && !this.slideKeyWasDown;
    const wantsSlide = slidePressed && p.grounded && move.lengthSq() > 0 && this.slideCooldown <= 0;

    if (wantsSlide) {
      this.slideTimer = 0.58;
      this.slideCooldown = 0.65;
      p.vel.addScaledVector(move, 7.5);
    }
    p.sliding = this.slideTimer > 0 && p.grounded;
    this.slideKeyWasDown = slideKey;

    if (this.slideTimer > 0) this.slideTimer -= dt;
    if (this.slideCooldown > 0) this.slideCooldown -= dt;

    // Match GolfShooter's snappy FPS movement constants.
    const accel = p.sliding ? 32 : (p.grounded ? 220 : 25);
    const maxSpeed = p.sliding ? 22 : WALK_SPEED;
    p.vel.addScaledVector(move, accel * dt);

    const baseFriction = p.sliding ? 0.976 : (p.grounded ? (move.lengthSq() > 0 ? 0.80 : 0.65) : 0.985);
    const friction = Math.pow(baseFriction, dt * 60);
    p.vel.x *= friction;
    p.vel.z *= friction;

    const horiz = Math.hypot(p.vel.x, p.vel.z);
    if (horiz > maxSpeed) {
      const scale = maxSpeed / horiz;
      p.vel.x *= scale;
      p.vel.z *= scale;
    }

    if (this.keys.has("Space") && p.grounded) {
      p.vel.y = JUMP_SPEED;
      p.grounded = false;
    }

    p.vel.y -= GRAVITY * dt;
    p.pos.addScaledVector(p.vel, dt);

    this.resolveCeilingCollisions(previousY);

    let onPlat = false;
    let platSurface = null;

    for (const ramp of this.rampColliders) resolvePlayerVsRampSolid(p, previousPosition, ramp, PLAYER_RADIUS);

    const rampSurface = this.fpsRampSurface(previousPosition, p.vel.y, wasGrounded, wasGroundSurface);
    if (rampSurface) {
      p.pos.y = rampSurface.y;
      p.vel.y = 0;
      onPlat = true;
      platSurface = rampSurface.surface;
    } else {
      const flatSurface = this.fpsFlatSurfaceY(p.pos, previousY, p.vel.y, wasGrounded, wasGroundSurface);
      if (flatSurface) {
        p.pos.y = flatSurface.y;
        p.vel.y = 0;
        onPlat = true;
        platSurface = flatSurface.surface;
      }
    }
    if (onPlat) p.groundSurface = platSurface;

    let onFloor = false;
    let bestFloorY = -Infinity;
    for (const floor of this.map?.floors || []) {
      if (pointInFloor(p.pos.x, p.pos.z, floor, PLAYER_RADIUS)) {
        const y = Number(floor.y || 0);
        if (y > bestFloorY) {
          bestFloorY = y;
          onFloor = true;
        }
      }
    }

    if (!onPlat && onFloor && p.pos.y <= bestFloorY) {
      p.pos.y = bestFloorY;
      p.vel.y = 0;
      p.grounded = true;
      p.groundSurface = "floor";
    } else {
      p.grounded = onPlat;
      if (!p.grounded) p.groundSurface = null;
    }

    this.killIfFallen();
    this.clampToArena();
    for (const collider of uniqueColliders([...this.solidColliders, ...this.platformColliders])) {
      if (shouldSkipCompositeSurfaceCollision(p, collider)) continue;
      resolvePlayerVsColliderObb(p.pos, collider, PLAYER_RADIUS);
    }
    this.clampToArena();
    this.body.position.copy(p.pos);

    this.currentCamHeight = THREE.MathUtils.lerp(
      this.currentCamHeight || PLAYER_EYE_HEIGHT,
      p.sliding ? 0.8 : PLAYER_EYE_HEIGHT,
      dt * 10
    );
  }

  resolveCeilingCollisions(previousY) {
    const p = this.player;
    if (p.vel.y <= 0) return;
    const previousHead = previousY + PLAYER_HEIGHT;
    const currentHead = p.pos.y + PLAYER_HEIGHT;
    const CEILING_TOLERANCE = 0.20;
    for (const collider of uniqueColliders([...this.platformColliders, ...this.solidColliders])) {
      if (!pointInObbTop(p.pos.x, p.pos.z, collider, PLAYER_RADIUS)) continue;
      if (previousHead <= collider.bottom + CEILING_TOLERANCE && currentHead >= collider.bottom) {
        p.pos.y = collider.bottom - PLAYER_HEIGHT - 0.01;
        p.vel.y = 0;
        break;
      }
    }
  }

  fpsFlatSurfaceY(position, previousY, velocityY, wasGrounded, wasGroundSurface) {
    if (velocityY > 0) return null;
    let best = null;
    for (const surface of uniqueColliders([...this.platformColliders, ...this.solidColliders])) {
      const inside = pointInObbTop(position.x, position.z, surface, PLAYER_RADIUS);
      const canSnap = (wasGrounded && wasGroundSurface === surface) ||
        (previousY >= surface.top - 0.05 && position.y <= surface.top);
      if (inside && canSnap && (!best || surface.top > best.y)) {
        best = { y: surface.top, surface };
      }
    }
    return best;
  }

  fpsRampSurface(previousPosition, velocityY, wasGrounded, wasGroundSurface) {
    let best = null;
    const p = this.player;
    for (const ramp of this.rampColliders) {
      const info = rampSurfaceInfo(ramp, p.pos, FPS_RAMP_PROBE_MARGIN);
      if (!info) continue;

      const alreadyOnRamp = wasGrounded && wasGroundSurface === ramp;
      if (velocityY > 0) continue;

      const previousInfo = rampSurfaceInfo(ramp, previousPosition, FPS_RAMP_PROBE_MARGIN);
      const previousSurfaceY = previousInfo?.y ?? info.y;
      const maxStepUp = alreadyOnRamp ? FPS_RAMP_STEP_UP : Math.min(FPS_RAMP_STEP_UP, Math.max(0.18, Math.abs(velocityY) * 0.04 + 0.18));
      const nearSurfaceNow = p.pos.y >= info.y - FPS_RAMP_STEP_DOWN && p.pos.y <= info.y + FPS_RAMP_LAND_EPSILON;
      const crossedSurface = previousPosition.y >= previousSurfaceY - 0.05 && nearSurfaceNow;
      const canStepUp = wasGrounded && previousPosition.y >= info.y - maxStepUp && nearSurfaceNow;
      const canContinueOnRamp = alreadyOnRamp && p.pos.y <= info.y + FPS_RAMP_STEP_DOWN;
      const canLandOrStepOn = velocityY <= 0 && (crossedSurface || canStepUp);

      if ((canContinueOnRamp || canLandOrStepOn) && (!best || info.y > best.y)) {
        best = { y: info.y, surface: ramp, normal: info.normal };
      }
    }
    return best;
  }

  surfaceYAt(x, z, previousY = Infinity, currentY = previousY, wasGrounded = false, wasGroundSurface = null) {
    let best = null;
    this.player.groundSurface = null;
    for (const floor of this.map?.floors || []) {
      if (pointInFloor(x, z, floor, PLAYER_RADIUS)) {
        const y = Number(floor.y || 0);
        if (best === null || y > best) {
          best = y;
          this.player.groundSurface = "floor";
        }
      }
    }
    for (const platform of uniqueColliders([...this.platformColliders, ...this.solidColliders])) {
      const canSnap = (wasGrounded && wasGroundSurface === platform) || canSnapToSurface(platform.top, previousY, currentY);
      if (canSnap && pointInObbTop(x, z, platform, PLAYER_RADIUS) && (best === null || platform.top > best)) {
        best = platform.top;
        this.player.groundSurface = platform;
      }
    }
    for (const ramp of this.rampColliders) {
      const y = rampSurfaceY(ramp, { x, z }, PLAYER_RADIUS);
      const canSnap = (wasGrounded && wasGroundSurface === ramp) || canSnapToRampSurface(y, previousY, currentY);
      if (y !== null && canSnap && (best === null || y > best)) {
        best = y;
        this.player.groundSurface = ramp;
      }
    }
    return best;
  }

  resetPlayerToSpawn() {
    const spawn = this.map?.spawnPoints?.[this.spawnIndex] || this.map?.spawnPoints?.[0] || { x: 0, z: 0 };
    const surfaceY = this.surfaceYAt(Number(spawn.x || 0), Number(spawn.z || 0), Infinity, Infinity) ?? 0;
    this.player.pos.set(Number(spawn.x || 0), surfaceY, Number(spawn.z || 0));
    this.player.vel.set(0, 0, 0);
    this.player.grounded = true;
    if (!this.player.groundSurface) this.player.groundSurface = "floor";
    this.body.position.copy(this.player.pos);
  }

  killIfFallen() {
    const floorY = this.lowestArenaY();
    if (this.player.pos.y > floorY - DEATH_DROP) return;
    this.deaths += 1;
    this.resetPlayerToSpawn();
    this.setStatus(`Fell out. Respawned (${this.deaths})`);
  }

  lowestArenaY() {
    let lowest = (this.map?.floors && this.map.floors.length > 0) ? Infinity : -60;
    for (const floor of this.map?.floors || []) lowest = Math.min(lowest, Number(floor.y || 0));
    for (const ramp of this.map?.ramps || []) lowest = Math.min(lowest, Number(ramp.y ?? 0));
    if (lowest === Infinity) lowest = 0;
    return lowest;
  }

  clampToArena() {
    if (this.player.grounded && this.player.groundSurface && this.player.groundSurface !== "floor") return;
    const floors = this.map?.floors || [];
    if (isPointInsideArena(this.player.pos, floors, PLAYER_RADIUS)) return;
    let best = null;
    let bestDist = Infinity;
    for (const floor of floors) {
      let candidate;
      if (floor.type === "circle") {
        const dx = this.player.pos.x - Number(floor.x || 0);
        const dz = this.player.pos.z - Number(floor.z || 0);
        const len = Math.max(0.0001, Math.hypot(dx, dz));
        const r = Math.max(0, Number(floor.r || 1) - PLAYER_RADIUS);
        candidate = { x: Number(floor.x || 0) + (dx / len) * r, z: Number(floor.z || 0) + (dz / len) * r };
      } else {
        const x = Number(floor.x || 0);
        const z = Number(floor.z || 0);
        const halfX = Number(floor.sx || 1) / 2;
        const halfZ = Number(floor.sz || 1) / 2;
        candidate = {
          x: clamp(this.player.pos.x, x - halfX + PLAYER_RADIUS, x + halfX - PLAYER_RADIUS),
          z: clamp(this.player.pos.z, z - halfZ + PLAYER_RADIUS, z + halfZ - PLAYER_RADIUS),
        };
      }
      const dist = Math.hypot(candidate.x - this.player.pos.x, candidate.z - this.player.pos.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    if (best) {
      this.player.pos.x = best.x;
      this.player.pos.z = best.z;
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
    this.solidColliders = getSolidBoxes(this.map).map(createBoxCollider);
    this.platformColliders = (this.map?.platforms || []).map(createBoxCollider);
    this.rampColliders = (this.map?.ramps || []).map(createRampCollider);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    for (const floor of this.map?.floors || []) {
      const mesh = floor.type === "circle"
        ? new THREE.Mesh(new THREE.CylinderGeometry(Number(floor.r || 1), Number(floor.r || 1), 0.12, 48), material)
        : new THREE.Mesh(new THREE.BoxGeometry(Number(floor.sx || 1), 0.12, Number(floor.sz || 1)), material);
      mesh.position.set(Number(floor.x || 0), Number(floor.y || 0) - 0.06, Number(floor.z || 0));
      this.colliderGroup.add(mesh);
    }
    for (const box of [...getSolidBoxes(this.map), ...(this.map?.platforms || [])]) {
      this.colliderGroup.add(createBoxColliderMesh(box, material));
    }
    for (const ramp of this.map?.ramps || []) {
      const normalized = normalizeRamp(ramp);
      const mesh = new THREE.Mesh(makeRampGeometry(normalized), material);
      mesh.position.set(normalized.x, normalized.y, normalized.z);
      mesh.rotation.y = normalized.rot;
      this.colliderGroup.add(mesh);
    }
  }

  syncCamera() {
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    this.camera.position.set(this.player.pos.x, this.player.pos.y + (this.currentCamHeight || PLAYER_EYE_HEIGHT), this.player.pos.z);
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
    ...(map?.assets || []).filter((item) => item.collidable && hasBoxStats(item)),
  ];
}

function pointInFloor(x, z, floor, margin = 0) {
  if (floor.type === "circle") {
    return Math.hypot(x - Number(floor.x || 0), z - Number(floor.z || 0)) <= Number(floor.r || 1) + margin;
  }
  const halfX = Number(floor.sx || 1) / 2 + margin;
  const halfZ = Number(floor.sz || 1) / 2 + margin;
  return Math.abs(x - Number(floor.x || 0)) <= halfX && Math.abs(z - Number(floor.z || 0)) <= halfZ;
}

function isPointInsideArena(point, floors, margin = 0) {
  if (!floors || floors.length === 0) return true;
  return floors.some((floor) => {
    if (floor.type === "circle") {
      return Math.hypot(point.x - Number(floor.x || 0), point.z - Number(floor.z || 0)) <= Number(floor.r || 1) - margin;
    }
    return point.x >= Number(floor.x || 0) - Number(floor.sx || 1) / 2 + margin &&
      point.x <= Number(floor.x || 0) + Number(floor.sx || 1) / 2 - margin &&
      point.z >= Number(floor.z || 0) - Number(floor.sz || 1) / 2 + margin &&
      point.z <= Number(floor.z || 0) + Number(floor.sz || 1) / 2 - margin;
  });
}

function canSnapToSurface(surfaceY, previousY, currentY) {
  if (previousY === Infinity) return true;
  return previousY >= surfaceY - 0.05 && currentY <= surfaceY;
}

function canSnapToRampSurface(surfaceY, previousY, currentY) {
  if (surfaceY === null) return false;
  if (previousY === Infinity) return true;
  return previousY >= surfaceY - FPS_RAMP_STEP_DOWN && currentY <= surfaceY + FPS_RAMP_LAND_EPSILON;
}

function createRampCollider(rampDef) {
  return normalizeRamp(rampDef);
}

function createBoxCollider(box) {
  const stats = getBoxStats(box);
  const center = new THREE.Vector3(stats.x, stats.y + stats.sy / 2, stats.z);
  const rotation = new THREE.Euler(stats.rotX, stats.rotY, stats.rotZ, "XYZ");
  const quaternion = new THREE.Quaternion().setFromEuler(rotation);
  const inverseQuaternion = quaternion.clone().invert();
  const halfSize = new THREE.Vector3(stats.sx / 2, stats.sy / 2, stats.sz / 2);
  const corners = [];
  for (const x of [-halfSize.x, halfSize.x]) {
    for (const y of [-halfSize.y, halfSize.y]) {
      for (const z of [-halfSize.z, halfSize.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyQuaternion(quaternion).add(center));
      }
    }
  }
  return {
    box,
    stats,
    center,
    quaternion,
    inverseQuaternion,
    halfSize,
    bottom: Math.min(...corners.map((corner) => corner.y)),
    top: Math.max(...corners.map((corner) => corner.y)),
  };
}

function createBoxColliderMesh(box, material) {
  const stats = getBoxStats(box);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(stats.sx, stats.sy, stats.sz), material);
  mesh.position.set(stats.x, stats.y + stats.sy / 2, stats.z);
  mesh.rotation.set(stats.rotX, stats.rotY, stats.rotZ);
  return mesh;
}

function hasBoxStats(box = {}) {
  return box.sx !== undefined || box.sy !== undefined || box.sz !== undefined ||
    box.width !== undefined || box.height !== undefined || box.depth !== undefined ||
    box.scale !== undefined;
}

function getBoxStats(box = {}) {
  const position = box.position || {};
  const rotation = box.rotation || {};
  const scale = normalizeScale(box.scale);
  const sx = positiveNumber(box.sx ?? box.width ?? box.size?.x ?? 1, 1) * scale.x;
  const sy = positiveNumber(box.sy ?? box.height ?? box.size?.y ?? 1, 1) * scale.y;
  const sz = positiveNumber(box.sz ?? box.depth ?? box.size?.z ?? 1, 1) * scale.z;
  return {
    x: finiteNumber(box.x ?? position.x, 0),
    y: finiteNumber(box.y ?? position.y, 0),
    z: finiteNumber(box.z ?? position.z, 0),
    sx,
    sy,
    sz,
    rotX: finiteNumber(box.rotX ?? rotation.x, 0),
    rotY: finiteNumber(box.rotY ?? box.rot ?? rotation.y, 0),
    rotZ: finiteNumber(box.rotZ ?? rotation.z, 0),
  };
}

function normalizeScale(scale) {
  if (typeof scale === "number") return { x: Math.abs(scale), y: Math.abs(scale), z: Math.abs(scale) };
  return {
    x: positiveNumber(scale?.x, 1),
    y: positiveNumber(scale?.y, 1),
    z: positiveNumber(scale?.z, 1),
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return Math.max(0.001, Math.abs(number));
}

function pointInObbTop(x, z, collider, margin = 0) {
  const local = new THREE.Vector3(x, collider.top, z)
    .sub(collider.center)
    .applyQuaternion(collider.inverseQuaternion);
  return Math.abs(local.x) <= collider.halfSize.x + margin && Math.abs(local.z) <= collider.halfSize.z + margin;
}

function shouldSkipCompositeSurfaceCollision(player, obstacle) {
  const support = player.groundSurface;
  if (!player.grounded || !support || support === "floor" || support === obstacle) return false;
  if (!support.center) return false;
  const standingOnSupport = Math.abs(player.pos.y - support.top) <= 0.12;
  const obstacleCrossesFeet = obstacle.bottom <= player.pos.y + 0.08 && obstacle.top > player.pos.y + 0.08;
  const overlapsX = support.center.x - support.halfSize.x < obstacle.center.x + obstacle.halfSize.x - 0.02 &&
    support.center.x + support.halfSize.x > obstacle.center.x - obstacle.halfSize.x + 0.02;
  const overlapsZ = support.center.z - support.halfSize.z < obstacle.center.z + obstacle.halfSize.z - 0.02 &&
    support.center.z + support.halfSize.z > obstacle.center.z - obstacle.halfSize.z + 0.02;
  return standingOnSupport && obstacleCrossesFeet && overlapsX && overlapsZ;
}

function resolvePlayerVsRampSolid(player, previousPosition, ramp, radius) {
  const position = player.pos;
  const local = rampLocalPoint(ramp, position);
  const halfWidth = ramp.width / 2;
  const halfLength = ramp.length / 2;
  if (
    local.x < -halfWidth - radius ||
    local.x > halfWidth + radius ||
    local.z < -halfLength - radius ||
    local.z > halfLength + radius
  ) return;

  const clampedX = clamp(local.x, -halfWidth, halfWidth);
  const clampedZ = clamp(local.z, -halfLength, halfLength);
  const surfaceT = (clampedZ + halfLength) / ramp.length;
  const solidTopY = ramp.y + surfaceT * ramp.height;
  const topInfo = rampSurfaceInfo(ramp, position, FPS_RAMP_PROBE_MARGIN);
  const previousTopInfo = rampSurfaceInfo(ramp, previousPosition, FPS_RAMP_PROBE_MARGIN);
  const wasOnRampTop = previousTopInfo &&
    previousPosition.y >= previousTopInfo.y - 0.08 &&
    previousPosition.y <= previousTopInfo.y + FPS_RAMP_LAND_EPSILON;
  if (wasOnRampTop && topInfo && player.vel.y > 0) {
    position.y = Math.max(position.y, topInfo.y + 0.04);
    return;
  }

  const canUseTopSurface = topInfo &&
    player.vel.y <= 0 &&
    previousPosition.y >= topInfo.y - FPS_RAMP_STEP_UP &&
    position.y >= topInfo.y - FPS_RAMP_STEP_DOWN &&
    position.y <= topInfo.y + FPS_RAMP_LAND_EPSILON;
  if (canUseTopSurface) return;

  if (position.y >= solidTopY - FPS_RAMP_SOLID_TOP_CLEARANCE) return;
  if (position.y + PLAYER_HEIGHT <= ramp.y + 0.05) return;

  const fromLowEnd = local.z < -halfLength && previousPosition.y >= ramp.y - FPS_RAMP_SOLID_TOP_CLEARANCE;
  if (fromLowEnd) return;

  let targetLocal = null;
  let normalLocal = null;
  const dx = local.x - clampedX;
  const dz = local.z - clampedZ;
  const distSq = dx * dx + dz * dz;

  if (distSq > 0.0001) {
    if (distSq >= radius * radius) return;
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    targetLocal = { x: local.x + (dx / dist) * push, z: local.z + (dz / dist) * push };
    normalLocal = new THREE.Vector3(dx / dist, 0, dz / dist);
  } else {
    const previousLocal = rampLocalPoint(ramp, previousPosition);
    if (previousLocal.x < -halfWidth) {
      targetLocal = { x: -halfWidth - radius, z: local.z };
      normalLocal = new THREE.Vector3(-1, 0, 0);
    } else if (previousLocal.x > halfWidth) {
      targetLocal = { x: halfWidth + radius, z: local.z };
      normalLocal = new THREE.Vector3(1, 0, 0);
    } else if (previousLocal.z > halfLength) {
      targetLocal = { x: local.x, z: halfLength + radius };
      normalLocal = new THREE.Vector3(0, 0, 1);
    } else if (previousLocal.z < -halfLength && previousPosition.y < ramp.y - FPS_RAMP_SOLID_TOP_CLEARANCE) {
      targetLocal = { x: local.x, z: -halfLength - radius };
      normalLocal = new THREE.Vector3(0, 0, -1);
    } else {
      return;
    }
  }

  const worldPoint = rampWorldPoint(ramp, targetLocal);
  position.x = worldPoint.x;
  position.z = worldPoint.z;

  const normalWorld = normalLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ramp.rot).normalize();
  const inwardVelocity = player.vel.dot(normalWorld);
  if (inwardVelocity < 0) player.vel.addScaledVector(normalWorld, -inwardVelocity);
}

function resolvePlayerVsColliderObb(position, collider, radius) {
  const MICRO_STEP_HEIGHT = 0.36;
  const TOP_CLEARANCE = 0.08;
  const bottom = collider.bottom;
  const top = collider.top;
  if (position.y >= top - TOP_CLEARANCE || position.y + PLAYER_HEIGHT < bottom) return;

  const local = new THREE.Vector3(position.x, Math.max(bottom, Math.min(top, position.y)), position.z)
    .sub(collider.center)
    .applyQuaternion(collider.inverseQuaternion);

  const localYAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(collider.quaternion);
  const sinPhi = Math.sqrt(Math.max(0, 1 - localYAxis.y * localYAxis.y));
  const maxProj = PLAYER_HEIGHT * Math.abs(localYAxis.y) + radius * sinPhi;
  if (Math.abs(local.y) > collider.halfSize.y + maxProj) return;

  const closestX = clamp(local.x, -collider.halfSize.x, collider.halfSize.x);
  const closestZ = clamp(local.z, -collider.halfSize.z, collider.halfSize.z);
  let dx = local.x - closestX;
  let dz = local.z - closestZ;
  const distSq = dx * dx + dz * dz;
  if (distSq >= radius * radius) return;

  const stepHeight = top - position.y;
  if (stepHeight > TOP_CLEARANCE && stepHeight <= MICRO_STEP_HEIGHT) {
    position.y = top;
    return;
  }

  if (distSq < 0.0001) {
    const pushX = collider.halfSize.x - Math.abs(local.x);
    const pushZ = collider.halfSize.z - Math.abs(local.z);
    if (pushX < pushZ) {
      dx = Math.sign(local.x || 1);
      dz = 0;
      local.x += dx * (pushX + radius);
    } else {
      dx = 0;
      dz = Math.sign(local.z || 1);
      local.z += dz * (pushZ + radius);
    }
  } else {
    const dist = Math.sqrt(distSq);
    const push = radius - dist;
    local.x += (dx / dist) * push;
    local.z += (dz / dist) * push;
  }

  const worldPos = local.applyQuaternion(collider.quaternion).add(collider.center);
  position.x = worldPos.x;
  position.z = worldPos.z;
}

function uniqueColliders(colliders) {
  return [...new Set(colliders)];
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
