import * as THREE from "https://esm.sh/three@0.165.0";
import { OrbitControls } from "https://esm.sh/three@0.165.0/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "https://esm.sh/three@0.165.0/examples/jsm/controls/TransformControls.js";
import { FpsTestRuntime } from "./physics/fpsTestRuntime.js";
import { state, colors } from "./editorState.js";

const $ = (selector) => document.querySelector(selector);
const viewport = $("#viewport");

export const scene = new THREE.Scene();
scene.background = new THREE.Color(state.map.sky);
scene.fog = new THREE.Fog(state.map.fog, state.map.fogNear, state.map.fogFar);

export const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 1000);
camera.position.set(36, 36, 48);

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewport.appendChild(renderer.domElement);

export const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0, 0);

export const transform = new TransformControls(camera, renderer.domElement);
transform.setMode("translate");
scene.add(transform);

export const fpsTest = new FpsTestRuntime({
  scene,
  camera,
  domElement: renderer.domElement,
  onExit: null, // set in main orchestrator
  onStatus: (text) => {
    const statusEl = $("#test-status");
    if (statusEl) statusEl.textContent = text || "Spawn test active";
  },
});

export const mapGroup = new THREE.Group();
scene.add(mapGroup);

export const weaponGroup = new THREE.Group();
scene.add(weaponGroup);

export const grid = new THREE.GridHelper(220, 220, colors.gridA, colors.gridB);
grid.position.y = 0.01;
scene.add(grid);

export const weaponGrid = new THREE.GridHelper(4, 40, 0xffaa00, 0x554433);
weaponGrid.position.y = 0.005;
weaponGrid.visible = false;
scene.add(weaponGrid);

export const boundsHelper = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: colors.edge }));
scene.add(boundsHelper);

export const hemi = new THREE.HemisphereLight(0xffffff, 0x283034, 1.9);
scene.add(hemi);

export const sun = new THREE.DirectionalLight(0xffffff, 2.8);
sun.position.set(40, 68, 32);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120;
sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120;
sun.shadow.camera.bottom = -120;
scene.add(sun);
