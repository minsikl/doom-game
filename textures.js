/**
 * textures.js — Procedural wall textures as RGBA Uint8ClampedArray buffers.
 *
 * All textures are generated once at script load time — no image files, no
 * async I/O, no dependencies.  Patterns are computed purely in code.
 *
 * Public API:
 *   TEXTURES.SIZE            — texture resolution (64 × 64 px)
 *   TEXTURES.getBuffer(type) — raw Uint8ClampedArray for a wall type number
 *
 * Buffer layout: row-major RGBA, SIZE × SIZE pixels (4 bytes per pixel).
 * Access pixel (tx, ty): index = (ty * SIZE + tx) * 4
 *
 * Load order: after map.js, before renderer.js
 */

const TEXTURES = (() => {

  /** Must match MAP.CELL_SIZE so one texture maps to exactly one wall cell. */
  const SIZE = 64;

  // ─── Internal helpers ────────────────────────────────────────────────────────

  /**
   * Deterministic, allocation-free per-pixel noise → float in [0, 1].
   * Uses a two-step integer multiply-xorshift hash.
   */
  function noise(x, y) {
    let h = Math.imul(x * 1_374_761 + y, 3_812_983);
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
    return ((h ^ (h >>> 16)) & 0xFF) / 255;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ─── Generator: Stone (wall type 1) ─────────────────────────────────────────
  /**
   * Regular grey stone blocks on a 16×16 px grid.
   * 2-pixel dark mortar lines divide the blocks.
   * Each block gets an independent brightness offset via a per-block hash.
   */
  function generateStone() {
    const buf    = new Uint8ClampedArray(SIZE * SIZE * 4);
    const BLOCK  = 16;
    const MORTAR = 2;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const lx = x % BLOCK;              // position within block cell
        const ly = y % BLOCK;
        const bx = x >> 4;                 // block column index
        const by = y >> 4;                 // block row index

        let r, g, b;

        if (lx < MORTAR || ly < MORTAR) {
          r = g = b = 36;                  // dark mortar joint
        } else {
          // Per-block brightness variation keeps adjacent blocks distinct
          const blockVar  = noise(bx, by) * 44 - 22;
          const microNoise = noise(x, y)  * 14 -  7;
          const v = clamp(116 + blockVar + microNoise, 72, 178);
          r = clamp(v,     72, 178);
          g = clamp(v - 2, 70, 176);
          b = clamp(v - 6, 66, 172);       // very slight blue cast
        }

        const i = (y * SIZE + x) * 4;
        buf[i] = r;  buf[i+1] = g;  buf[i+2] = b;  buf[i+3] = 255;
      }
    }
    return buf;
  }

  // ─── Generator: Brick (wall type 2) ─────────────────────────────────────────
  /**
   * Classic running-bond brickwork: 16×8 px brown bricks.
   * Odd rows are offset by half a brick (8 px) for a realistic bond.
   * 2-pixel light-grey mortar separates every brick.
   */
  function generateBrick() {
    const buf = new Uint8ClampedArray(SIZE * SIZE * 4);
    const BW  = 16;   // brick width  (px)
    const BH  =  8;   // brick height (px)
    const MW  =  2;   // mortar thickness (px)

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const row    = (y / BH) | 0;
        const offset = (row & 1) << 3;      // running bond: offset odd rows by BW/2
        const lx     = (x + offset) % BW;   // position within this brick cell
        const ly     =  y           % BH;

        let r, g, b;

        if (lx < MW || ly < MW) {
          r = g = b = 158;                   // light grey mortar
        } else {
          // Hash a unique ID per brick for per-brick colour variation
          const brickId  = ((x + offset) / BW | 0) * 31 + row * 17;
          const brickVar = noise(brickId, row) * 28 - 14;
          const micro    = noise(x, y)         * 10 -  5;
          r = clamp(158 + brickVar + micro,       100, 215);
          g = clamp( 80 + brickVar * 0.5 + micro,  48, 120);
          b = clamp( 28 + brickVar * 0.3 + micro,   8,  58);
        }

        const i = (y * SIZE + x) * 4;
        buf[i] = r;  buf[i+1] = g;  buf[i+2] = b;  buf[i+3] = 255;
      }
    }
    return buf;
  }

  // ─── Generator: Metal (wall type 3) ─────────────────────────────────────────
  /**
   * Blue-grey riveted metal panels, each 16 px tall.
   * Dark 2-pixel seams divide panels vertically.
   * Bright rivets appear at two fixed X positions near the top of each panel.
   * A sin-based horizontal gradient gives each panel a light-catch highlight.
   */
  function generateMetal() {
    const buf     = new Uint8ClampedArray(SIZE * SIZE * 4);
    const PANEL_H = 16;
    const SEAM    =  2;   // dark seam at the bottom of each panel

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const ly = y % PANEL_H;

        // Rivets: 2 × 2 bright spots at x = 4 and x = 28, rows 3–4 of panel
        const isRivet = (x === 4 || x === 28) && (ly === 3 || ly === 4);

        let r, g, b;

        if (ly < SEAM) {
          r = 28;  g = 36;  b = 46;          // dark panel seam
        } else if (isRivet) {
          r = 205; g = 215; b = 225;          // bright rivet highlight
        } else {
          // Horizontal light-catch gradient (sin curve) + per-pixel noise
          const grad  = Math.sin((x / SIZE) * Math.PI) * 16;
          const micro = noise(x, y) * 10 - 5;
          r = clamp( 94 + grad + micro,  50, 158);
          g = clamp(114 + grad + micro,  68, 175);
          b = clamp(148 + grad + micro, 100, 202);
        }

        const i = (y * SIZE + x) * 4;
        buf[i] = r;  buf[i+1] = g;  buf[i+2] = b;  buf[i+3] = 255;
      }
    }
    return buf;
  }

  // ─── Build lookup table at load time ────────────────────────────────────────

  const _buffers = {
    1: generateStone(),
    2: generateBrick(),
    3: generateMetal(),
  };

  // ─── Public API ─────────────────────────────────────────────────────────────

  return {
    SIZE,

    /**
     * Return the raw Uint8ClampedArray pixel buffer for `wallType`.
     * Falls back to stone (type 1) for unknown types.
     *
     * Typical inner-loop usage — get buffer once per column, index directly:
     *   const buf = TEXTURES.getBuffer(wallType);
     *   const i   = (ty * TEXTURES.SIZE + tx) * 4;
     *   const [r, g, b] = [buf[i], buf[i+1], buf[i+2]];
     */
    getBuffer(type) {
      return _buffers[type] || _buffers[1];
    },
  };

})();
