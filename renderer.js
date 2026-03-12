/**
 * renderer.js — Raycasting engine, sprite projection, and minimap.
 *
 * Rendering pipeline each frame:
 *   1. Clear + draw flat ceiling / floor rectangles.
 *   2. Cast one ray per screen column using the DDA algorithm.
 *      • Each ray returns the perpendicular wall distance (fish-eye corrected).
 *      • Draw a vertical wall strip, shaded by distance, into the column.
 *      • Store perpendicular distance in zBuffer[] for sprite occlusion.
 *   3. Sort sprites back-to-front; project each onto screen columns;
 *      skip any column already occluded by a nearer wall (zBuffer check).
 *   4. Draw minimap overlay.
 *
 * Depends on: map.js (MAP), player.js (PLAYER)
 */

const RENDERER = {

  // ─── Config ─────────────────────────────────────────────────────────────────

  /** Horizontal field of view in radians. */
  FOV: Math.PI / 3,   // 60°

  /** Maximum distance at which walls receive any light. */
  MAX_SHADE_DIST: 700,

  // ─── Runtime state ──────────────────────────────────────────────────────────

  canvas: null,
  ctx:    null,

  /**
   * Per-column perpendicular distance to the nearest wall.
   * Used to occlude sprites behind walls.
   * Populated during wall pass, consumed during sprite pass.
   */
  zBuffer: [],

  // ─── Init ───────────────────────────────────────────────────────────────────

  init(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.zBuffer = new Array(canvas.width).fill(Infinity);

    // Pre-parse wall colours to avoid repeated hex parsing in the hot loop.
    this._rgbCache = {};
    for (const [type, pair] of Object.entries(MAP.WALL_COLORS)) {
      this._rgbCache[pair.ns] = this._parseHex(pair.ns);
      this._rgbCache[pair.ew] = this._parseHex(pair.ew);
    }
  },

  // ─── Main render call ───────────────────────────────────────────────────────

  /**
   * Render one complete frame.
   * @param {Array} sprites  Array of { x, y, type } world-space sprite objects.
   */
  render(sprites) {
    const { ctx, canvas } = this;
    const W     = canvas.width;
    const H     = canvas.height;
    const halfH = H >> 1;

    // ── 1. Ceiling and floor ──────────────────────────────────────────────
    ctx.fillStyle = '#1e1e2e';   // dark blue-grey ceiling
    ctx.fillRect(0, 0, W, halfH);
    ctx.fillStyle = '#3a3228';   // warm dark-brown floor
    ctx.fillRect(0, halfH, W, halfH);

    // ── 2. Wall pass ──────────────────────────────────────────────────────
    // Projection-plane distance: the virtual "screen" sits projDist pixels
    // in front of the player. Derived from FOV so that a wall one cell away
    // fills the screen height exactly when CELL_SIZE == canvas height.
    const halfFOV  = this.FOV / 2;
    const projDist = (W / 2) / Math.tan(halfFOV);

    for (let col = 0; col < W; col++) {
      // Ray angle: linearly distributed across the FOV
      const rayAngle = PLAYER.angle - halfFOV + (col / W) * this.FOV;
      const hit      = this._castRay(rayAngle);

      // Store perpendicular distance for sprite occlusion
      this.zBuffer[col] = hit.perpDist;

      // Projected wall-strip height (pixels)
      const wallH  = Math.floor(projDist * MAP.CELL_SIZE / hit.perpDist);
      const wallY0 = Math.floor(halfH - wallH / 2);

      // Pick colour: N/S-facing wall or E/W-facing wall (side==1 is N/S)
      const colors   = MAP.WALL_COLORS[hit.wallType] || MAP.WALL_COLORS[1];
      const colorKey = hit.side === 1 ? colors.ns : colors.ew;

      // Distance-based brightness (1.0 = closest, ~0.1 = far/dark)
      const shade = Math.max(0.1, 1 - hit.perpDist / this.MAX_SHADE_DIST);

      ctx.fillStyle = this._shadedColor(colorKey, shade);
      ctx.fillRect(col, wallY0, 1, wallH);
    }

    // ── 3. Sprite pass ────────────────────────────────────────────────────
    if (sprites && sprites.length > 0) {
      this._renderSprites(sprites, projDist, halfFOV);
    }
  },

  // ─── DDA raycasting ─────────────────────────────────────────────────────────

  /**
   * Cast a single ray at `angle` and return the first wall hit.
   *
   * Uses the DDA (Digital Differential Analyser) algorithm:
   *   • Decompose the ray into X-boundary and Y-boundary step lengths.
   *   • Always advance the shorter accumulated distance (grid march).
   *   • Record which axis was crossed last → determines wall face (N/S vs E/W).
   *
   * @returns {{ perpDist: number, wallType: number, side: number }}
   *   perpDist  – fish-eye-corrected distance to the wall face
   *   wallType  – cell value at the hit cell (1, 2, 3 …)
   *   side      – 0 = E/W face (X boundary crossed last)
   *               1 = N/S face (Y boundary crossed last)
   */
  _castRay(angle) {
    const CS  = MAP.CELL_SIZE;
    const rdx = Math.cos(angle);
    const rdy = Math.sin(angle);

    // Cell the player currently occupies
    let mapX = Math.floor(PLAYER.x / CS);
    let mapY = Math.floor(PLAYER.y / CS);

    // How far along the ray to cross exactly one cell in each axis
    // (uses the unit-vector trick: |ray| / |rdx| or |rdy|)
    const deltaX = Math.abs(1 / (rdx || 1e-10));
    const deltaY = Math.abs(1 / (rdy || 1e-10));

    // Initial side distances + step directions
    let stepX, stepY, sideDistX, sideDistY;

    if (rdx < 0) {
      stepX     = -1;
      sideDistX = (PLAYER.x / CS - mapX) * deltaX;
    } else {
      stepX     = +1;
      sideDistX = (mapX + 1 - PLAYER.x / CS) * deltaX;
    }
    if (rdy < 0) {
      stepY     = -1;
      sideDistY = (PLAYER.y / CS - mapY) * deltaY;
    } else {
      stepY     = +1;
      sideDistY = (mapY + 1 - PLAYER.y / CS) * deltaY;
    }

    // March through the grid until a non-empty cell is found
    let side     = 0;  // last axis crossed
    let wallType = 0;

    for (let i = 0; i < 128; i++) {
      // Advance to the nearer boundary
      if (sideDistX < sideDistY) {
        sideDistX += deltaX;
        mapX      += stepX;
        side       = 0;
      } else {
        sideDistY += deltaY;
        mapY      += stepY;
        side       = 1;
      }

      wallType = MAP.getCell(mapX, mapY);
      if (wallType !== 0) break;
    }

    // Perpendicular distance to the wall face (avoids fish-eye distortion).
    // Formula derived from the DDA step count at the moment of the hit.
    let perpDist;
    if (side === 0) {
      perpDist = (mapX - PLAYER.x / CS + (1 - stepX) / 2) / rdx * CS;
    } else {
      perpDist = (mapY - PLAYER.y / CS + (1 - stepY) / 2) / rdy * CS;
    }

    return { perpDist: Math.abs(perpDist), wallType, side };
  },

  // ─── Sprite rendering ───────────────────────────────────────────────────────

  /**
   * Project and draw all sprites, sorted farthest-first (painter's algorithm).
   * Each sprite is drawn column-by-column; a column is skipped if the zBuffer
   * shows a wall is closer.
   */
  _renderSprites(sprites, projDist, halfFOV) {
    const { ctx, canvas, zBuffer } = this;
    const W     = canvas.width;
    const H     = canvas.height;
    const halfW = W / 2;
    const halfH = H / 2;

    // Compute Euclidean distance to each sprite, then sort farthest-first
    const sorted = sprites
      .map(s => {
        const dx = s.x - PLAYER.x;
        const dy = s.y - PLAYER.y;
        return { ...s, dist: Math.sqrt(dx * dx + dy * dy) };
      })
      .sort((a, b) => b.dist - a.dist);

    for (const sprite of sorted) {
      if (sprite.dist < 8) continue;  // too close — skip (avoids singularity)

      // Angle from player to sprite, relative to player's facing direction
      const worldAngle = Math.atan2(
        sprite.y - PLAYER.y,
        sprite.x - PLAYER.x
      );
      let relAngle = worldAngle - PLAYER.angle;

      // Normalise to (–π, π]
      while (relAngle >  Math.PI) relAngle -= Math.PI * 2;
      while (relAngle < -Math.PI) relAngle += Math.PI * 2;

      // Cull sprites clearly outside the FOV (plus a small margin for sprites
      // that straddle the edge)
      if (Math.abs(relAngle) > halfFOV + 0.4) continue;

      // Project to screen: tan maps the angle to a linear screen offset
      const screenCX = Math.floor(halfW + Math.tan(relAngle) * projDist);

      // Sprite screen size — same scale factor as walls
      const spriteH = Math.floor(projDist * MAP.CELL_SIZE / sprite.dist);
      const spriteW = spriteH;   // square sprites

      const drawY0 = Math.floor(halfH - spriteH / 2);
      const drawX0 = Math.floor(screenCX - spriteW / 2);

      // Distance-based shading (match the wall shading feel)
      const shade = Math.max(0.15, 1 - sprite.dist / this.MAX_SHADE_DIST);

      // Draw one vertical strip per sprite column
      for (let col = 0; col < spriteW; col++) {
        const screenCol = drawX0 + col;
        if (screenCol < 0 || screenCol >= W) continue;

        // Skip if a wall is closer than this sprite in this column
        if (sprite.dist >= zBuffer[screenCol]) continue;

        // Sample the sprite's procedural texture at normalised x position
        const tx    = col / (spriteW - 1);
        const color = this._spriteSample(sprite.type, tx);
        if (!color) continue;   // transparent column

        // Apply distance shade
        ctx.fillStyle = this._shadedColor(color, shade);
        ctx.fillRect(screenCol, drawY0, 1, spriteH);
      }
    }
  },

  /**
   * Procedural sprite texture — returns a CSS colour string or null (transparent).
   * `tx` runs 0 → 1 from the left edge to the right edge of the sprite.
   *
   * Each sprite is defined as a simple silhouette with colour variation across
   * its width.  All visual detail is purely horizontal; vertical shaping is not
   * possible in a pure column-draw renderer without per-pixel row iteration.
   */
  _spriteSample(type, tx) {
    // Helper: a smooth "blob" profile that is 1 at the centre, 0 at the edges.
    // Used to create a rounded silhouette feel.
    const blob = (lo, hi) => tx >= lo && tx <= hi;

    switch (type) {
      case 'demon': {
        if (!blob(0.18, 0.82)) return null;          // outer transparent border
        const inner = (tx - 0.18) / 0.64;            // 0..1 within body
        const mid   = Math.abs(inner - 0.5) * 2;     // 0 at center, 1 at edges
        const r = Math.floor(200 - mid * 80);
        return `rgb(${r},0,0)`;
      }
      case 'imp': {
        if (!blob(0.20, 0.80)) return null;
        const inner = (tx - 0.20) / 0.60;
        const mid   = Math.abs(inner - 0.5) * 2;
        const r = Math.floor(180 - mid * 60);
        const g = Math.floor(90  - mid * 30);
        return `rgb(${r},${g},0)`;
      }
      case 'barrel': {
        if (!blob(0.15, 0.85)) return null;
        const inner = (tx - 0.15) / 0.70;
        const mid   = Math.abs(inner - 0.5) * 2;
        // Barrel bands (horizontal stripes would require row sampling — fake
        // it with slight lightness variation across the width instead)
        const v = Math.floor(90 - mid * 40);
        return `rgb(${v},${v},${v})`;
      }
      default:
        return blob(0.2, 0.8) ? '#FF00FF' : null;    // magenta fallback
    }
  },

  // ─── Minimap ────────────────────────────────────────────────────────────────

  /**
   * Draw a top-down minimap in the top-right corner of the canvas.
   * Wall cells are coloured by type; the player is a red dot with a direction
   * line.
   */
  renderMinimap() {
    const { ctx, canvas } = this;
    const SCALE   = 5;    // pixels per map cell on the minimap
    const PAD     = 10;
    const mapW    = MAP.width()  * SCALE;
    const mapH    = MAP.height() * SCALE;
    const originX = canvas.width - mapW - PAD;
    const originY = PAD;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(originX, originY, mapW, mapH);

    // Wall cells
    for (let row = 0; row < MAP.height(); row++) {
      for (let col = 0; col < MAP.width(); col++) {
        const cell = MAP.getCell(col, row);
        if (cell === 0) continue;
        ctx.fillStyle = (MAP.WALL_COLORS[cell] || MAP.WALL_COLORS[1]).ns;
        ctx.fillRect(
          originX + col * SCALE,
          originY + row * SCALE,
          SCALE - 1,
          SCALE - 1
        );
      }
    }

    // Player position on minimap
    const px = originX + (PLAYER.x / MAP.CELL_SIZE) * SCALE;
    const py = originY + (PLAYER.y / MAP.CELL_SIZE) * SCALE;

    // Direction line
    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(
      px + Math.cos(PLAYER.angle) * SCALE * 2.5,
      py + Math.sin(PLAYER.angle) * SCALE * 2.5
    );
    ctx.stroke();

    // Player dot
    ctx.fillStyle = '#ff4444';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
  },

  // ─── Colour helpers ─────────────────────────────────────────────────────────

  /**
   * Parse a 7-char hex colour string into [r, g, b].
   * Results are stored in _rgbCache to avoid repeated parsing.
   */
  _parseHex(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  },

  /**
   * Apply a [0,1] brightness factor to a hex colour, returning a CSS rgb()
   * string.  A look-up cache avoids re-parsing the same hex on every call.
   */
  _shadedColor(hex, factor) {
    if (!this._rgbCache[hex]) {
      this._rgbCache[hex] = this._parseHex(hex);
    }
    const [r, g, b] = this._rgbCache[hex];
    return `rgb(${Math.floor(r * factor)},${Math.floor(g * factor)},${Math.floor(b * factor)})`;
  },
};
