# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the game

Open `index.html` directly in any modern browser — no build step, server, or dependencies required.

For a local dev server (avoids some browser `file://` quirks):
```
npx serve .
# or
python3 -m http.server 8080
```

## Architecture

Six files, loaded in strict dependency order by `index.html`:

```
map.js  →  textures.js  →  player.js  →  renderer.js  →  game.js
```

| File | Responsibility |
|------|---------------|
| `map.js` | `MAP` object: 24×24 grid, `CELL_SIZE`, `WALL_COLORS`, `getCell()`, `isWall()` |
| `textures.js` | `TEXTURES` object: procedural 64×64 RGBA buffers for stone, brick, metal; `getBuffer(type)` |
| `player.js` | `PLAYER` object: position, angle, WASD + arrow + mouse-look input, per-frame `update(dt)` with axis-split collision |
| `renderer.js` | `RENDERER` object: DDA raycasting, ImageData pixel buffer, sprite projection, minimap |
| `game.js` | `GAME` object: canvas sizing, `requestAnimationFrame` loop, sprite list, FPS counter, crosshair HUD |

All module objects are plain `const` globals — no ES modules, no bundler.

## Raycasting engine (renderer.js)

`RENDERER.render(sprites)` is called once per frame:

1. **Background reset** — `buf.set(_bgBuffer)` copies the pre-built ceiling/floor pixel data into the `ImageData` buffer in one shot (faster than `fillRect` because it bypasses canvas state).
2. **Wall pass** — one DDA ray per screen column (`_castRay`). Returns `{ perpDist, wallType, side, wallHitX }`. Wall-strip height = `projDist * CELL_SIZE / perpDist`. Each pixel in the strip is written directly into the `ImageData` buffer: `buf[idx] = texBuf[ti] * shade`. Perpendicular distance stored in `zBuffer[]`.
3. **`ctx.putImageData`** — flushes the entire pixel buffer to the canvas in one call.
4. **Sprite pass** — `_renderSprites` sorts sprites back-to-front, projects each to screen X with `tan(relAngle) * projDist`, then draws column-by-column with `fillRect` checking `zBuffer[]` for occlusion.
5. **Minimap** — `renderMinimap()` draws a scaled top-down view in the top-right corner.

**Fish-eye correction**: `_castRay` returns the *perpendicular* distance to the wall face, not the Euclidean ray length, which eliminates barrel distortion.

**Wall texturing**: `wallHitX` (0–1) identifies where along the wall face the ray hit. `texX = wallHitX * TEX_SIZE`. Per-pixel `texY` is computed from the screen-y position within the wall strip. A flip correction ensures consistent texture orientation regardless of ray direction.

**Wall shading**: E/W faces (`side=0`) are multiplied by 0.7 relative to N/S faces for a free depth cue. Distance-based brightness is applied on top: `shade = max(0.1, 1 − dist / MAX_SHADE_DIST)`.

## Coordinate system

- `+X` → East, `+Y` → South (matches canvas 2D).
- `angle = 0` faces East; angles increase clockwise.
- World positions are in pixels; each map cell is `MAP.CELL_SIZE` (64) pixels wide.

## Extending the game

**Add a new wall type**: add an entry to `MAP.WALL_COLORS` and use the new integer in `MAP.grid`.

**Add a new wall texture**: add a generator function in `textures.js` and register it in `_buffers` under a new integer key. Use the same integer in `MAP.WALL_COLORS` and `MAP.grid`.

**Add a new sprite type**: add a case to `RENDERER._spriteSample(type, tx)` that returns a CSS colour string or `null` (transparent) given a normalised horizontal position `tx ∈ [0,1]`.

**Add enemies to the world**: push a `{ x, y, type }` entry into `GAME.sprites`. `x`/`y` are world-space pixels — use `(col + 0.5) * MAP.CELL_SIZE` to centre a sprite inside a cell.

**Adjusting feel**: `PLAYER.MOVE_SPEED`, `PLAYER.ROT_SPEED`, `PLAYER.MOUSE_SENS`, and `RENDERER.FOV` are the primary tuning knobs.
