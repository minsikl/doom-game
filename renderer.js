/**
 * renderer.js — Raycasting engine, sprite projection, and minimap.
 *
 * Rendering pipeline each frame:
 *   1. Reset the ImageData pixel buffer to the pre-built ceiling/floor background.
 *   2. Wall pass — one DDA ray per screen column (_castRay).
 *      • Returns { perpDist, wallType, side, wallHitX }.
 *      • wallHitX (0–1) selects the texture column from TEXTURES.
 *      • Each pixel in the wall strip is written directly into the pixel buffer,
 *        with distance-based brightness applied per-channel.
 *      • Perpendicular distance stored in zBuffer[] for sprite occlusion.
 *   3. ctx.putImageData — flush the pixel buffer to the canvas in one call.
 *   4. Sprite pass — sorted back-to-front, column-by-column fillRect (on top).
 *   5. Minimap overlay.
 *
 * Depends on: map.js (MAP), player.js (PLAYER), textures.js (TEXTURES)
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

    // ── Pixel buffer (wall pass writes here; one putImageData per frame) ──────
    this._imageData = this.ctx.createImageData(canvas.width, canvas.height);

    // Pre-build a background buffer filled with ceiling and floor colours.
    // Each frame we memcpy this into _imageData before writing wall pixels,
    // which is faster than two fillRect calls + the canvas state overhead.
    const W     = canvas.width;
    const H     = canvas.height;
    const halfH = H >> 1;
    this._bgBuffer = new Uint8ClampedArray(W * H * 4);

    const CEIL_R = 0x1e, CEIL_G = 0x1e, CEIL_B = 0x2e;   // #1e1e2e
    const FLOOR_R = 0x3a, FLOOR_G = 0x32, FLOOR_B = 0x28; // #3a3228

    for (let y = 0; y < H; y++) {
      const isCeil = y < halfH;
      const r = isCeil ? CEIL_R  : FLOOR_R;
      const g = isCeil ? CEIL_G  : FLOOR_G;
      const b = isCeil ? CEIL_B  : FLOOR_B;
      const rowStart = y * W * 4;
      for (let x = 0; x < W; x++) {
        const i = rowStart + x * 4;
        this._bgBuffer[i] = r;  this._bgBuffer[i+1] = g;
        this._bgBuffer[i+2] = b; this._bgBuffer[i+3] = 255;
      }
    }

    // Colour cache for sprite rendering (sprites still use canvas fillRect).
    this._rgbCache = {};
  },

  // ─── Main render call ───────────────────────────────────────────────────────

  /**
   * Render one complete frame.
   * @param {Array} sprites  Array of { x, y, type } world-space sprite objects.
   */
  render(sprites) {
    const { ctx, canvas, _imageData } = this;
    const W     = canvas.width;
    const H     = canvas.height;
    const halfH = H >> 1;
    const buf   = _imageData.data;   // Uint8ClampedArray — write wall pixels here

    // ── Horizon shift ──────────────────────────────────────────────────────
    // When PLAYER.z differs from the resting eye height, the horizon (the
    // ceiling/floor boundary) shifts vertically so the camera appears to rise
    // or fall.  Formula: pitchOffset = elevation × projDist / CELL_SIZE.
    //   horizonY < halfH  → player is elevated (more floor visible below)
    //   horizonY > halfH  → player is lower than default (more ceiling)
    const halfFOV     = this.FOV / 2;
    const projDist    = (W / 2) / Math.tan(halfFOV);
    const DEFAULT_Z   = MAP.CELL_SIZE / 2;
    const pitchOffset = ((PLAYER.z - DEFAULT_Z) * projDist / MAP.CELL_SIZE) | 0;
    const horizonY    = halfH - pitchOffset;

    // ── 1. Reset pixel buffer to ceiling / floor background ───────────────
    // Fast path when the horizon is centred: TypedArray.set() is a memcpy.
    // When the player is elevated/lowered we fill the buffer directly,
    // splitting at horizonY instead of halfH.
    if (pitchOffset === 0) {
      buf.set(this._bgBuffer);
    } else {
      const CEIL_R  = 0x1e, CEIL_G  = 0x1e, CEIL_B  = 0x2e;
      const FLOOR_R = 0x3a, FLOOR_G = 0x32, FLOOR_B = 0x28;
      const split   = Math.max(0, Math.min(H, horizonY)) * W * 4;
      const total   = W * H * 4;
      for (let i = 0; i < split; ) {
        buf[i++] = CEIL_R;  buf[i++] = CEIL_G;  buf[i++] = CEIL_B;  buf[i++] = 255;
      }
      for (let i = split; i < total; ) {
        buf[i++] = FLOOR_R; buf[i++] = FLOOR_G; buf[i++] = FLOOR_B; buf[i++] = 255;
      }
    }

    // ── 2. Wall pass (per-pixel, writes directly into buf) ────────────────
    const TEX_SIZE = TEXTURES.SIZE;
    const TEX_MASK = TEX_SIZE - 1;   // TEX_SIZE is 64 (power of 2) → fast clamp

    for (let col = 0; col < W; col++) {
      const rayAngle = PLAYER.angle - halfFOV + (col / W) * this.FOV;
      const hit      = this._castRay(rayAngle);

      this.zBuffer[col] = hit.perpDist;

      // Projected wall-strip height and vertical screen bounds
      const wallH  = (projDist * MAP.CELL_SIZE / hit.perpDist) | 0;
      const wallY0 = ((horizonY - wallH / 2) | 0);  // centred on horizon
      const drawY0 = wallY0 < 0 ? 0 : wallY0;
      const drawY1 = wallY0 + wallH > H ? H : wallY0 + wallH;

      // Texture column: wallHitX (0–1) → integer texel x in [0, TEX_SIZE)
      const texX   = (hit.wallHitX * TEX_SIZE) & TEX_MASK;
      const texBuf = TEXTURES.getBuffer(hit.wallType);

      // Shade: distance darkens walls; E/W faces (side=0) are dimmer than
      // N/S faces (side=1) for a free depth cue (no ray-traced lighting).
      const distShade = Math.max(0.1, 1 - hit.perpDist / this.MAX_SHADE_DIST);
      const shade     = hit.side === 0 ? distShade * 0.7 : distShade;

      for (let y = drawY0; y < drawY1; y++) {
        // Map screen-y to texture-y
        const texY = (((y - wallY0) / wallH) * TEX_SIZE) & TEX_MASK;
        const ti   = (texY * TEX_SIZE + texX) * 4;   // index into texBuf

        const idx    = (y * W + col) * 4;             // index into pixel buf
        buf[idx]     = texBuf[ti]   * shade;
        buf[idx + 1] = texBuf[ti+1] * shade;
        buf[idx + 2] = texBuf[ti+2] * shade;
        buf[idx + 3] = 255;
      }
    }

    // ── 3. Flush pixel buffer to canvas (single call) ─────────────────────
    ctx.putImageData(_imageData, 0, 0);

    // ── 4. Sprite pass (canvas 2D fillRect, drawn on top of putImageData) ─
    if (sprites && sprites.length > 0) {
      this._renderSprites(sprites, projDist, halfFOV, horizonY);
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
   * @returns {{ perpDist, wallType, side, wallHitX }}
   *   perpDist  – fish-eye-corrected distance to the wall face (pixels)
   *   wallType  – cell value at the hit cell (1, 2, 3 …)
   *   side      – 0 = E/W face (X boundary crossed last)
   *               1 = N/S face (Y boundary crossed last)
   *   wallHitX  – fractional hit position along the wall face [0, 1)
   *               used to index the horizontal texture column
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
    perpDist = Math.abs(perpDist);

    // ── Texture hit position (wallHitX) ─────────────────────────────────
    // Compute where exactly along the wall face (0–1) the ray struck.
    // For a vertical wall (side=0) the varying axis is Y; vice-versa.
    // Formula (positions in cell units): hitCoord = playerCoord + perpDist * rayDir
    //
    // Flip correction: ensures texture orientation is consistent regardless
    // of which direction the ray travels (prevents mirrored textures).
    let wallHitX;
    if (side === 0) {
      wallHitX = (PLAYER.y / CS + (perpDist / CS) * rdy) % 1;
      if (rdx > 0) wallHitX = 1 - wallHitX;   // flip for rays going right
    } else {
      wallHitX = (PLAYER.x / CS + (perpDist / CS) * rdx) % 1;
      if (rdy < 0) wallHitX = 1 - wallHitX;   // flip for rays going up
    }
    if (wallHitX < 0) wallHitX += 1;           // guard against −0 modulo

    return { perpDist, wallType, side, wallHitX };
  },

  // ─── Sprite rendering ───────────────────────────────────────────────────────

  /**
   * Project and draw all sprites, sorted farthest-first (painter's algorithm).
   * Each sprite is drawn column-by-column; a column is skipped if the zBuffer
   * shows a wall is closer.
   */
  _renderSprites(sprites, projDist, halfFOV, horizonY) {
    const { ctx, canvas, zBuffer } = this;
    const W     = canvas.width;
    const H     = canvas.height;
    const halfW = W / 2;

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

      const drawY0 = Math.floor(horizonY - spriteH / 2);
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
