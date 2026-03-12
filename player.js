/**
 * player.js — Player state, input handling, movement, and collision.
 *
 * Coordinate convention (matches canvas):
 *   +X → East,  +Y → South
 *   angle = 0 faces East; angles increase clockwise.
 *
 * Depends on: map.js (MAP)
 */

const PLAYER = {

  // ─── State ──────────────────────────────────────────────────────────────────

  /** World-space position (pixels). Starts in cell (2,2), facing East. */
  x: 2.5 * MAP.CELL_SIZE,
  y: 2.5 * MAP.CELL_SIZE,

  /** Facing direction in radians. 0 = East, PI/2 = South. */
  angle: 0,

  // ─── Tuning constants ───────────────────────────────────────────────────────

  MOVE_SPEED:  150,    // world-units per second (forward / strafe)
  ROT_SPEED:   2.2,    // radians per second  (keyboard turning)
  MOUSE_SENS:  0.0025, // radians per pixel   (pointer-lock mouse)
  COLLISION_R: 10,     // keep this many pixels away from every wall

  // ─── Internal ───────────────────────────────────────────────────────────────

  /** Live keyboard state — updated by keydown / keyup listeners. */
  _keys: {},

  // ─── Init ───────────────────────────────────────────────────────────────────

  init() {
    // Keyboard
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
      // Stop the page from scrolling on arrow keys / space
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']
          .includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this._keys[e.code] = false;
    });

    // Click the canvas → request pointer-lock for mouse look
    document.getElementById('gameCanvas')
      .addEventListener('click', () => {
        document.getElementById('gameCanvas').requestPointerLock();
      });

    // Pointer-locked mouse movement → rotate player
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement ===
          document.getElementById('gameCanvas')) {
        this.angle += e.movementX * this.MOUSE_SENS;
      }
    });
  },

  // ─── Per-frame update ───────────────────────────────────────────────────────

  /**
   * Advance player state by `dt` seconds.
   * Collision is resolved axis-by-axis so the player slides along walls.
   */
  update(dt) {
    const k = this._keys;

    // ── Rotation (arrow keys) ──────────────────────────────────────────────
    if (k['ArrowLeft'])  this.angle -= this.ROT_SPEED * dt;
    if (k['ArrowRight']) this.angle += this.ROT_SPEED * dt;

    // ── Translation ────────────────────────────────────────────────────────
    const speed = this.MOVE_SPEED * dt;
    const cos   = Math.cos(this.angle);
    const sin   = Math.sin(this.angle);

    let dx = 0, dy = 0;

    // Forward / back (W / S  or  ↑ / ↓)
    if (k['KeyW'] || k['ArrowUp'])   { dx += cos * speed; dy += sin * speed; }
    if (k['KeyS'] || k['ArrowDown']) { dx -= cos * speed; dy -= sin * speed; }

    // Strafe (A = left, D = right) — perpendicular to facing direction
    // Left strafe:  rotate facing 90° counter-clockwise → (+sin, -cos)
    // Right strafe: rotate facing 90° clockwise         → (-sin, +cos)
    if (k['KeyA']) { dx += sin * speed; dy -= cos * speed; }
    if (k['KeyD']) { dx -= sin * speed; dy += cos * speed; }

    // ── Collision (separate X / Y passes for wall-sliding) ─────────────────
    const r = this.COLLISION_R;

    if (!MAP.isWall(this.x + dx + Math.sign(dx) * r, this.y))
      this.x += dx;

    if (!MAP.isWall(this.x, this.y + dy + Math.sign(dy) * r))
      this.y += dy;

    // Keep angle in [0, 2π]
    this.angle = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  },
};
