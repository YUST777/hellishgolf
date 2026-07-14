import Phaser from 'phaser';
import {
  BALL_FRICTION,
  BALL_FRICTION_AIR,
  BALL_RADIUS,
  BALL_RESTITUTION,
  COLORS,
  DIRT_FRAME,
  GRAVITY_Y,
  MAX_DRAG,
  MAX_SPEED,
  POWER_EXP,
  REST_SPEED,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  TILE,
  ZOOM,
} from './config';
import type { RuntimeMap } from '../../shared/tiled';
import { roleOfGid, TILESET } from '../../shared/tiles';
import { sound } from './sound';

/**
 * Renders a real Kinda Hard Golf Tiled map using the mirrored tileset atlas and
 * runs drag-to-shoot golf physics with Matter. The ball starts at the derived
 * spawn (tee) and must reach the finish flag in as few strokes as possible;
 * water resets to the last checkpoint.
 *
 * Keys used from the Phaser cache:
 *   'tileset'  -> spritesheet, 16px frames (public/game/tilemap/tileset.png)
 *   'ball'     -> generated white circle texture
 */
export class GameScene extends Phaser.Scene {
  private map!: RuntimeMap;
  private worldW = 0;
  private worldH = 0;

  private ball!: Phaser.Physics.Matter.Image;
  private ballBody!: MatterJS.BodyType;

  private aiming = false;
  private aimGfx!: Phaser.GameObjects.Graphics;

  /** Current camera zoom; adjustable via wheel, pinch, or the +/- buttons. */
  private zoom = ZOOM;
  /** Active pointers, tracked so we can detect a two-finger pinch. */
  private pinchPrevDist = 0;

  private strokes = 0;
  private startTime = 0;
  private finished = false;

  private respawn = new Phaser.Math.Vector2();
  private lastCheckpointKey = '';

  private waterBodies: MatterJS.BodyType[] = [];
  private roughBodies: MatterJS.BodyType[] = [];
  private finishZone!: Phaser.Geom.Rectangle;

  /** Guards so we don't spam bounce/rough SFX every physics step. */
  private lastBounceAt = 0;
  private inRough = false;

  private onStroke?: (n: number) => void;
  private onFinish?: (n: number, t: number) => void;
  private onCheckpoint?: () => void;

  constructor() {
    super('game');
  }

  init(data: {
    map: RuntimeMap;
    onStroke?: (n: number) => void;
    onFinish?: (n: number, t: number) => void;
    onCheckpoint?: () => void;
  }) {
    this.map = data.map;
    this.onStroke = data.onStroke;
    this.onFinish = data.onFinish;
    this.onCheckpoint = data.onCheckpoint;
    this.strokes = 0;
    this.finished = false;
    this.lastCheckpointKey = '';
    this.waterBodies = [];
    this.roughBodies = [];
  }

  create() {
    this.worldW = this.map.cols * TILE;
    this.worldH = this.map.rows * TILE;

    // Padding around the play field. The backdrop (sky + dirt) and the camera
    // bounds share this rect so that zooming out reveals sky/dirt rather than
    // the camera's flat background "air". Scales with map size.
    const padX = this.worldW + 2000;
    const padY = this.worldH + 2000;

    this.matter.world.setBounds(0, 0, this.worldW, this.worldH, 128);
    // Camera may roam across the full padded backdrop (NOT clamped to the map),
    // so the dirt below/around the hole is actually visible when zoomed out.
    this.cameras.main.setBounds(
      -padX,
      -padY,
      this.worldW + padX * 2,
      this.worldH + padY * 2
    );
    this.zoom = ZOOM;
    this.cameras.main.setZoom(this.zoom);
    this.cameras.main.setBackgroundColor(COLORS.skyTop);
    this.cameras.main.setRoundPixels(true);
    this.matter.world.setGravity(0, GRAVITY_Y);

    this.drawSky();
    this.renderTiles();
    this.buildColliders();
    this.createBall();

    this.aimGfx = this.add.graphics().setDepth(50);
    this.setupInput();
    this.setupZoom();

    // Sound is mirrored from the real game. Browsers block audio until a user
    // gesture, so we init the pools now and start ambient birdsong on the first
    // pointer interaction (handled in setupInput).
    sound.init();

    this.startTime = this.time.now;
    this.cameras.main.startFollow(this.ball, false, 0.1, 0.1);
  }

  // --- zoom ---------------------------------------------------------------

  /** Wheel + pinch zoom. The HUD +/- buttons call setZoom via the scene events. */
  private setupZoom() {
    // Mouse wheel / trackpad.
    this.input.on(
      'wheel',
      (
        _p: Phaser.Input.Pointer,
        _over: unknown,
        _dx: number,
        dy: number
      ) => {
        this.zoomBy(dy > 0 ? -ZOOM_STEP : ZOOM_STEP);
      }
    );

    // Two-finger pinch on touch devices.
    this.input.on('pointermove', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchPrevDist > 0) {
          const delta = (dist - this.pinchPrevDist) * 0.005;
          this.zoomBy(delta);
        }
        this.pinchPrevDist = dist;
        // While pinching, don't treat it as an aim drag.
        this.aiming = false;
        this.aimGfx.clear();
      } else {
        this.pinchPrevDist = 0;
      }
    });

    // Allow the surrounding page/UI to command a zoom step or absolute value.
    this.game.events.on('zoom-in', () => this.zoomBy(ZOOM_STEP));
    this.game.events.on('zoom-out', () => this.zoomBy(-ZOOM_STEP));
    this.game.events.on('zoom-set', (z: number) => this.setZoom(z));
  }

  private zoomBy(delta: number) {
    this.setZoom(this.zoom + delta);
  }

  private setZoom(z: number) {
    this.zoom = Phaser.Math.Clamp(z, ZOOM_MIN, ZOOM_MAX);
    this.cameras.main.zoomTo(this.zoom, 120);
    this.game.events.emit('zoom-changed', this.zoom);
  }

  // --- rendering ----------------------------------------------------------

  /** Cell center in world pixels. Tiled rows count from the top (row 0 = top). */
  private cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  /**
   * World-space backdrop. Drawn in WORLD coordinates (not screen-locked) so it
   * scrolls with the map and, crucially, extends far past every edge — when you
   * zoom out you see sky above and dirt around/below the hole instead of the
   * camera's flat background "air".
   */
  private drawSky() {
    // Margin large enough that the fully zoomed-out view never runs off it.
    const marginX = this.worldW + 2000;
    const marginY = this.worldH + 2000;
    const left = -marginX;
    const top = -marginY;
    const totalW = this.worldW + marginX * 2;
    const totalH = this.worldH + marginY * 2;

    // OUTSIDE the map = dirt. INSIDE the map = blue sky.
    //
    // 1) Solid dirt-coloured fill across the ENTIRE backdrop (safety net so no
    //    blue ever leaks past the textured layer).
    this.add
      .rectangle(left, top, totalW, totalH, COLORS.dirt)
      .setOrigin(0, 0)
      .setDepth(-14);

    // 2) Real dirt block texture tiled over everything.
    if (this.ensureDirtTexture()) {
      this.add
        .tileSprite(left, top, totalW, totalH, 'dirt')
        .setOrigin(0, 0)
        .setDepth(-13);
    }

    // 3) Blue sky filling ONLY the map's own rectangle, drawn on top of the
    //    dirt. This is the in-level background the ball plays against; the dirt
    //    remains visible everywhere outside the map bounds.
    const g = this.add.graphics().setDepth(-12);
    const steps = 40;
    for (let i = 0; i < steps; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(COLORS.skyTop),
        Phaser.Display.Color.ValueToColor(COLORS.skyBottom),
        steps - 1,
        i
      );
      g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b), 1);
      // Clamp each band so the sky NEVER draws past the map's bottom edge. The
      // previous "+1" overshot worldH by 1px, drawing a thin blue line on top
      // of the dirt right at the bottom seam. Compute an exact band bottom and
      // derive the height from it so the last band lands precisely on worldH.
      const yTop = Math.floor((this.worldH * i) / steps);
      const yBottom = Math.ceil((this.worldH * (i + 1)) / steps);
      g.fillRect(0, yTop, this.worldW, yBottom - yTop);
    }
  }

  /**
   * Bake the dirt block frame into its own standalone 16x16 'dirt' texture by
   * copying that frame's pixels out of the tileset atlas into a canvas texture.
   * This is the reliable cross-renderer way to get a single atlas frame into a
   * texture that a TileSprite can repeat. Returns true if the texture is ready.
   */
  private ensureDirtTexture(): boolean {
    if (this.textures.exists('dirt')) return true;
    if (!this.textures.exists('tileset')) return false;

    const tex = this.textures.get('tileset');
    const frame = tex.get(DIRT_FRAME);
    const source = tex.getSourceImage() as CanvasImageSource;
    if (!frame || !source) return false;

    const canvasTex = this.textures.createCanvas('dirt', TILE, TILE);
    if (!canvasTex) return false;
    const ctx = canvasTex.getContext();
    ctx.imageSmoothingEnabled = false;
    // Copy just the dirt frame's rectangle out of the atlas.
    ctx.drawImage(
      source,
      frame.cutX,
      frame.cutY,
      TILE,
      TILE,
      0,
      0,
      TILE,
      TILE
    );
    canvasTex.refresh();
    return this.textures.exists('dirt');
  }

  /** Paint every non-empty tile from the real tileset atlas. */
  private renderTiles() {
    const { cols, rows, gids } = this.map;
    const frameCount = TILESET.columns * TILESET.rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const frame = gid - 1; // firstgid = 1
        if (frame < 0 || frame >= frameCount) continue;
        const { x, y } = this.cellCenter(col, row);
        // Draw each tile a hair larger than its cell so neighbouring tiles
        // overlap by ~1px. At fractional zoom this closes the thin seams that
        // otherwise shimmer between adjacent grass/ground tiles as the camera
        // moves. Nearest-neighbour sampling (pixelArt) keeps it crisp.
        this.add
          .image(x, y, 'tileset', frame)
          .setDisplaySize(TILE + 1, TILE + 1)
          .setDepth(5);
      }
    }
  }

  /** Build physics colliders + sensors from tile roles. */
  private buildColliders() {
    const { cols, rows, gids } = this.map;

    // --- solid colliders via greedy meshing --------------------------------
    // A ball rolling over a row of separate 16px box colliders catches on the
    // seam between each box (Matter has no "ghost vertices" smoothing). To fix
    // this we merge horizontally-adjacent solid tiles in each row into a single
    // wide rectangle, then merge identical vertical stacks. The result is a few
    // big, seamless colliders instead of thousands of tiny ones — the ball
    // rolls smoothly and there are far fewer bodies to simulate.
    const isSolidRole = (r: string) =>
      r === 'ground' ||
      r === 'ice' ||
      r === 'ramp-up' ||
      r === 'ramp-down' ||
      r === 'finish' ||
      r === 'checkpoint';

    // solidKind[row*cols+col] = '' (none) | 'ice' | 'solid'
    const solidKind: string[] = new Array(cols * rows).fill('');
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const role = roleOfGid(gid);
        if (isSolidRole(role)) {
          solidKind[row * cols + col] = role === 'ice' ? 'ice' : 'solid';
        }
      }
    }

    // Greedy-merge into rectangles. Standard 2D greedy meshing: for each
    // unused solid cell, extend right as far as the same kind runs, then extend
    // that whole strip downward while every row below matches.
    const used: boolean[] = new Array(cols * rows).fill(false);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const kind = solidKind[idx];
        if (!kind || used[idx]) continue;

        // Extend right.
        let w = 1;
        while (
          col + w < cols &&
          solidKind[row * cols + col + w] === kind &&
          !used[row * cols + col + w]
        ) {
          w++;
        }

        // Extend down while the full width matches.
        let h = 1;
        outer: while (row + h < rows) {
          for (let k = 0; k < w; k++) {
            const j = (row + h) * cols + col + k;
            if (solidKind[j] !== kind || used[j]) break outer;
          }
          h++;
        }

        // Mark the rectangle used.
        for (let r = 0; r < h; r++) {
          for (let k = 0; k < w; k++) {
            used[(row + r) * cols + col + k] = true;
          }
        }

        const isIce = kind === 'ice';
        const cx = col * TILE + (w * TILE) / 2;
        const cy = row * TILE + (h * TILE) / 2;
        this.matter.add.rectangle(cx, cy, w * TILE, h * TILE, {
          isStatic: true,
          friction: isIce ? 0.005 : 0.4,
          frictionStatic: isIce ? 0.005 : 0.5,
          restitution: 0.12,
          chamfer: { radius: 0 },
          label: isIce ? 'ice' : 'ground',
        });
      }
    }

    // --- sensors (water, rough, checkpoints) kept per-tile -----------------
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const role = roleOfGid(gid);
        const { x, y } = this.cellCenter(col, row);

        if (role === 'checkpoint') {
          const s = this.matter.add.rectangle(x, y - TILE, TILE, TILE, {
            isStatic: true,
            isSensor: true,
            label: 'checkpoint-sensor',
          });
          (s as unknown as { cell: { col: number; row: number } }).cell = {
            col,
            row,
          };
        } else if (role === 'water') {
          const b = this.matter.add.rectangle(x, y, TILE, TILE, {
            isStatic: true,
            isSensor: true,
            label: 'water',
          });
          this.waterBodies.push(b);
        } else if (role === 'rough') {
          const b = this.matter.add.rectangle(x, y, TILE, TILE, {
            isStatic: true,
            isSensor: true,
            label: 'rough',
          });
          this.roughBodies.push(b);
        }
      }
    }

    // Finish detection zone around the finish cell.
    const f = this.cellCenter(this.map.finish.col, this.map.finish.row);
    this.finishZone = new Phaser.Geom.Rectangle(
      f.x - TILE,
      f.y - TILE * 1.5,
      TILE * 2,
      TILE * 2.5
    );

    // Spawn / respawn.
    const sp = this.cellCenter(this.map.spawn.col, this.map.spawn.row);
    this.respawn.set(sp.x, sp.y - TILE * 0.5);

    this.setupCollisions();
  }

  private createBall() {
    if (!this.textures.exists('ball')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
      g.lineStyle(1.5, 0xcbd5e1, 1);
      g.strokeCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
      g.generateTexture('ball', BALL_RADIUS * 2, BALL_RADIUS * 2);
      g.destroy();
    }

    this.ball = this.matter.add.image(
      this.respawn.x,
      this.respawn.y,
      'ball'
    );
    this.ball.setCircle(BALL_RADIUS);
    // Real Kinda Hard Golf ball feel from the bundle: very bouncy
    // (restitution 0.86), low surface friction, and noticeable air drag so the
    // ball settles instead of rolling forever.
    this.ball.setBounce(BALL_RESTITUTION);
    this.ball.setFriction(BALL_FRICTION, 0.01, 0);
    this.ball.setFrictionAir(BALL_FRICTION_AIR);
    this.ball.setDensity(0.02);
    this.ball.setDepth(40);
    this.ballBody = this.ball.body as MatterJS.BodyType;
    this.ballBody.label = 'ball';
  }

  // --- input --------------------------------------------------------------

  private ballResting(): boolean {
    const v = this.ballBody.velocity;
    return Math.hypot(v.x, v.y) < REST_SPEED;
  }

  private setupInput() {
    this.input.on('pointerdown', () => {
      // Kick off ambient birdsong on the first user gesture (browser policy).
      sound.startAmbient();
      if (this.finished || !this.ballResting()) return;
      this.aiming = true;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.aiming) this.drawAim(p);
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.aiming) return;
      this.aiming = false;
      this.aimGfx.clear();
      this.shoot(p);
    });
  }

  /**
   * Slingshot aim, computed entirely in WORLD space and anchored at the ball.
   * You pull away from the ball; it launches in the opposite direction (like
   * Angry Birds / a putter). Because it is always measured ball -> pointer, the
   * direction is consistent no matter where on screen you press, and the camera
   * zoom/follow can't flip it. Returns a WORLD-space vector pointing the way the
   * ball will travel, clamped to MAX_DRAG.
   */
  private dragVector(p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    // Pull vector: from pointer back to the ball. Launch travels this way.
    const v = new Phaser.Math.Vector2(
      this.ball.x - world.x,
      this.ball.y - world.y
    );
    if (v.length() > MAX_DRAG) v.setLength(MAX_DRAG);
    return v;
  }

  private drawAim(p: Phaser.Input.Pointer) {
    const v = this.dragVector(p);
    const power = v.length() / MAX_DRAG;
    this.aimGfx.clear();
    const dir = v.clone().normalize();
    const bx = this.ball.x;
    const by = this.ball.y;
    const len = 12 + power * 44;

    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(COLORS.aim),
      Phaser.Display.Color.ValueToColor(COLORS.aimPower),
      100,
      Math.round(power * 100)
    );
    const col = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    this.aimGfx.fillStyle(col, 0.9);
    const dots = 6;
    for (let i = 1; i <= dots; i++) {
      const t = (i / dots) * len;
      this.aimGfx.fillCircle(bx + dir.x * t, by + dir.y * t, 1.6);
    }
    this.aimGfx.lineStyle(1.5, col, 0.8);
    this.aimGfx.strokeCircle(bx, by, BALL_RADIUS + 3 + power * 4);
  }

  private shoot(p: Phaser.Input.Pointer) {
    const v = this.dragVector(p);
    // Ignore tiny taps (in world units).
    if (v.length() < 2) return;
    this.strokes += 1;
    this.onStroke?.(this.strokes);
    // Power curve mirrors the real game: pow(power, 1.2) so short pulls are
    // gentle and long pulls ramp up hard. Result is clamped to MAX_SPEED so the
    // ball can never tunnel a wall.
    const raw = Math.min(1, v.length() / MAX_DRAG);
    const power = Math.pow(raw, POWER_EXP);
    const dir = v.clone().normalize();
    const speed = power * MAX_SPEED;
    this.ball.setVelocity(dir.x * speed, dir.y * speed);
    // Ball-hit thwack, louder on harder shots (real game: BallHit @ 0.3*power).
    sound.play('BallHit', 0.3 + 0.5 * power);
  }

  // --- collisions ---------------------------------------------------------

  private setupCollisions() {
    this.matter.world.on(
      'collisionstart',
      (_e: unknown, a: MatterJS.BodyType, b: MatterJS.BodyType) => {
        const other = this.otherOf('ball', a, b);
        if (!other) return;
        if (other.label === 'water') {
          this.hitWater();
        } else if (other.label === 'checkpoint-sensor') {
          this.hitCheckpoint(other);
        } else if (other.label === 'ground' || other.label === 'ice') {
          // Wood-tap bounce, volume scaled by impact speed (real game:
          // BallBounce @ 0.9*speed). Only audible above a small threshold so
          // resting/rolling contacts stay quiet.
          const speed = Math.hypot(
            this.ballBody.velocity.x,
            this.ballBody.velocity.y
          );
          if (speed > 1.5 && this.time.now - this.lastBounceAt > 60) {
            this.lastBounceAt = this.time.now;
            sound.play('BallBounce', Math.min(0.9, 0.15 + speed * 0.06));
          }
        }
      }
    );
  }

  private otherOf(
    label: string,
    a: MatterJS.BodyType,
    b: MatterJS.BodyType
  ): MatterJS.BodyType | null {
    if (a.label === label) return b;
    if (b.label === label) return a;
    return null;
  }

  private hitWater() {
    if (this.finished) return;
    sound.play('Splash', 0.2);
    this.cameras.main.flash(180, 31, 121, 205);
    this.resetToRespawn();
  }

  private hitCheckpoint(body: MatterJS.BodyType) {
    const cell = (body as unknown as { cell?: { col: number; row: number } })
      .cell;
    if (!cell) return;
    const key = `${cell.col},${cell.row}`;
    if (this.lastCheckpointKey === key) return;
    this.lastCheckpointKey = key;
    const c = this.cellCenter(cell.col, cell.row);
    this.respawn.set(c.x, c.y - TILE);
    this.onCheckpoint?.();
    sound.play('Chime', 0.35);
    this.cameras.main.flash(140, 253, 223, 106);
  }

  private resetToRespawn() {
    this.ball.setVelocity(0, 0);
    this.ball.setAngularVelocity(0);
    this.ball.setPosition(this.respawn.x, this.respawn.y);
  }

  // --- loop ---------------------------------------------------------------

  /**
   * Cap the ball's speed so it can never travel more than a tile per physics
   * step. Matter.js has no continuous collision detection, so an uncapped fast
   * ball tunnels straight through the 16px walls. Clamping speed below
   * (tileSize * PHYSICS_HZ) guarantees the discrete solver sees every wall.
   */
  private clampBallSpeed() {
    const v = this.ballBody.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_SPEED) {
      const s = MAX_SPEED / speed;
      this.ball.setVelocity(v.x * s, v.y * s);
    }
  }

  update() {
    if (this.finished) return;

    this.clampBallSpeed();

    // Rough: damp velocity heavily while overlapping. Play a leaf rustle once
    // per entry (real game: Leaves @ 0.4) rather than every frame.
    let overRough = false;
    for (const r of this.roughBodies) {
      if (this.matter.overlap(this.ballBody, [r])) {
        overRough = true;
        this.ball.setVelocity(
          this.ballBody.velocity.x * 0.85,
          this.ballBody.velocity.y * 0.9
        );
        break;
      }
    }
    if (overRough && !this.inRough) {
      const speed = Math.hypot(this.ballBody.velocity.x, this.ballBody.velocity.y);
      if (speed > 1) sound.play('Leaves', 0.4);
    }
    this.inRough = overRough;

    if (this.ball.y > this.worldH + 200) this.resetToRespawn();

    if (
      Phaser.Geom.Rectangle.Contains(this.finishZone, this.ball.x, this.ball.y) &&
      this.ballResting()
    ) {
      this.finish();
    }
  }

  private finish() {
    this.finished = true;
    const timeMs = Math.round(this.time.now - this.startTime);
    this.ball.setVelocity(0, 0);
    this.cameras.main.flash(300, 253, 223, 106);
    sound.play('Claps', 0.6);
    this.onFinish?.(this.strokes, timeMs);
  }
}
