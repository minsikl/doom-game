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
   * Wall colours per type.
   * Two shades per type: N/S-facing walls (lighter) and E/W-facing walls
   * (darker) give a free depth cue without any lighting math.
   */
  WALL_COLORS: {
    1: { ns: '#808080', ew: '#555555' },  // stone
    2: { ns: '#8B4513', ew: '#5C2D0B' },  // brick
    3: { ns: '#4682B4', ew: '#2E5A82' },  // metal
  },

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
};
