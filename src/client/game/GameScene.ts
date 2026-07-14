import Phaser from 'phaser';
import {
  BALL_ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  BALL_RADIUS,
  BALL_RADIUS_METERS,
  BALL_RESTITUTION,
  BALL_SLOW_DAMPING,
  COLORS,
  DEFAULT_ZOOM,
  DIRT_FRAME,
  GRAVITY_Y,
  MAX_DRAG,
  MAX_LAUNCH_SPEED,
  PHYSICS_TIMESTEP,
  PIXELS_PER_METER,
  POWER_EXP,
  REST_SPEED,
  SOURCE_TILE,
  TILE,
  ZOOM_LEVELS,
} from './config';
import type { RuntimeMap } from '../../shared/tiled';
import { roleOfGid, rampShapeOfId, cleanGid, TILESET } from '../../shared/tiles';
import { sound } from './sound';
import { RAPIER } from './physics';

/**
 * Renders a real Kinda Hard Golf Tiled map and runs the ball with the actual
 * Rapier physics engine, using the constants pulled from the game bundle:
 * gravity y=33, fixed 1/180 timestep, 50 px per metre, ball radius 0.3m,
 * restitution 0.86, friction 0.1, linear damping 0.4, angular damping 15, CCD.
 */
export class GameScene extends Phaser.Scene {
  private map!: RuntimeMap;
  private worldW = 0;
  private worldH = 0;

  private world!: import('@dimforge/rapier2d-compat').World;
  private eventQueue!: import('@dimforge/rapier2d-compat').EventQueue;
  private ballBody!: import('@dimforge/rapier2d-compat').RigidBody;
  private ballCollider!: import('@dimforge/rapier2d-compat').Collider;
  private accumulator = 0;

  private ball!: Phaser.GameObjects.Image;
  private aiming = false;
  private aimGfx!: Phaser.GameObjects.Graphics;

  private zoom = DEFAULT_ZOOM;
  private pinchPrevDist = 0;

  private strokes = 0;
  private startTime = 0;
  private finished = false;

  private respawn = new Phaser.Math.Vector2();
  private lastCheckpointKey = '';

  /** Sensor rects kept in world pixels for cheap per-frame overlap tests. */
  private waterRects: Phaser.Geom.Rectangle[] = [];
  private roughRects: Phaser.Geom.Rectangle[] = [];
  private checkpointCells: { rect: Phaser.Geom.Rectangle; col: number; row: number }[] =
    [];
  private finishZone!: Phaser.Geom.Rectangle;

  private lastBounceAt = 0;
  private inRough = false;
  private groundHandles = new Set<number>();

  private onStroke?: (n: number) => void;
  private onFinish?: (n: number, t: number) => void;
  private onCheckpoint?: () => void;

  constructor() {
    super('game');
  }

  init(data: {
    map: RuntimeMap;
    zoom?: number;
    onStroke?: (n: number) => void;
    onFinish?: (n: number, t: number) => void;
    onCheckpoint?: () => void;
  }) {
    this.map = data.map;
    this.zoom = data.zoom ?? DEFAULT_ZOOM;
    this.onStroke = data.onStroke;
    this.onFinish = data.onFinish;
    this.onCheckpoint = data.onCheckpoint;
    this.strokes = 0;
    this.finished = false;
    this.lastCheckpointKey = '';
    this.waterRects = [];
    this.roughRects = [];
    this.checkpointCells = [];
    this.accumulator = 0;
    this.groundHandles = new Set();
  }

  // --- unit helpers -------------------------------------------------------

  private pxToM(px: number): number {
    return px / PIXELS_PER_METER;
  }
  private cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  create() {
    this.worldW = this.map.cols * TILE;
    this.worldH = this.map.rows * TILE;

    const padX = this.worldW + 2000;
    const padY = this.worldH + 2000;
    this.cameras.main.setBounds(
      -padX,
      -padY,
      this.worldW + padX * 2,
      this.worldH + padY * 2
    );
    this.cameras.main.setZoom(this.zoom);
    this.cameras.main.setBackgroundColor(COLORS.skyTop);
    this.cameras.main.setRoundPixels(true);

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y });
    this.world.timestep = PHYSICS_TIMESTEP;
    this.eventQueue = new RAPIER.EventQueue(true);

    this.drawSky();
    this.renderTiles();
    this.buildColliders();
    this.createBall();

    this.aimGfx = this.add.graphics().setDepth(50);
    this.setupInput();
    this.setupZoom();
    this.setupMenuBridge();
    sound.init();

    this.startTime = this.time.now;
    this.cameras.main.startFollow(this.ball, false, 0.12, 0.12);
  }

  // --- zoom (discrete levels, matching the reference) ---------------------

  private setupZoom() {
    this.input.on(
      'wheel',
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        this.stepZoom(dy > 0 ? 1 : -1);
      }
    );
    this.input.on('pointermove', () => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchPrevDist > 0) {
          if (dist - this.pinchPrevDist > 40) this.stepZoom(-1);
          else if (this.pinchPrevDist - dist > 40) this.stepZoom(1);
        }
        this.pinchPrevDist = dist;
        this.aiming = false;
        this.aimGfx.clear();
      } else {
        this.pinchPrevDist = 0;
      }
    });
    this.game.events.on('zoom-in', () => this.stepZoom(-1));
    this.game.events.on('zoom-out', () => this.stepZoom(1));
    this.game.events.on('zoom-set', (z: number) => this.applyZoom(z));
  }

  /** Menu actions forwarded from the DOM shell. */
  private setupMenuBridge() {
    this.game.events.on('return-checkpoint', () => {
      if (this.finished) return;
      this.resetToRespawn();
      sound.play('Back', 0.5);
    });
    this.game.events.on('recenter', () => {
      this.cameras.main.startFollow(this.ball, false, 0.12, 0.12);
    });
  }

  /** dir = +1 zooms out (smaller value), -1 zooms in (larger value). */
  private stepZoom(dir: number) {
    const idx = ZOOM_LEVELS.indexOf(
      ZOOM_LEVELS.reduce((a, b) =>
        Math.abs(b - this.zoom) < Math.abs(a - this.zoom) ? b : a
      )
    );
    const next = Phaser.Math.Clamp(idx + dir, 0, ZOOM_LEVELS.length - 1);
    this.applyZoom(ZOOM_LEVELS[next]!);
  }

  private applyZoom(z: number) {
    this.zoom = z;
    this.cameras.main.zoomTo(z, 160);
    this.game.events.emit('zoom-changed', z);
  }

  // --- rendering ----------------------------------------------------------

  private drawSky() {
    const marginX = this.worldW + 2000;
    const marginY = this.worldH + 2000;
    const left = -marginX;
    const top = -marginY;
    const totalW = this.worldW + marginX * 2;
    const totalH = this.worldH + marginY * 2;

    this.add
      .rectangle(left, top, totalW, totalH, COLORS.dirt)
      .setOrigin(0, 0)
      .setDepth(-14);

    if (this.ensureDirtTexture()) {
      this.add
        .tileSprite(left, top, totalW, totalH, 'dirt')
        .setOrigin(0, 0)
        .setDepth(-13);
    }

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
      const yTop = Math.floor((this.worldH * i) / steps);
      const yBottom = Math.ceil((this.worldH * (i + 1)) / steps);
      g.fillRect(0, yTop, this.worldW, yBottom - yTop);
    }
  }

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
    ctx.drawImage(
      source,
      frame.cutX,
      frame.cutY,
      SOURCE_TILE,
      SOURCE_TILE,
      0,
      0,
      TILE,
      TILE
    );
    canvasTex.refresh();
    return this.textures.exists('dirt');
  }

  private renderTiles() {
    const { cols, rows, gids } = this.map;
    const frameCount = TILESET.columns * TILESET.rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const frame = gid - 1;
        if (frame < 0 || frame >= frameCount) continue;
        const { x, y } = this.cellCenter(col, row);
        this.add
          .image(x, y, 'tileset', frame)
          .setDisplaySize(TILE + 1, TILE + 1)
          .setDepth(5);
      }
    }
  }

  // --- physics geometry ---------------------------------------------------

  private buildColliders() {
    const { cols, rows, gids } = this.map;

    // Solid, non-ramp cells: greedy-mesh into big cuboids for smooth rolling.
    const solidKind: string[] = new Array(cols * rows).fill('');
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const id = cleanGid(gid) - 1;
        if (rampShapeOfId(id)) continue; // ramps handled as triangles below
        const role = roleOfGid(gid);
        const solid =
          role === 'ground' ||
          role === 'ice' ||
          role === 'finish' ||
          role === 'checkpoint';
        if (solid) solidKind[row * cols + col] = role === 'ice' ? 'ice' : 'solid';
      }
    }

    const used: boolean[] = new Array(cols * rows).fill(false);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const kind = solidKind[idx];
        if (!kind || used[idx]) continue;

        let w = 1;
        while (
          col + w < cols &&
          solidKind[row * cols + col + w] === kind &&
          !used[row * cols + col + w]
        )
          w++;

        let h = 1;
        outer: while (row + h < rows) {
          for (let k = 0; k < w; k++) {
            const j = (row + h) * cols + col + k;
            if (solidKind[j] !== kind || used[j]) break outer;
          }
          h++;
        }
        for (let r = 0; r < h; r++)
          for (let k = 0; k < w; k++) used[(row + r) * cols + col + k] = true;

        const isIce = kind === 'ice';
        const cx = col * TILE + (w * TILE) / 2;
        const cy = row * TILE + (h * TILE) / 2;
        this.addStaticCuboid(
          cx,
          cy,
          w * TILE,
          h * TILE,
          isIce ? 0.005 : BALL_FRICTION,
          isIce ? 'ice' : 'ground'
        );
      }
    }

    // Ramps: true triangle colliders in the correct orientation.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const id = cleanGid(gid) - 1;
        const shape = rampShapeOfId(id);
        if (shape) this.addRamp(col, row, shape);
      }
    }

    // Sensors + finish zone.
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const role = roleOfGid(gid);
        const { x, y } = this.cellCenter(col, row);
        const rect = new Phaser.Geom.Rectangle(x - TILE / 2, y - TILE / 2, TILE, TILE);
        if (role === 'water') this.waterRects.push(rect);
        else if (role === 'rough') this.roughRects.push(rect);
        else if (role === 'checkpoint' && cleanGid(gid) - 1 === 153) {
          this.checkpointCells.push({ rect, col, row });
        }
      }
    }

    const f = this.cellCenter(this.map.finish.col, this.map.finish.row);
    this.finishZone = new Phaser.Geom.Rectangle(
      f.x - TILE,
      f.y - TILE * 1.5,
      TILE * 2,
      TILE * 2.5
    );

    const sp = this.cellCenter(this.map.spawn.col, this.map.spawn.row);
    this.respawn.set(sp.x, sp.y - TILE * 0.5);
  }

  private addStaticCuboid(
    cxPx: number,
    cyPx: number,
    wPx: number,
    hPx: number,
    friction: number,
    label: 'ground' | 'ice'
  ) {
    const desc = RAPIER.ColliderDesc.cuboid(
      this.pxToM(wPx) / 2,
      this.pxToM(hPx) / 2
    )
      .setTranslation(this.pxToM(cxPx), this.pxToM(cyPx))
      .setRestitution(0.12)
      .setFriction(friction);
    const collider = this.world.createCollider(desc);
    this.groundHandles.add(collider.handle);
    void label;
  }

  private addRamp(
    col: number,
    row: number,
    shape: import('../../shared/tiles').RampShape
  ) {
    const x0 = this.pxToM(col * TILE);
    const y0 = this.pxToM(row * TILE);
    const s = this.pxToM(TILE);
    // Triangle corners per orientation (physics y grows downward like screen).
    let a: { x: number; y: number };
    let b: { x: number; y: number };
    let c: { x: number; y: number };
    switch (shape) {
      case 'ground-up': // slope rising to the right, solid below
        a = { x: x0, y: y0 + s };
        b = { x: x0 + s, y: y0 + s };
        c = { x: x0 + s, y: y0 };
        break;
      case 'ground-down': // slope falling to the right, solid below
        a = { x: x0, y: y0 };
        b = { x: x0, y: y0 + s };
        c = { x: x0 + s, y: y0 + s };
        break;
      case 'ceiling-up': // slope on the ceiling, solid above
        a = { x: x0, y: y0 };
        b = { x: x0 + s, y: y0 };
        c = { x: x0, y: y0 + s };
        break;
      case 'ceiling-down':
        a = { x: x0, y: y0 };
        b = { x: x0 + s, y: y0 };
        c = { x: x0 + s, y: y0 + s };
        break;
    }
    const desc = RAPIER.ColliderDesc.triangle(a, b, c)
      .setRestitution(0.12)
      .setFriction(BALL_FRICTION);
    const collider = this.world.createCollider(desc);
    this.groundHandles.add(collider.handle);
  }

  private createBall() {
    if (!this.textures.exists('ball')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
      g.lineStyle(2, 0xcbd5e1, 1);
      g.strokeCircle(BALL_RADIUS, BALL_RADIUS, BALL_RADIUS);
      g.generateTexture('ball', BALL_RADIUS * 2, BALL_RADIUS * 2);
      g.destroy();
    }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(this.pxToM(this.respawn.x), this.pxToM(this.respawn.y))
      .setLinearDamping(BALL_LINEAR_DAMPING)
      .setAngularDamping(BALL_ANGULAR_DAMPING)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.ballBody = this.world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS_METERS)
      .setRestitution(BALL_RESTITUTION)
      .setFriction(BALL_FRICTION)
      .setDensity(1)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.ballCollider = this.world.createCollider(colDesc, this.ballBody);

    this.ball = this.add.image(this.respawn.x, this.respawn.y, 'ball').setDepth(40);
  }

  // --- input --------------------------------------------------------------

  /** Ball speed in metres/second (physics units, as in the reference). */
  private ballSpeed(): number {
    const v = this.ballBody.linvel();
    return Math.hypot(v.x, v.y);
  }
  private ballResting(): boolean {
    return this.ballSpeed() < REST_SPEED;
  }

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sound.startAmbient();
      if (this.finished || !this.ballResting()) return;
      // Aim only when the press starts on/near the ball, like the original.
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      const near = Phaser.Math.Distance.Between(w.x, w.y, this.ball.x, this.ball.y);
      if (near <= BALL_RADIUS * 6) this.aiming = true;
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

  private dragVector(p: Phaser.Input.Pointer): Phaser.Math.Vector2 {
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
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
    const len = 24 + power * 88;
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(COLORS.aim),
      Phaser.Display.Color.ValueToColor(COLORS.aimPower),
      100,
      Math.round(power * 100)
    );
    const col = Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    this.aimGfx.fillStyle(col, 0.9);
    const dots = 8;
    for (let i = 1; i <= dots; i++) {
      const t = (i / dots) * len;
      this.aimGfx.fillCircle(this.ball.x + dir.x * t, this.ball.y + dir.y * t, 3);
    }
    this.aimGfx.lineStyle(3, col, 0.8);
    this.aimGfx.strokeCircle(this.ball.x, this.ball.y, BALL_RADIUS + 6 + power * 8);
  }

  private shoot(p: Phaser.Input.Pointer) {
    const v = this.dragVector(p);
    if (v.length() < 4) return;
    this.strokes += 1;
    this.onStroke?.(this.strokes);
    // Original: snap power to 0.005 steps, velocity = dir * pow(power,1.2)*150.
    const raw = Math.min(1, v.length() / MAX_DRAG);
    const snapped = 0.005 * Math.round(raw / 0.005);
    const power = Math.pow(snapped, POWER_EXP);
    const dir = v.clone().normalize();
    const speed = power * MAX_LAUNCH_SPEED;
    this.ballBody.setLinvel({ x: dir.x * speed, y: dir.y * speed }, true);
    this.ballBody.setAngvel(0, true);
    sound.play('BallHit', 0.3 * raw);
  }

  private resetToRespawn() {
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.ballBody.setAngvel(0, true);
    this.ballBody.setTranslation(
      { x: this.pxToM(this.respawn.x), y: this.pxToM(this.respawn.y) },
      true
    );
  }

  // --- loop ---------------------------------------------------------------

  update(_time: number, delta: number) {
    if (!this.world) return;

    // Fixed-timestep stepping with the original 1/180 dt (real CCD, no manual
    // speed cap needed).
    this.accumulator += Math.min(delta, 100) / 1000;
    let steps = 0;
    while (this.accumulator >= PHYSICS_TIMESTEP && steps < 8) {
      // Damping switch mirrors the bundle: lighter damping at low-ish speeds.
      const spd = Math.hypot(
        this.ballBody.linvel().x,
        this.ballBody.linvel().y
      );
      this.ballBody.setLinearDamping(
        spd > 0.1 && spd < 0.8 ? BALL_SLOW_DAMPING : BALL_LINEAR_DAMPING
      );
      this.world.step(this.eventQueue);
      this.drainEvents();
      this.accumulator -= PHYSICS_TIMESTEP;
      steps++;
    }

    const t = this.ballBody.translation();
    this.ball.x = t.x * PIXELS_PER_METER;
    this.ball.y = t.y * PIXELS_PER_METER;
    this.ball.rotation = this.ballBody.rotation();

    if (this.finished) return;

    this.handleSensors();

    if (this.ball.y > this.worldH + 400) this.resetToRespawn();

    if (
      Phaser.Geom.Rectangle.Contains(this.finishZone, this.ball.x, this.ball.y) &&
      this.ballResting()
    ) {
      this.finish();
    }
  }

  private drainEvents() {
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const involvesBall =
        h1 === this.ballCollider.handle || h2 === this.ballCollider.handle;
      if (!involvesBall) return;
      const other = h1 === this.ballCollider.handle ? h2 : h1;
      if (!this.groundHandles.has(other)) return;
      const speed = this.ballSpeed(); // m/s
      if (speed > 0.4 && this.time.now - this.lastBounceAt > 60) {
        this.lastBounceAt = this.time.now;
        sound.play('BallBounce', Math.min(0.9, 0.9 * (speed / 6)));
      }
    });
  }

  private handleSensors() {
    const bx = this.ball.x;
    const by = this.ball.y;

    for (const r of this.waterRects) {
      if (Phaser.Geom.Rectangle.Contains(r, bx, by)) {
        this.hitWater();
        return;
      }
    }

    let overRough = false;
    for (const r of this.roughRects) {
      if (Phaser.Geom.Rectangle.Contains(r, bx, by)) {
        overRough = true;
        const v = this.ballBody.linvel();
        this.ballBody.setLinvel({ x: v.x * 0.9, y: v.y * 0.94 }, true);
        break;
      }
    }
    if (overRough && !this.inRough && this.ballSpeed() > 0.3) {
      sound.play('Leaves', 0.4);
    }
    this.inRough = overRough;

    for (const cp of this.checkpointCells) {
      if (Phaser.Geom.Rectangle.Contains(cp.rect, bx, by)) {
        this.hitCheckpoint(cp.col, cp.row);
      }
    }
  }

  private hitWater() {
    if (this.finished) return;
    // Lava hazard: a hot orange flash instead of the old blue splash.
    sound.play('Splash', 0.2);
    this.cameras.main.flash(180, 255, 90, 20);
    this.resetToRespawn();
  }

  private hitCheckpoint(col: number, row: number) {
    const key = `${col},${row}`;
    if (this.lastCheckpointKey === key) return;
    this.lastCheckpointKey = key;
    const c = this.cellCenter(col, row);
    this.respawn.set(c.x, c.y - TILE);
    this.onCheckpoint?.();
    this.game.events.emit('checkpoint-reached');
    sound.play('Chime', 0.2);
    this.cameras.main.flash(140, 253, 223, 106);
  }

  private finish() {
    this.finished = true;
    const timeMs = Math.round(this.time.now - this.startTime);
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.cameras.main.flash(300, 253, 223, 106);
    sound.play('Claps', 0.6);
    this.onFinish?.(this.strokes, timeMs);
  }

  shutdown() {
    this.eventQueue?.free();
    this.world?.free();
  }
}
