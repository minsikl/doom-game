/**
 * map.js — World map data and spatial query helpers.
 *
 * The map is a 2-D grid of integers:
 *   0 = empty space
 *   1 = stone wall  (grey)
 *   2 = brick wall  (brown)
 *   3 = metal wall  (blue-grey)
 *
 * World-space coordinates are in pixels; each cell is CELL_SIZE × CELL_SIZE.
 * The top-left corner of cell (col, row) is at world (col*CS, row*CS).
 */

const MAP = {

  // ─── Grid (24 × 24) ─────────────────────────────────────────────────────────
  grid: [
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,2,2,2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,2,0,3,3,3,3,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,3,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,3,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,2,0,2,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,2,0,2,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1,1,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
    [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  ],

  /** World units per grid cell */
  CELL_SIZE: 64,

  /**
   * Maximum height change the player can climb or descend in one step.
   * Equal to ¼ of a cell (16 px).  A step taller than this blocks movement.
   */
  STEP_HEIGHT: 16,

  /**
   * Wall colours per type.
   * Two shades per type: N/S-facing walls (lighter) and E/W-facing walls
   * (darker) give a free depth cue without any lighting math.
   */
  WALL_COLORS: {
    1: { ns: '#808080', ew: '#555555' },  // stone
    2: { ns: '#8B4513', ew: '#5C2D0B' },  // brick
    3: { ns: '#4682B4', ew: '#2E5A82' },  // metal
    4: { ns: '#C8A040', ew: '#8B6914' },  // stair face (sandy gold)
  },

  // ─── Height grid ────────────────────────────────────────────────────────────

  /**
   * Per-cell floor elevations, expressed as integer multiples of STEP_HEIGHT.
   * Most cells are 0 (ground level).  The staircase occupies rows 9–11 of
   * columns 6–10, rising and falling: [1, 2, 3, 3, 2] × STEP_HEIGHT px.
   */
  heightGrid: (() => {
    const g       = Array.from({ length: 24 }, () => new Array(24).fill(0));
    const COLS    = [6, 7, 8, 9, 10];
    const HEIGHTS = [1, 2, 3, 3,  2];
    for (const row of [9, 10, 11]) {
      for (let i = 0; i < COLS.length; i++) g[row][COLS[i]] = HEIGHTS[i];
    }
    return g;
  })(),

  // ─── Helpers ────────────────────────────────────────────────────────────────

  width()  { return this.grid[0].length; },
  height() { return this.grid.length;    },

  /**
   * Return the cell type at grid coordinates (cellX, cellY).
   * Coordinates outside the grid are treated as solid walls (type 1).
   */
  getCell(cellX, cellY) {
    if (cellX < 0 || cellX >= this.width() ||
        cellY < 0 || cellY >= this.height()) return 1;
    return this.grid[cellY][cellX];
  },

  /**
   * Return true if world-space point (wx, wy) lies inside a solid wall.
   */
  isWall(wx, wy) {
    return this.getCell(
      Math.floor(wx / this.CELL_SIZE),
      Math.floor(wy / this.CELL_SIZE)
    ) !== 0;
  },

  /**
   * Return the floor elevation (world pixels) at world-space point (wx, wy).
   * Out-of-bounds coordinates return 0 (ground level).
   */
  getFloorHeight(wx, wy) {
    const cx = Math.floor(wx / this.CELL_SIZE);
    const cy = Math.floor(wy / this.CELL_SIZE);
    if (cx < 0 || cx >= this.width() || cy < 0 || cy >= this.height()) return 0;
    return this.heightGrid[cy][cx] * this.STEP_HEIGHT;
  },

  /**
   * Return true if the player can step from (fromWX, fromWY) to (toWX, toWY).
   * Movement is blocked when the height difference exceeds one STEP_HEIGHT.
   */
  canStep(fromWX, fromWY, toWX, toWY) {
    return Math.abs(this.getFloorHeight(toWX,   toWY) -
                    this.getFloorHeight(fromWX, fromWY)) <= this.STEP_HEIGHT;
  },
};
