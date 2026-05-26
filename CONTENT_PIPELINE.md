# Content Pipeline

This project now treats maps and weapon/loadout tuning as external content.
Run the game from a static server so the browser can fetch these files:

```powershell
python -m http.server 4173
```

## Folder Layout

- `maps/manifest.json` lists all playable map files.
- `maps/fps/*.json` stores FPS arena definitions.
- `maps/golf/*.json` stores golf hole definitions.
- `assets/weapons/weapons.json` stores weapon stats and future model metadata.
- `assets/weapons/loadouts.json` stores random FPS duel loadout presets.
- `assets/models/` is the place for `.glb` and `.gltf` files referenced by maps or weapons.

Static web pages cannot scan a folder by themselves, so adding a new map means:

1. Export `maps/fps/my-map.json` from the editor.
2. Add `"fps/my-map.json"` to `maps/manifest.json`.
3. Put referenced `.glb` files under `assets/models/` or use another static URL.

## FPS Map Schema

An FPS map is a single JSON object:

```json
{
  "version": 1,
  "id": "example-arena",
  "name": "Example Arena",
  "sky": 1054754,
  "fog": 1054754,
  "fogNear": 60,
  "fogFar": 160,
  "bounds": { "x": 92, "z": 42 },
  "spawnPoints": [{ "x": -66, "z": 0 }, { "x": 66, "z": 0 }],
  "floors": [{ "x": 0, "z": 0, "sx": 184, "sz": 84 }],
  "floor": 2963776,
  "gridA": 7921919,
  "gridB": 3358800,
  "edge": 1718858,
  "boxes": [],
  "platforms": [],
  "ramps": [],
  "collision": [],
  "decor": [],
  "assets": []
}
```

Supported map object arrays:

- `boxes`: visible collidable boxes. Use for walls, cover, blocks, and playable geometry.
- `platforms`: visible floor/platform boxes that support standing but are not side-collision obstacles.
- `ramps`: visible sloped gameplay surfaces. Players can walk up them in FPS, and golf balls roll up/down them.
- `collision`: invisible collidable boxes. Use for custom GLB collision and invisible blockers.
- `decor`: visible non-collidable boxes unless `"collidable": true`.
- `assets`: GLB/GLTF visual assets.

Box object fields:

```json
{
  "name": "cover-a",
  "x": 0,
  "y": 0,
  "z": 0,
  "sx": 4,
  "sy": 2,
  "sz": 4,
  "rotX": 0,
  "rotY": 0,
  "rotZ": 0,
  "color": 5943551,
  "isPlatform": true,
  "visible": true
}
```

Ramp object fields:

```json
{
  "name": "main-ramp",
  "x": 0,
  "y": 1,
  "z": 0,
  "width": 4,
  "length": 10,
  "height": 4,
  "rot": 0,
  "color": 5943551
}
```

For FPS maps, `y` is the playable surface height at the low end of the ramp. Use `y: 1` to start on the arena floor. The ramp rises along local +Z, so `rot: 0` rises toward world +Z, `rot: 1.5708` rises toward world +X, and so on.

Golf holes can also include `ramps` with the same fields. For golf, omit `y` unless you need a raised ramp; it defaults to the green surface height.

## Golf Map Notes

Golf map JSON supports the existing `surfaces`, `ice`, `bumpers`, `mounds`, and now `ramps` arrays. Ramps are treated as playable surface, so a ball on a ramp will not fall even if the ramp extends beyond a flat surface. The ball also receives downhill acceleration based on `height / length`.

Asset object fields:

```json
{
  "url": "assets/models/arena-shell.glb",
  "position": { "x": 0, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 0, "z": 0 },
  "scale": 1,
  "collidable": false
}
```

Prefer `collidable: false` for art assets and export simple invisible boxes in `collision`.

## Editor Plan

Build the separate 3D map editor around the same schema:

1. Scene setup: load one FPS map JSON, show floors, grid, spawns, boxes, collision blocks, decor, and GLB assets.
2. Placement tools: add box, platform, ramp, invisible collision, decor box, spawn point, floor rectangle/circle, and GLB asset.
3. Transform tools: move, rotate, scale, duplicate, delete, snap-to-grid, and numeric inspector values.
4. Visibility tools: toggle art assets, collision blocks, gameplay boxes, spawn points, and floor bounds.
5. Validation: warn when spawns are missing, boxes/ramps are outside floors, ramp slope is too steep, IDs are duplicated, or GLB URLs are missing.
6. Export: write the FPS map JSON and update/show the manifest entry that needs to be added.
7. Preview mode: load the exported map in GolfShooter and run a basic spawn/collision check.

For weapons, the editor can start as a config tool: load a `.glb`, adjust first-person offset, third-person offset, muzzle point, and scale, then write those values into `assets/weapons/weapons.json`.
