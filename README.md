# 3D Content Editor

A static Three.js editor for the content schema described in
[`CONTENT_PIPELINE.md`](CONTENT_PIPELINE.md).

![3D editor screenshot](images/Screenshot%202026-05-26%20at%2021-11-28%20Game%20Content%203D%20Editor.png)

## Run

Serve the folder from a local static server:

```powershell
python -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## What It Edits

- FPS map metadata, bounds, colors, floor rectangles, spawn points, boxes,
  platforms, ramps, collision blocks, decor, and GLB/GLTF visual assets.
- Visibility layers for collision, gameplay geometry, art assets, spawns, floors,
  and bounds.
- Selection transforms using move, rotate, scale, duplicate, delete, snap-to-grid,
  rotation snapping, undo/redo, and numeric inspector fields.
- Validation for missing spawns, invalid floor coverage, duplicate object names,
  steep ramps, spawn/collision overlaps, and missing asset URLs.
- Exported FPS map JSON plus the `maps/manifest.json` entry to add.
- A quick FPS spawn test mode backed by `src/physics/fpsTestRuntime.js` for
  checking floor bounds, box collision, ramps, hitscan traces, and projectile
  probes without importing the full game shell.
- A small weapon model config tool for model URL, scale, first-person offset,
  third-person offset, and muzzle point values.
