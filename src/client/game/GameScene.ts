import Phaser from 'phaser';
import {
  BALL_ANGULAR_DAMPING,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  BALL_RADIUS,
  BALL_RADIUS_METERS,
  BALL_RESTITUTION,
  BALL_SETTLE_DAMPING,
  BALL_SETTLE_RESTITUTION,
  BALL_SLOW_SPEED,
  BALL_VISUAL_RADIUS,
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
import type { ReplayMove } from '../../shared/types';
import {
  roleOfGid,
  rampShapeOfId,
  cleanGid,
  isCheckpointGroundId,
  isFlagId,
  T_CHECKPOINT_FLAG,
  TILESET,
} from '../../shared/tiles';
import { sound } from './sound';
import { RAPIER } from './physics';
import { getBallSkin, type BallSkinId, type PowerupKind } from './powerups';

type CheckpointZone = {
  rect: Phaser.Geom.Rectangle;
  key: string;
  row: number;
  startCol: number;
  endCol: number;
  rank: number;
  respawn: Phaser.Math.Vector2;
};

type CheckpointFlagMarker = {
  sprite: Phaser.GameObjects.Image;
  rank: number;
};

type CoinPickup = {
  id: string;
  sprite: Phaser.GameObjects.Image;
  x: number;
  y: number;
};

type SlimePatch = {
  circle: Phaser.Geom.Circle;
  gfx: Phaser.GameObjects.Graphics;
};

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
  private strokeLabel!: Phaser.GameObjects.Text;
  private aiming = false;
  private aimStart = 0;
  private aimGfx!: Phaser.GameObjects.Graphics;
  private trajectoryGfx!: Phaser.GameObjects.Graphics;

  private zoom = DEFAULT_ZOOM;
  private infuriating = false;
  private pinchPrevDist = 0;

  private strokes = 0;
  private startTime = 0;
  private finished = false;
  private moves: ReplayMove[] = [];
  private dateKey = '';
  private mapId = 0;
  private collectedCoinIds = new Set<string>();
  private ballSkin: BallSkinId = 'classic';

  private respawn = new Phaser.Math.Vector2();
  /** The spawn/tee, used as the fallback respawn before any checkpoint. */
  private startPos = new Phaser.Math.Vector2();

  /** Sensor rects kept in world pixels for cheap per-frame overlap tests. */
  private waterRects: Phaser.Geom.Rectangle[] = [];
  private roughRects: Phaser.Geom.Rectangle[] = [];
  private checkpointZones: CheckpointZone[] = [];
  private activatedCheckpointRanks = new Set<number>();
  private bestCheckpointRank = -1;
  /** Checkpoint flags are visual only; activation comes from the ground. */
  private checkpointFlagMarkers: CheckpointFlagMarker[] = [];
  private coins: CoinPickup[] = [];
  private slimePatches: SlimePatch[] = [];
  private pendingPowerup: PowerupKind | null = null;
  private trajectoryShots = 0;
  private generatedCheckpointUsed = false;
  private stickyAnchor: Phaser.Math.Vector2 | null = null;
  /** True once a shot has been taken since the last spawn/respawn. */
  private shotSinceReset = false;
  private finishZone!: Phaser.Geom.Rectangle;

  private lastBounceAt = 0;
  private inRough = false;
  private groundHandles = new Set<number>();
  /** Squash/stretch pulse state (idle when elapsed >= 15). */
  private squashElapsed = 15;
  private squashAngle = 0;
  private squashIntensity = 0;
  /** True during the lava-death delay so it doesn't re-trigger. */
  private dying = false;
  /** Current damping/restitution so we only push changes to Rapier on switch. */
  private curDamping = BALL_LINEAR_DAMPING;
  private curRestitution = BALL_RESTITUTION;
  private cleanupGameEvents: Array<() => void> = [];

  private onStroke?: (n: number) => void;
  private onFinish?: (n: number, t: number, moves: ReplayMove[]) => void;
  private onCheckpoint?: () => void;
  private onCoinCollected?: (id: string) => void;

  /** Cursor CSS strings (image + hotspot) for each interaction state. */
  private static readonly CURSOR = {
    default: 'url(game/cursors/mouse_default.png) 0 0, auto',
    grab: 'url(game/cursors/hand_open.png) 8 6, grab',
    shoot: 'url(game/cursors/mouse_shoot.png) 8 8, crosshair',
  } as const;

  constructor() {
    super('game');
  }

  init(data: {
    map: RuntimeMap;
    dateKey?: string;
    mapId?: number;
    collectedCoinIds?: string[];
    ballSkin?: BallSkinId;
    zoom?: number;
    infuriating?: boolean;
    onStroke?: (n: number) => void;
    onFinish?: (n: number, t: number, moves: ReplayMove[]) => void;
    onCheckpoint?: () => void;
    onCoinCollected?: (id: string) => void;
  }) {
    this.map = data.map;
    this.dateKey = data.dateKey ?? '';
    this.mapId = data.mapId ?? 0;
    this.collectedCoinIds = new Set(data.collectedCoinIds ?? []);
    this.ballSkin = data.ballSkin ?? 'classic';
    this.zoom = data.zoom ?? DEFAULT_ZOOM;
    this.infuriating = data.infuriating ?? false;
    this.onStroke = data.onStroke;
    this.onFinish = data.onFinish;
    this.onCheckpoint = data.onCheckpoint;
    this.onCoinCollected = data.onCoinCollected;
    this.strokes = 0;
    this.moves = [];
    this.finished = false;
    this.waterRects = [];
    this.roughRects = [];
    this.checkpointZones = [];
    this.activatedCheckpointRanks = new Set();
    this.bestCheckpointRank = -1;
    this.checkpointFlagMarkers = [];
    this.coins = [];
    this.slimePatches = [];
    this.pendingPowerup = null;
    this.trajectoryShots = 0;
    this.generatedCheckpointUsed = false;
    this.stickyAnchor = null;
    this.shotSinceReset = false;
    this.accumulator = 0;
    this.groundHandles = new Set();
    this.squashElapsed = 15;
    this.squashIntensity = 0;
    this.dying = false;
    this.curDamping = BALL_LINEAR_DAMPING;
    this.curRestitution = BALL_RESTITUTION;
    this.cleanupGameEvents = [];
  }

  // --- unit helpers -------------------------------------------------------

  private pxToM(px: number): number {
    return px / PIXELS_PER_METER;
  }
  private cellCenter(col: number, row: number): { x: number; y: number } {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  private gidAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.map.cols || row >= this.map.rows) {
      return 0;
    }
    return this.map.gids[row * this.map.cols + col] ?? 0;
  }

  private isSolidLikeGid(gid: number): boolean {
    const id = cleanGid(gid) - 1;
    if (gid <= 0 || isFlagId(id)) return false;
    const role = roleOfGid(gid);
    return (
      role === 'ground' ||
      role === 'ice' ||
      role === 'ramp-up' ||
      role === 'ramp-down' ||
      role === 'finish' ||
      role === 'checkpoint'
    );
  }

  private onGameEvent(event: string, fn: (...args: unknown[]) => void) {
    this.game.events.on(event, fn);
    this.cleanupGameEvents.push(() => this.game.events.off(event, fn));
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
    this.createCoins();

    this.aimGfx = this.add.graphics().setDepth(50);
    this.trajectoryGfx = this.add.graphics().setDepth(49);
    this.setupInput();
    this.setupZoom();
    this.setupMenuBridge();
    this.setupPowerupBridge();
    this.setupShopBridge();
    sound.init();

    this.input.setDefaultCursor(GameScene.CURSOR.default);

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
        if (this.aiming) {
          this.aiming = false;
          this.aimGfx.clear();
          this.restoreZoom();
          this.setCursor('default');
        }
      } else {
        this.pinchPrevDist = 0;
      }
    });
    this.onGameEvent('zoom-in', () => this.stepZoom(-1));
    this.onGameEvent('zoom-out', () => this.stepZoom(1));
    this.onGameEvent('zoom-set', (z) => this.applyZoom(Number(z)));
  }

  /** Menu actions forwarded from the DOM shell. */
  private setupMenuBridge() {
    this.onGameEvent('return-checkpoint', () => {
      if (this.finished) return;
      this.resetToRespawn();
      sound.play('Back', 0.5);
    });
    this.onGameEvent('recenter', () => {
      this.cameras.main.startFollow(this.ball, false, 0.12, 0.12);
    });
  }

  /** Powerup actions forwarded from the DOM shell. */
  private setupPowerupBridge() {
    this.onGameEvent('powerup-request', (kind) => {
      if (kind === 'trajectory' || kind === 'sticky' || kind === 'checkpoint') {
        this.requestPowerup(kind);
      }
    });
    this.onGameEvent('powerup-cancel', () => this.disarmPowerup());
  }

  private setupShopBridge() {
    this.onGameEvent('skin-changed', (skinId) => {
      const skin = getBallSkin(skinId);
      this.ballSkin = skin.id;
      this.applyBallSkin();
    });
  }

  private requestPowerup(kind: PowerupKind) {
    if (this.finished || this.dying) {
      this.game.events.emit('powerup-failed', 'Finish this run first.');
      return;
    }

    if (kind === 'trajectory') {
      if (this.trajectoryShots > 0) {
        this.game.events.emit('powerup-failed', 'Trajectory is already ready.');
        return;
      }
      if (!this.ballResting()) {
        this.game.events.emit('powerup-failed', 'Wait until the ball stops.');
        return;
      }
      this.trajectoryShots = Math.max(this.trajectoryShots, 1);
      this.pendingPowerup = null;
      this.setCursor('default');
      this.recordPowerupMove('trajectory');
      this.game.events.emit('powerup-consumed', kind);
      this.game.events.emit('powerup-disarmed');
      this.game.events.emit('powerup-ready', 'Trajectory ready for your next shot.');
      return;
    }

    if (kind === 'checkpoint') {
      if (this.infuriating) {
        this.game.events.emit('powerup-failed', 'Checkpoints are disabled in Infuriating Mode.');
        return;
      }
      if (this.generatedCheckpointUsed) {
        this.game.events.emit('powerup-failed', 'Only one generated checkpoint per run.');
        return;
      }
      if (!this.ballResting() || !this.isGrounded()) {
        this.game.events.emit('powerup-failed', 'Land on ground before making a checkpoint.');
        return;
      }
      this.pendingPowerup = null;
      this.setCursor('default');
      this.generatedCheckpointUsed = true;
      this.recordPowerupMove('checkpoint');
      this.respawn.set(this.ball.x, this.ball.y);
      this.playGeneratedCheckpoint(this.ball.x, this.ball.y);
      this.playCheckpointGlow(this.ball.x, this.ball.y);
      this.bestCheckpointRank += 0.5;
      this.activatedCheckpointRanks.add(this.bestCheckpointRank);
      sound.play('Chime', 0.55);
      this.game.events.emit('checkpoint-reached');
      this.game.events.emit('powerup-consumed', kind);
      this.game.events.emit('powerup-disarmed');
      return;
    }

    if (!this.ballResting()) {
      this.game.events.emit('powerup-failed', 'Wait until the ball stops.');
      return;
    }
    this.pendingPowerup = this.pendingPowerup === 'sticky' ? null : 'sticky';
    this.trajectoryGfx.clear();
    if (this.pendingPowerup) {
      this.setCursor('shoot');
      this.game.events.emit('powerup-armed', this.pendingPowerup);
      this.game.events.emit('powerup-ready', 'Click a wall to place slime.');
    } else {
      this.setCursor('default');
      this.game.events.emit('powerup-disarmed');
    }
  }

  private disarmPowerup() {
    if (!this.pendingPowerup) return;
    this.pendingPowerup = null;
    this.setCursor('default');
    this.game.events.emit('powerup-disarmed');
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

    // OUTER background = one textured dirt object across the padded backdrop.
    if (this.ensureDirtTexture()) {
      this.add
        .tileSprite(left, top, totalW, totalH, 'dirt')
        .setOrigin(0, 0)
        .setDepth(-14);
    } else {
      this.add
        .rectangle(left, top, totalW, totalH, COLORS.dirt)
        .setOrigin(0, 0)
        .setDepth(-14);
    }

    // INNER background = the checkerboard grid, filling ONLY the map rectangle
    // (the area the ball plays against), mirroring the original's grid backdrop.
    if (this.textures.exists('checkerboard')) {
      const grid = this.add
        .tileSprite(0, 0, this.worldW, this.worldH, 'checkerboard')
        .setOrigin(0, 0)
        .setDepth(-12);
      grid.tileScaleX = 12.5;
      grid.tileScaleY = 12.5;
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
        const role = roleOfGid(gid);
        // Skip decoration glyphs (e.g. the stray "5") entirely.
        if (role === 'decor') continue;
        const { x, y } = this.cellCenter(col, row);

        // Static (non-animated) tile art, including the recolored lava and the
        // walk-through checkpoint flag (drawn normally).
        const img = this.add
          .image(x, y, 'tileset', frame)
          .setDisplaySize(TILE + 1, TILE + 1)
          .setDepth(5);
        // Checkpoint flags stay visual-only; checkpoint activation comes from
        // landing on checkpoint-ground tiles.
        if (cleanGid(gid) - 1 === T_CHECKPOINT_FLAG) {
          this.checkpointFlagMarkers.push({
            sprite: img,
            rank: this.checkpointRankForCell(col, row),
          });
        }
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
        // Flags are decorations/sensors, never terrain. Only the platform
        // tiles around them should create Rapier colliders.
        if (isFlagId(id)) continue;
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
    const checkpointMask: boolean[] = new Array(cols * rows).fill(false);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const gid = gids[row * cols + col] ?? 0;
        if (gid <= 0) continue;
        const id = cleanGid(gid) - 1;
        const role = roleOfGid(gid);
        const { x, y } = this.cellCenter(col, row);
        const rect = new Phaser.Geom.Rectangle(x - TILE / 2, y - TILE / 2, TILE, TILE);
        if (role === 'water') this.waterRects.push(rect);
        else if (role === 'rough') this.roughRects.push(rect);
        if (isCheckpointGroundId(id)) checkpointMask[row * cols + col] = true;
      }
    }
    this.checkpointZones = this.buildCheckpointZones(checkpointMask);

    const f = this.cellCenter(this.map.finish.col, this.map.finish.row);
    this.finishZone = new Phaser.Geom.Rectangle(
      f.x - TILE,
      f.y - TILE * 1.5,
      TILE * 2,
      TILE * 2.5
    );

    const sp = this.cellCenter(this.map.spawn.col, this.map.spawn.row);
    this.startPos.set(sp.x, sp.y - TILE * 0.5);
    this.respawn.copy(this.startPos);
  }

  private buildCheckpointZones(checkpointMask: boolean[]): CheckpointZone[] {
    const { cols, rows } = this.map;
    const zones: CheckpointZone[] = [];
    const padX = TILE * 0.45;
    const topPad = TILE * 1.25;
    const bottomPad = TILE * 0.4;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (!checkpointMask[row * cols + col]) continue;

        const startCol = col;
        while (col + 1 < cols && checkpointMask[row * cols + col + 1]) col++;
        const endCol = col;
        const width = (endCol - startCol + 1) * TILE;
        const zoneCenter = new Phaser.Math.Vector2(
          startCol * TILE + width / 2,
          row * TILE - TILE / 2
        );
        const target = this.nearestCheckpointFlagTarget(zoneCenter.x, zoneCenter.y);

        zones.push({
          key: `${startCol}-${endCol},${row}`,
          row,
          startCol,
          endCol,
          rank: target.rank,
          respawn: target.point,
          rect: new Phaser.Geom.Rectangle(
            startCol * TILE - padX,
            row * TILE - topPad,
            width + padX * 2,
            TILE + topPad + bottomPad
          ),
        });
      }
    }

    return zones;
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

  // --- coins --------------------------------------------------------------

  private createCoins() {
    this.ensureCoinTexture();
    const spots = this.pickCoinSpots();
    for (const spot of spots) {
      const id = `coin-${spot.col}-${spot.row}`;
      if (this.collectedCoinIds.has(id)) continue;
      const { x, y } = this.cellCenter(spot.col, spot.row);
      const sprite = this.add.image(x, y, 'coin').setDepth(35);
      sprite.setScale(0.95);
      this.tweens.add({
        targets: sprite,
        y: y - 5,
        duration: 760 + (this.hashCell(spot.col, spot.row) % 260),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      this.coins.push({ id, sprite, x, y });
    }
  }

  private ensureCoinTexture() {
    if (this.textures.exists('coin')) return;
    const size = 24;
    const c = size / 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(c + 2, c + 3, 18, 10);
    g.fillStyle(0x8a4b0f, 1);
    g.fillCircle(c, c, 10);
    g.fillStyle(0xffd65a, 1);
    g.fillCircle(c, c, 8);
    g.fillStyle(0xfff1a6, 0.95);
    g.fillCircle(c - 3, c - 4, 3);
    g.lineStyle(2, 0x6b3a09, 1);
    g.strokeCircle(c, c, 9);
    g.generateTexture('coin', size, size);
    g.destroy();
  }

  private pickCoinSpots(): Array<{ col: number; row: number }> {
    const candidates: Array<{ col: number; row: number; hash: number }> = [];
    for (let row = 0; row < this.map.rows - 1; row++) {
      for (let col = 0; col < this.map.cols; col++) {
        if (!this.isStandableCoinCell(col, row)) continue;
        if (this.cellDistanceSq(col, row, this.map.spawn.col, this.map.spawn.row) < 18) {
          continue;
        }
        if (this.cellDistanceSq(col, row, this.map.finish.col, this.map.finish.row) < 12) {
          continue;
        }
        candidates.push({ col, row, hash: this.hashCell(col, row) });
      }
    }

    candidates.sort((a, b) => a.hash - b.hash);
    const picked: Array<{ col: number; row: number }> = [];
    for (const c of candidates) {
      if (picked.some((p) => this.cellDistanceSq(c.col, c.row, p.col, p.row) < 36)) {
        continue;
      }
      picked.push({ col: c.col, row: c.row });
      if (picked.length >= 5) break;
    }
    return picked;
  }

  private isStandableCoinCell(col: number, row: number): boolean {
    if (this.gidAt(col, row) !== 0) return false;
    const belowRole = roleOfGid(this.gidAt(col, row + 1));
    return (
      belowRole === 'ground' ||
      belowRole === 'ice' ||
      belowRole === 'ramp-up' ||
      belowRole === 'ramp-down' ||
      belowRole === 'checkpoint'
    );
  }

  private cellDistanceSq(
    aCol: number,
    aRow: number,
    bCol: number,
    bRow: number
  ): number {
    const dx = aCol - bCol;
    const dy = aRow - bRow;
    return dx * dx + dy * dy;
  }

  private hashCell(col: number, row: number): number {
    const key = `${this.dateKey}:${this.mapId}:${col}:${row}`;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private collectCoin(coin: CoinPickup) {
    this.coins = this.coins.filter((c) => c !== coin);
    this.tweens.killTweensOf(coin.sprite);
    this.onCoinCollected?.(coin.id);
    sound.play('Chime', 0.3);
    for (let i = 0; i < 8; i++) {
      const p = this.add.circle(coin.x, coin.y, 2, i % 2 ? 0xfff1a6 : 0xffd65a);
      p.setDepth(42);
      const ang = (Math.PI * 2 * i) / 8;
      this.tweens.add({
        targets: p,
        x: coin.x + Math.cos(ang) * 22,
        y: coin.y + Math.sin(ang) * 22,
        alpha: 0,
        duration: 320,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
    this.tweens.add({
      targets: coin.sprite,
      scale: 1.45,
      alpha: 0,
      duration: 180,
      ease: 'Back.easeIn',
      onComplete: () => coin.sprite.destroy(),
    });
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

    // Exact ball collider from the bundle: ball(0.3), restitution 0.86,
    // friction 0.1, high contact-force threshold. Collision events enabled so
    // we can play the wall/ground bounce SFX.
    const colDesc = RAPIER.ColliderDesc.ball(BALL_RADIUS_METERS)
      .setRestitution(BALL_RESTITUTION)
      .setFriction(BALL_FRICTION)
      .setContactForceEventThreshold(1e6)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.ballCollider = this.world.createCollider(colDesc, this.ballBody);

    this.ensureBallTexture();
    this.ball = this.add.image(this.respawn.x, this.respawn.y, this.ballTextureKey()).setDepth(40);
    this.strokeLabel = this.add
      .text(this.ball.x, this.ball.y - BALL_VISUAL_RADIUS - 10, '0', {
        fontFamily: '"Comic Neue", "Comic Sans MS", system-ui, sans-serif',
        fontSize: '28px',
        fontStyle: '700',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 7,
      })
      .setOrigin(0.5, 1)
      .setDepth(65);
  }

  /**
   * Build the ball texture to match the bundle: white body (r=18) with a dark
   * outline, an offset drop shadow, a soft warm highlight upper-left, and a few
   * dimples. Drawn once into a reusable texture.
   */
  private ballTextureKey(): string {
    return `hgball-${this.ballSkin}`;
  }

  private applyBallSkin() {
    this.ensureBallTexture();
    if (this.ball) this.ball.setTexture(this.ballTextureKey());
  }

  private ensureBallTexture() {
    const key = this.ballTextureKey();
    if (this.textures.exists(key)) return;
    const skin = getBallSkin(this.ballSkin);
    const R = BALL_VISUAL_RADIUS;
    const pad = 6;
    const c = R + pad; // texture centre
    const size = c * 2;
    const g = this.make.graphics({ x: 0, y: 0 }, false);

    // Drop shadow (offset down-right).
    g.fillStyle(0x000000, 0.3);
    g.fillCircle(c + 3, c + 3, R);
    // Dark base ring / outline backing.
    g.fillStyle(0x000000, 0.7);
    g.fillCircle(c, c, R + 1);
    // Skin body.
    g.fillStyle(skin.body, 1);
    g.fillCircle(c, c, R);
    // Soft warm highlights upper-left (kept small so they stay on the ball).
    g.fillStyle(skin.highlight, 0.22);
    g.fillCircle(c - 6, c - 6, R * 0.55);
    g.fillStyle(skin.highlight, 0.18);
    g.fillCircle(c - 6.3, c - 6.3, R * 0.38);
    // Dimples.
    g.fillStyle(skin.dimple, 0.9);
    const dimples = [
      { x: 4, y: 6 },
      { x: -7, y: 3 },
      { x: 6, y: -4 },
      { x: -3, y: -8 },
      { x: 9, y: -2 },
      { x: -9, y: -3 },
      { x: 1, y: 10 },
    ];
    for (const d of dimples) g.fillCircle(c + d.x, c + d.y, 1.1);
    // Outline.
    g.lineStyle(2, skin.outline, 1);
    g.strokeCircle(c, c, R);

    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** Trigger the squash/stretch pulse along `angle` with `intensity` (0..1). */
  private triggerSquash(angle: number, intensity: number) {
    this.squashAngle = angle;
    this.squashIntensity = Phaser.Math.Clamp(intensity, 0, 1);
    this.squashElapsed = 0;
  }

  /** Advance the damped squash oscillation and apply it to the ball scale. */
  private updateSquash(deltaTicks: number) {
    if (this.squashElapsed >= 15) {
      this.ball.setScale(1, 1);
      return;
    }
    this.squashElapsed += deltaTicks;
    const e = Math.min(1, this.squashElapsed / 15);
    if (e >= 1) {
      this.ball.setScale(1, 1);
      return;
    }
    const i = Math.sin(e * Math.PI * 2) * Math.exp(-3 * e);
    this.ball.scaleX = 1 + Math.cos(this.squashAngle) * i * 0.2 * this.squashIntensity;
    this.ball.scaleY = 1 + Math.sin(this.squashAngle) * i * 0.2 * this.squashIntensity;
  }

  // --- input --------------------------------------------------------------

  /** Ball speed in metres/second (physics units, as in the reference). */
  private ballSpeed(): number {
    const v = this.ballBody.linvel();
    return Math.hypot(v.x, v.y);
  }
  private ballResting(): boolean {
    if (this.stickyAnchor) return true;
    return this.ballSpeed() < REST_SPEED;
  }

  /** True if the ball collider is currently touching any solid collider. */
  private isGrounded(): boolean {
    let grounded = false;
    this.world.contactPairsWith(this.ballCollider, (other) => {
      if (this.groundHandles.has(other.handle)) grounded = true;
    });
    return grounded;
  }

  /**
   * Mirrors the bundle's per-step settle logic: when the ball is slow AND
   * grounded, linear damping is raised (0.4 -> 4) and restitution dropped
   * (0.86 -> 0.3) so it comes to rest instead of bouncing forever. Otherwise
   * the lively defaults are restored. Values only pushed to Rapier on change.
   */
  private applySettleModel() {
    const slow = this.ballSpeed() < BALL_SLOW_SPEED;
    const settle = slow && this.isGrounded();
    const damping = settle ? BALL_SETTLE_DAMPING : BALL_LINEAR_DAMPING;
    const restitution = settle ? BALL_SETTLE_RESTITUTION : BALL_RESTITUTION;

    if (damping !== this.curDamping) {
      this.ballBody.setLinearDamping(damping);
      this.curDamping = damping;
    }
    if (restitution !== this.curRestitution) {
      this.ballCollider.setRestitution(restitution);
      this.curRestitution = restitution;
    }
  }

  /** How close (world px) the pointer must be to the ball to "grab" it. */
  private nearBall(p: Phaser.Input.Pointer): boolean {
    const w = this.cameras.main.getWorldPoint(p.x, p.y);
    return (
      Phaser.Math.Distance.Between(w.x, w.y, this.ball.x, this.ball.y) <=
      BALL_RADIUS * 6
    );
  }

  private setCursor(state: keyof typeof GameScene.CURSOR) {
    this.input.setDefaultCursor(GameScene.CURSOR[state]);
  }

  private elapsedMs(): number {
    return Math.max(0, Math.round(this.time.now - this.startTime));
  }

  private roundPx(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private recordPowerupMove(
    powerup: PowerupKind,
    target?: { x: number; y: number }
  ) {
    this.moves.push({
      type: 'powerup',
      powerup,
      t: this.elapsedMs(),
      x: this.roundPx(this.ball.x),
      y: this.roundPx(this.ball.y),
      ...(target
        ? {
            targetX: this.roundPx(target.x),
            targetY: this.roundPx(target.y),
          }
        : {}),
    });
  }

  private setupInput() {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      sound.startAmbient();
      if (this.pendingPowerup === 'sticky') {
        this.placeStickySlimeFromPointer(p);
        return;
      }
      if (this.finished || !this.ballResting()) return;
      // Aim only when the press starts on/near the ball, like the original.
      if (this.nearBall(p)) {
        this.aiming = true;
        this.aimStart = this.time.now;
        this.setCursor('shoot');
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.aiming) {
        this.drawAim(p);
        return;
      }
      // Idle hover: open hand over a grabbable (resting) ball, else default.
      if (!this.finished && !this.dying && this.ballResting() && this.nearBall(p)) {
        this.setCursor('grab');
      } else {
        this.setCursor('default');
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.aiming) return;
      this.aiming = false;
      this.aimGfx.clear();
      this.trajectoryGfx.clear();
      this.shoot(p);
      // Back to grab if still hovering the (now moving) ball, else default.
      this.setCursor(this.nearBall(p) ? 'grab' : 'default');
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

  /**
   * Power -> colour ramp for the aim indicator and ball tint (white at rest,
   * warming through yellow to red at full power).
   */
  private powerColor(power: number): number {
    const lerp = (a: number, b: number, t: number) => {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(a),
        Phaser.Display.Color.ValueToColor(b),
        100,
        Math.round(t * 100)
      );
      return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
    };
    if (power < 0.5) return lerp(0xffffff, 0xffd23d, power * 2);
    return lerp(0xffd23d, 0xff3b1a, (power - 0.5) * 2);
  }

  /**
   * Throw indicator mirrored from the bundle's `Cg` draw: a black backing line
   * plus a colour line from the ball to the pulled point, a filled dot at that
   * point, and a power tint on the ball. The pulled length uses power^(1/1.2)
   * so the visual matches perceived power, and the camera zooms out as you
   * charge (zoom * (1 - 0.676 * power * ease)).
   */
  private drawAim(p: Phaser.Input.Pointer) {
    const v = this.dragVector(p);
    const raw = Math.min(1, v.length() / MAX_DRAG);
    this.aimGfx.clear();

    const launch = v.clone().normalize(); // direction the ball will travel
    // Pulled point sits opposite the launch (the slingshot band you pull).
    const visualLen = Math.pow(raw, 1 / POWER_EXP) * MAX_DRAG;
    const px = this.ball.x - launch.x * visualLen;
    const py = this.ball.y - launch.y * visualLen;

    const col = this.powerColor(raw);
    const z = this.cameras.main.zoom || 1;
    const wBlack = 5 / z;
    const wColor = 3 / z;
    const dot = 5 / z;

    // Power tint glow on the ball (alpha = min(0.3, 0.3*power)).
    if (raw > 0.1) {
      this.aimGfx.fillStyle(col, Math.min(0.3, 0.3 * raw));
      this.aimGfx.fillCircle(this.ball.x, this.ball.y, BALL_RADIUS + 2);
    }
    // Black backing line.
    this.aimGfx.lineStyle(wBlack, 0x000000, 0.3);
    this.aimGfx.beginPath();
    this.aimGfx.moveTo(this.ball.x, this.ball.y);
    this.aimGfx.lineTo(px, py);
    this.aimGfx.strokePath();
    // Colour line + end dot.
    this.aimGfx.lineStyle(wColor, col, 0.9);
    this.aimGfx.beginPath();
    this.aimGfx.moveTo(this.ball.x, this.ball.y);
    this.aimGfx.lineTo(px, py);
    this.aimGfx.strokePath();
    this.aimGfx.fillStyle(col, 0.9);
    this.aimGfx.fillCircle(px, py, dot);

    if (this.trajectoryShots > 0) this.drawTrajectoryPreview(v);
    else this.trajectoryGfx.clear();

    this.applyChargeZoom(raw);
  }

  private drawTrajectoryPreview(v: Phaser.Math.Vector2) {
    this.trajectoryGfx.clear();
    const raw = Math.min(1, v.length() / MAX_DRAG);
    if (raw < 0.04) return;

    const snapped = 0.005 * Math.round(raw / 0.005);
    const power = Math.pow(snapped, POWER_EXP);
    const dir = v.clone().normalize();
    const vx = dir.x * power * MAX_LAUNCH_SPEED;
    const vy = dir.y * power * MAX_LAUNCH_SPEED;

    this.trajectoryGfx.fillStyle(0x9ffcff, 0.82);
    const dt = 0.08;
    for (let i = 1; i <= 42; i++) {
      const t = i * dt;
      const x = this.ball.x + vx * PIXELS_PER_METER * t;
      const y =
        this.ball.y +
        vy * PIXELS_PER_METER * t +
        0.5 * GRAVITY_Y * PIXELS_PER_METER * t * t;

      if (
        x < -TILE ||
        y < -TILE ||
        x > this.worldW + TILE ||
        y > this.worldH + TILE ||
        this.isSolidLikeGid(this.gidAt(Math.floor(x / TILE), Math.floor(y / TILE)))
      ) {
        break;
      }
      const radius = Math.max(2, 5 - i * 0.06) / (this.cameras.main.zoom || 1);
      this.trajectoryGfx.fillCircle(x, y, radius);
    }
  }

  private placeStickySlimeFromPointer(p: Phaser.Input.Pointer) {
    if (this.finished || this.dying) return;
    const world = this.cameras.main.getWorldPoint(p.x, p.y);
    if (
      world.x < 0 ||
      world.y < 0 ||
      world.x > this.worldW ||
      world.y > this.worldH ||
      !this.nearSolidSurface(world.x, world.y)
    ) {
      this.game.events.emit('powerup-failed', 'Click on a wall or platform for slime.');
      return;
    }

    this.placeSlimePatch(world.x, world.y);
    this.recordPowerupMove('sticky', { x: world.x, y: world.y });
    this.pendingPowerup = null;
    this.setCursor('default');
    this.game.events.emit('powerup-consumed', 'sticky');
    this.game.events.emit('powerup-disarmed');
  }

  private nearSolidSurface(x: number, y: number): boolean {
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.isSolidLikeGid(this.gidAt(col + dx, row + dy))) return true;
      }
    }
    return false;
  }

  private placeSlimePatch(x: number, y: number) {
    const radius = TILE * 0.72;
    const gfx = this.add.graphics().setDepth(34);
    gfx.fillStyle(0x123b1c, 0.42);
    gfx.fillCircle(x + 3, y + 5, radius * 0.9);
    gfx.fillStyle(0x43d86a, 0.9);
    gfx.fillCircle(x, y, radius * 0.72);
    gfx.fillStyle(0x8fff95, 0.75);
    gfx.fillCircle(x - 7, y - 7, radius * 0.28);
    gfx.fillStyle(0x1f8f3b, 0.85);
    gfx.fillCircle(x + 10, y + 8, radius * 0.3);
    this.slimePatches.push({
      circle: new Phaser.Geom.Circle(x, y, radius),
      gfx,
    });
    this.cameras.main.flash(90, 97, 255, 135);
    sound.play('Leaves', 0.45);
  }

  private stickToSlime(patch: SlimePatch) {
    if (this.stickyAnchor || this.finished || this.dying) return;
    this.stickyAnchor = new Phaser.Math.Vector2(this.ball.x, this.ball.y);
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.ballBody.setAngvel(0, true);
    this.ball.setTint(0x8fff95);
    this.tweens.add({
      targets: this.ball,
      scaleX: 1.2,
      scaleY: 0.82,
      duration: 110,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.ball.clearTint();
        this.ball.setScale(1, 1);
      },
    });
    patch.gfx.setAlpha(0.82);
    sound.play('Leaves', 0.5);
  }

  private playGeneratedCheckpoint(x: number, y: number) {
    this.ensureGeneratedCheckpointTexture();
    const flag = this.add
      .image(x, y - TILE * 0.85, 'generated-checkpoint')
      .setDepth(36);
    this.checkpointFlagMarkers.push({
      sprite: flag,
      rank: this.bestCheckpointRank + 0.5,
    });
  }

  private ensureGeneratedCheckpointTexture() {
    if (this.textures.exists('generated-checkpoint')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.lineStyle(3, 0x3b2a14, 1);
    g.beginPath();
    g.moveTo(10, 42);
    g.lineTo(10, 8);
    g.strokePath();
    g.fillStyle(0xfff1a6, 1);
    g.fillTriangle(12, 9, 30, 15, 12, 23);
    g.lineStyle(2, 0x7c4a03, 1);
    g.strokeTriangle(12, 9, 30, 15, 12, 23);
    g.fillStyle(0x047857, 1);
    g.fillEllipse(10, 43, 18, 7);
    g.generateTexture('generated-checkpoint', 36, 48);
    g.destroy();
  }

  /**
   * Ease-in charge zoom-out: the camera pulls back as power builds. The
   * pull-back is proportional to the current zoom, so it's clamped to a floor
   * (and to at most ~40% of the resting zoom) — otherwise charging a full shot
   * while already zoomed out drops the zoom to an unusable value.
   */
  private applyChargeZoom(power: number) {
    const elapsed = this.time.now - this.aimStart;
    const t = Phaser.Math.Clamp(elapsed / 370, 0, 1); // ~22 frames @60fps
    const ease = 1 - (1 - t) * (1 - t);
    let target = this.zoom * (1 - 0.676 * power * ease);
    target = Math.max(target, this.zoom * 0.6, 0.28);
    this.cameras.main.setZoom(target);
  }

  /** Restore the resting zoom after a shot / cancelled aim. */
  private restoreZoom() {
    this.cameras.main.zoomTo(this.zoom, 140);
  }

  private shoot(p: Phaser.Input.Pointer) {
    const v = this.dragVector(p);
    if (v.length() < 4) {
      this.restoreZoom();
      return;
    }
    this.stickyAnchor = null;
    this.strokes += 1;
    this.onStroke?.(this.strokes);
    this.strokeLabel.setText(String(this.strokes));
    // Original: snap power to 0.005 steps, velocity = dir * pow(power,1.2)*150.
    const raw = Math.min(1, v.length() / MAX_DRAG);
    const snapped = 0.005 * Math.round(raw / 0.005);
    const power = Math.pow(snapped, POWER_EXP);
    const dir = v.clone().normalize();
    const speed = power * MAX_LAUNCH_SPEED;
    const velocityX = dir.x * speed;
    const velocityY = dir.y * speed;
    this.moves.push({
      type: 'shot',
      shot: this.strokes,
      t: this.elapsedMs(),
      x: this.roundPx(this.ball.x),
      y: this.roundPx(this.ball.y),
      dragX: this.roundPx(v.x),
      dragY: this.roundPx(v.y),
      power: Math.round(power * 10000) / 10000,
      velocityX: this.roundPx(velocityX),
      velocityY: this.roundPx(velocityY),
    });
    this.ballBody.setLinvel({ x: velocityX, y: velocityY }, true);
    this.ballBody.setAngvel(0, true);
    this.shotSinceReset = true;
    // Stretch along the launch direction for that satisfying "lunge".
    this.triggerSquash(Math.atan2(dir.y, dir.x), Math.max(0.35, raw));
    sound.play('BallHit', 0.3 * raw);
    if (this.trajectoryShots > 0) this.trajectoryShots -= 1;
    this.game.events.emit('powerup-disarmed');
    this.restoreZoom();
  }

  private resetToRespawn() {
    this.stickyAnchor = null;
    this.trajectoryGfx.clear();
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.ballBody.setAngvel(0, true);
    this.ballBody.setTranslation(
      { x: this.pxToM(this.respawn.x), y: this.pxToM(this.respawn.y) },
      true
    );
    // Must take a fresh shot before the hole can be finished again — stops the
    // ball from insta-winning when it respawns at the flag checkpoint.
    this.shotSinceReset = false;
  }

  // --- loop ---------------------------------------------------------------

  update(_time: number, delta: number) {
    if (!this.world) return;

    // Fixed-timestep stepping with the original 1/180 dt (real CCD, no manual
    // speed cap needed).
    this.accumulator += Math.min(delta, 100) / 1000;
    let steps = 0;
    while (this.accumulator >= PHYSICS_TIMESTEP && steps < 8) {
      this.applySettleModel();
      this.world.step(this.eventQueue);
      this.drainEvents();
      this.accumulator -= PHYSICS_TIMESTEP;
      steps++;
    }

    if (this.stickyAnchor) {
      this.ballBody.setLinvel({ x: 0, y: 0 }, true);
      this.ballBody.setAngvel(0, true);
      this.ballBody.setTranslation(
        { x: this.pxToM(this.stickyAnchor.x), y: this.pxToM(this.stickyAnchor.y) },
        true
      );
    }

    // While drowning, the death tween owns the ball's position/scale/alpha, so
    // don't overwrite it from physics.
    if (!this.dying) {
      const t = this.ballBody.translation();
      this.ball.x = t.x * PIXELS_PER_METER;
      this.ball.y = t.y * PIXELS_PER_METER;
      this.ball.rotation = this.ballBody.rotation();
      // Squash/stretch pulse (delta in ~60fps ticks, like the bundle).
      this.updateSquash(delta / (1000 / 60));
    }
    this.strokeLabel?.setPosition(this.ball.x, this.ball.y - BALL_VISUAL_RADIUS - 10);
    this.strokeLabel?.setText(String(this.strokes));

    if (this.finished || this.dying) return;

    this.handleSensors();

    if (this.ball.y > this.worldH + 400) this.resetToRespawn();

    // Win only after a shot has actually been taken since the last spawn or
    // respawn — otherwise respawning at the flag checkpoint would insta-win.
    if (
      this.shotSinceReset &&
      Phaser.Geom.Rectangle.Contains(this.finishZone, this.ball.x, this.ball.y) &&
      this.ballResting() &&
      this.isGrounded()
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
        // Squash along the current travel direction, scaled by impact speed.
        const v = this.ballBody.linvel();
        this.triggerSquash(
          Math.atan2(v.y, v.x),
          Math.min(1, speed / 6)
        );
      }
    });
  }

  private handleSensors() {
    const bx = this.ball.x;
    const by = this.ball.y;

    // Lava kills on TOUCH, but require a real overlap (not just grazing the
    // edge) so rolling along a ledge next to lava isn't an unfair death.
    const ballCircle = new Phaser.Geom.Circle(bx, by, BALL_RADIUS * 0.7);
    for (const r of this.waterRects) {
      if (Phaser.Geom.Intersects.CircleToRectangle(ballCircle, r)) {
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

    for (const coin of [...this.coins]) {
      if (Phaser.Math.Distance.Between(bx, by, coin.x, coin.y) <= BALL_RADIUS + 13) {
        this.collectCoin(coin);
      }
    }

    if (!this.stickyAnchor) {
      const stickyCircle = new Phaser.Geom.Circle(bx, by, BALL_RADIUS * 1.05);
      for (const patch of this.slimePatches) {
        if (Phaser.Geom.Intersects.CircleToCircle(stickyCircle, patch.circle)) {
          this.stickToSlime(patch);
          break;
        }
      }
    }

    this.checkCheckpointGround();
  }

  /**
   * Checkpoints only count when the ball is grounded with its feet over
   * checkpoint-ground. The flag itself is visual-only and never activates this.
   */
  private checkCheckpointGround() {
    if (this.infuriating || this.checkpointZones.length === 0) return;
    if (!this.isGrounded()) return;

    const footRow = Math.floor((this.ball.y + BALL_RADIUS + 2) / TILE);
    const minFootCol = Math.floor((this.ball.x - BALL_RADIUS * 0.65) / TILE);
    const maxFootCol = Math.floor((this.ball.x + BALL_RADIUS * 0.65) / TILE);
    const ballCircle = new Phaser.Geom.Circle(
      this.ball.x,
      this.ball.y,
      BALL_RADIUS * 0.95
    );
    for (const zone of this.checkpointZones) {
      if (zone.row !== footRow) continue;
      if (maxFootCol < zone.startCol || minFootCol > zone.endCol) continue;
      if (!Phaser.Geom.Intersects.CircleToRectangle(ballCircle, zone.rect)) continue;
      if (zone.rank < this.bestCheckpointRank) return;

      this.respawn.copy(zone.respawn);
      if (zone.rank > this.bestCheckpointRank) this.bestCheckpointRank = zone.rank;
      if (!this.activatedCheckpointRanks.has(zone.rank)) {
        this.activatedCheckpointRanks.add(zone.rank);
        sound.play('Chime', 0.5);
        this.onCheckpoint?.();
        this.game.events.emit('checkpoint-reached');
        this.playCheckpointGlow(zone.respawn.x, zone.respawn.y);
      }
      return;
    }
  }

  /** One-shot bright glow-up when a checkpoint activates. */
  private playCheckpointGlow(x: number, y: number) {
    // Expanding, fading bright ring.
    const ring = this.add.circle(x, y, TILE * 0.6, 0xffe066, 0.7).setDepth(7);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
    this.cameras.main.flash(160, 253, 223, 106);
    // Flash the flag bright, then leave it subtly lit.
    const s = this.nearestCheckpointFlagMarker(x, y)?.sprite ?? null;
    if (s) {
      const baseX = s.scaleX;
      const baseY = s.scaleY;
      s.setTint(0xffffff);
      this.tweens.add({
        targets: s,
        scaleX: baseX * 1.4,
        scaleY: baseY * 1.4,
        duration: 160,
        yoyo: true,
        ease: 'Quad.easeOut',
        onComplete: () => {
          s.setScale(baseX, baseY);
          s.setTint(0xffe9a0); // stays warmly lit = "activated"
        },
      });
    }
  }

  private nearestCheckpointFlagTarget(
    x: number,
    y: number
  ): { point: Phaser.Math.Vector2; rank: number } {
    const marker = this.nearestCheckpointFlagMarker(x, y);
    if (!marker) return { point: new Phaser.Math.Vector2(x, y), rank: 0 };
    return {
      point: new Phaser.Math.Vector2(marker.sprite.x, marker.sprite.y),
      rank: marker.rank,
    };
  }

  private nearestCheckpointFlagMarker(
    x: number,
    y: number
  ): CheckpointFlagMarker | null {
    let best: CheckpointFlagMarker | null = null;
    let bestDist = Infinity;
    for (const marker of this.checkpointFlagMarkers) {
      const d = Phaser.Math.Distance.Squared(x, y, marker.sprite.x, marker.sprite.y);
      if (d < bestDist) {
        bestDist = d;
        best = marker;
      }
    }
    return best;
  }

  private checkpointRankForCell(col: number, row: number): number {
    const orderedRank = this.map.checkpointOrder.findIndex(
      (c) => c.col === col && c.row === row
    );
    if (orderedRank >= 0) return orderedRank;
    const discoveredRank = this.map.checkpoints.findIndex(
      (c) => c.col === col && c.row === row
    );
    return discoveredRank >= 0 ? discoveredRank : 0;
  }

  /**
   * Lava death, mirroring the bundle: on contact play the splash + a burst of
   * lava particles, then wait ~500ms (the ball keeps sinking) before returning
   * to the last checkpoint with the return sound. A guard stops it re-firing
   * during the delay.
   */
  /**
   * Lava death: play the splash SFX + a molten particle burst, then a ~500ms
   * drowning animation where the ball sinks into the lava (shrinks + fades)
   * before returning to the last checkpoint with the return sound. A guard
   * stops it re-firing, and the update loop yields the ball to this tween.
   */
  private hitWater() {
    if (this.finished || this.dying) return;
    this.dying = true;
    sound.play('LavaDrop', 0.6);
    this.spawnLavaBurst(this.ball.x, this.ball.y);
    this.cameras.main.flash(160, 255, 90, 20);

    // Freeze physics and snap the sprite to the ball, then sink it in.
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.ballBody.setAngvel(0, true);
    const t = this.ballBody.translation();
    this.ball.x = t.x * PIXELS_PER_METER;
    this.ball.y = t.y * PIXELS_PER_METER;

    // Burn-out: the ball ignites (bright orange), chars to dark, and fades away
    // while sinking slightly — it keeps its size (no shrinking).
    const startY = this.ball.y;
    const hot = Phaser.Display.Color.ValueToColor(0xffd23d);
    const char = Phaser.Display.Color.ValueToColor(0x2a0a06);
    const burn = { t: 0 };
    this.tweens.add({
      targets: burn,
      t: 1,
      duration: 520,
      ease: 'Quad.easeIn',
      onUpdate: () => {
        const c = Phaser.Display.Color.Interpolate.ColorWithColor(
          hot,
          char,
          100,
          Math.round(burn.t * 100)
        );
        this.ball.setTint(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
        this.ball.setAlpha(1 - burn.t);
        this.ball.y = startY + TILE * 0.35 * burn.t;
      },
      onComplete: () => {
        this.resetToRespawn();
        this.ball.clearTint();
        this.ball.setAlpha(1);
        this.ball.setScale(1, 1);
        sound.play('Back', 0.2);
        this.dying = false;
      },
    });
  }

  /** Small burst of fading molten particles at (x, y). */
  private spawnLavaBurst(x: number, y: number) {
    for (let i = 0; i < 8; i++) {
      const p = this.add.circle(
        x,
        y,
        1 + Math.random() * 2,
        Math.random() < 0.5 ? 0xff7a1a : 0xffd23d
      );
      p.setDepth(45);
      const ang = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 60;
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * spd,
        y: y + Math.sin(ang) * spd - 20,
        alpha: 0,
        duration: 400 + Math.random() * 200,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private finish() {
    this.finished = true;
    const timeMs = Math.round(this.time.now - this.startTime);
    this.ballBody.setLinvel({ x: 0, y: 0 }, true);
    this.cameras.main.flash(300, 253, 223, 106);
    sound.play('Claps', 0.6);
    this.onFinish?.(this.strokes, timeMs, [...this.moves]);
  }

  shutdown() {
    for (const cleanup of this.cleanupGameEvents) cleanup();
    this.cleanupGameEvents = [];
    this.eventQueue?.free();
    this.world?.free();
  }
}
