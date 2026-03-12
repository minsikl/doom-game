/**
 * game.js — Main game loop, initialisation, sprite list, and HUD.
 *
 * Load order: map.js → player.js → renderer.js → game.js
 *
 * GAME.init() is called on window 'load' (bottom of this file).
 * Each frame: update player → render walls + sprites + minimap → draw HUD.
 */

const GAME = {

  // ─── Static sprite list ─────────────────────────────────────────────────────
  // Each entry is a world-space { x, y, type } object.
  // Positions are expressed as (cellCol + 0.5) * CELL_SIZE so sprites sit in
  // the middle of their cell.

  sprites: [
    { x:  7.5 * MAP.CELL_SIZE, y:  5.5 * MAP.CELL_SIZE, type: 'demon'  },
    { x: 12.5 * MAP.CELL_SIZE, y: 12.5 * MAP.CELL_SIZE, type: 'demon'  },
    { x: 15.5 * MAP.CELL_SIZE, y: 15.5 * MAP.CELL_SIZE, type: 'imp'    },
    { x:  4.5 * MAP.CELL_SIZE, y: 15.5 * MAP.CELL_SIZE, type: 'barrel' },
    { x: 20.5 * MAP.CELL_SIZE, y: 10.5 * MAP.CELL_SIZE, type: 'imp'    },
    { x:  8.5 * MAP.CELL_SIZE, y: 20.5 * MAP.CELL_SIZE, type: 'demon'  },
  ],

  // ─── Internal state ─────────────────────────────────────────────────────────

  _lastTime:   0,
  _frameCount: 0,
  _fpsTimer:   0,

  /** Displayed FPS (updated once per second). */
  fps: 0,

  // ─── Init ───────────────────────────────────────────────────────────────────

  init() {
    const canvas      = document.getElementById('gameCanvas');
    canvas.width      = 800;
    canvas.height     = 600;

    PLAYER.init();
    RENDERER.init(canvas);

    // Show the instructions overlay; hide it while the pointer is locked
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'flex';

    document.addEventListener('pointerlockchange', () => {
      overlay.style.display =
        document.pointerLockElement === canvas ? 'none' : 'flex';
    });

    // Kick off the loop
    requestAnimationFrame(ts => this._loop(ts));
  },

  // ─── Main loop ──────────────────────────────────────────────────────────────

  _loop(timestamp) {
    // Delta time in seconds.  Cap at 50 ms to avoid physics explosions when
    // the tab is backgrounded and then re-focused.
    const dt = Math.min((timestamp - this._lastTime) / 1000, 0.05);
    this._lastTime = timestamp;

    // FPS counter — updated every second
    this._frameCount++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 1.0) {
      this.fps         = this._frameCount;
      this._frameCount = 0;
      this._fpsTimer  -= 1.0;
    }

    // ── Update ───────────────────────────────────────────────────────────
    PLAYER.update(dt);

    // ── Render ───────────────────────────────────────────────────────────
    RENDERER.render(this.sprites);   // walls + sprites
    RENDERER.renderMinimap();         // top-right corner
    this._drawHUD();                  // FPS + crosshair

    requestAnimationFrame(ts => this._loop(ts));
  },

  // ─── HUD ────────────────────────────────────────────────────────────────────

  _drawHUD() {
    const ctx = RENDERER.ctx;
    const W   = RENDERER.canvas.width;
    const H   = RENDERER.canvas.height;

    // ── FPS counter (top-left) ────────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(8, 8, 88, 22);
    ctx.fillStyle = '#00ff66';
    ctx.font      = 'bold 13px monospace';
    ctx.fillText(`FPS: ${this.fps}`, 13, 24);

    // ── Crosshair ─────────────────────────────────────────────────────────
    const cx = W / 2;
    const cy = H / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);  ctx.lineTo(cx + 10, cy);  // horizontal
    ctx.moveTo(cx, cy - 10);  ctx.lineTo(cx, cy + 10);  // vertical
    ctx.stroke();
  },
};

window.addEventListener('load', () => GAME.init());
