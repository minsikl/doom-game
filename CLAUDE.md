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

Five files, loaded in strict dependency order by `index.html`:

```
map.js      →  player.js  →  renderer.js  →  game.js
```

| File | Responsibility |
|------|---------------|
| `map.js` | `MAP` object: 24×24 grid, `CELL_SIZE`, `WALL_COLORS`, `getCell()`, `isWall()` |
| `player.js` | `PLAYER` object: position, angle, WASD + arrow + mouse-look input, per-frame `update(dt)` with axis-split collision |
| `renderer.js` | `RENDERER` object: DDA raycasting, sprite projection, minimap, colour helpers |
| `game.js` | `GAME` object: canvas sizing, `requestAnimationFrame` loop, sprite list, FPS counter, crosshair HUD |

All module objects are plain `const` globals — no ES modules, no bundler.

## Raycasting engine (renderer.js)

`RENDERER.render(sprites)` is called once per frame:

1. **Ceiling / floor** — two `fillRect` calls with flat colours.
2. **Wall pass** — one DDA ray per screen column (`_castRay`). Returns `{ perpDist, wallType, side }`. Wall-strip height = `projDist * CELL_SIZE / perpDist`. Perpendicular distance is stored in `zBuffer[]`.
3. **Sprite pass** — `_renderSprites` sorts sprites back-to-front, projects each to screen X with `tan(relAngle) * projDist`, then draws column-by-column checking `zBuffer[]` for occlusion.
4. **Minimap** — `renderMinimap()` draws a scaled top-down view in the top-right corner.

**Fish-eye correction**: `_castRay` returns the *perpendicular* distance to the wall face, not the Euclidean ray length, which eliminates barrel distortion.

**Wall shading**: N/S and E/W wall faces use two different colour shades per wall type (defined in `MAP.WALL_COLORS`). Distance-based brightness is applied on top: `shade = max(0.1, 1 − dist / MAX_SHADE_DIST)`.

## Coordinate system

- `+X` → East, `+Y` → South (matches canvas 2D).
- `angle = 0` faces East; angles increase clockwise.
- World positions are in pixels; each map cell is `MAP.CELL_SIZE` (64) pixels wide.

## Extending the game

**Add a new wall type**: add an entry to `MAP.WALL_COLORS` and use the new integer in `MAP.grid`.

**Add a new sprite type**: add a case to `RENDERER._spriteSample(type, tx)` that returns a CSS colour string or `null` (transparent) given a normalised horizontal position `tx ∈ [0,1]`.

**Add enemies to the world**: push a `{ x, y, type }` entry into `GAME.sprites`. `x`/`y` are world-space pixels — use `(col + 0.5) * MAP.CELL_SIZE` to centre a sprite inside a cell.

**Adjusting feel**: `PLAYER.MOVE_SPEED`, `PLAYER.ROT_SPEED`, `PLAYER.MOUSE_SENS`, and `RENDERER.FOV` are the primary tuning knobs.
