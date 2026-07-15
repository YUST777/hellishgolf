// The shared project tsconfig resolves Devvit's server condition during type-check;
// Vite resolves this browser export for the splash entrypoint at build time.
// @ts-expect-error requestExpandedMode is present in the browser export.
import { requestExpandedMode } from "@devvit/web/client";
import { apiClient } from "./game/api";
import { DIRT_FRAME, SOURCE_TILE } from "./game/config";
import { mapUrl } from "../shared/mapManifest";
import { parseTiledMap, type RuntimeMap } from "../shared/tiled";
import { cleanGid, roleOfGid, TILESET } from "../shared/tiles";

const canvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const preview = document.getElementById("game-preview") as HTMLElement;
const play = document.getElementById("play") as HTMLButtonElement;
const webViewWindow = window as Window & {
  devvit?: { entrypoints?: Record<string, string> };
};

function text(id: string, value: string) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

function drawAtlasFrame(
  ctx: CanvasRenderingContext2D,
  atlas: HTMLImageElement,
  frame: number,
  x: number,
  y: number,
  size: number,
) {
  const sx = (frame % TILESET.columns) * SOURCE_TILE;
  const sy = Math.floor(frame / TILESET.columns) * SOURCE_TILE;
  ctx.drawImage(
    atlas,
    sx,
    sy,
    SOURCE_TILE,
    SOURCE_TILE,
    x,
    y,
    size + 1,
    size + 1,
  );
}

function drawPreview(map: RuntimeMap, atlas: HTMLImageElement) {
  const rect = preview.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const dirt = document.createElement("canvas");
  dirt.width = 32;
  dirt.height = 32;
  const dirtCtx = dirt.getContext("2d");
  if (dirtCtx) {
    dirtCtx.imageSmoothingEnabled = false;
    drawAtlasFrame(dirtCtx, atlas, DIRT_FRAME, 0, 0, 32);
    const pattern = ctx.createPattern(dirt, "repeat");
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
    }
  }

  const tile = Math.max(24, Math.min(38, width / 18));
  const mapWidth = map.cols * tile;
  const mapHeight = map.rows * tile;
  const ballWorldX = (map.spawn.col + 0.5) * tile;
  const ballWorldY = (map.spawn.row + 0.5) * tile;
  const originX = width * 0.5 - ballWorldX;
  const originY = height * 0.55 - ballWorldY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(originX, originY, mapWidth, mapHeight);
  ctx.clip();
  const grid = Math.max(62, tile * 3.2);
  for (
    let y = Math.floor(-originY / grid) * grid;
    y < -originY + height + grid;
    y += grid
  ) {
    for (
      let x = Math.floor(-originX / grid) * grid;
      x < -originX + width + grid;
      x += grid
    ) {
      const even = (Math.floor(x / grid) + Math.floor(y / grid)) % 2 === 0;
      ctx.fillStyle = even ? "#8d786f" : "#79675f";
      ctx.fillRect(originX + x, originY + y, grid + 1, grid + 1);
    }
  }
  ctx.restore();

  const firstCol = Math.max(0, Math.floor(-originX / tile) - 1);
  const lastCol = Math.min(
    map.cols - 1,
    Math.ceil((width - originX) / tile) + 1,
  );
  const firstRow = Math.max(0, Math.floor(-originY / tile) - 1);
  const lastRow = Math.min(
    map.rows - 1,
    Math.ceil((height - originY) / tile) + 1,
  );

  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const gid = map.gids[row * map.cols + col] ?? 0;
      if (gid <= 0 || roleOfGid(gid) === "decor") continue;
      const frame = cleanGid(gid) - 1;
      if (frame < 0 || frame >= TILESET.columns * TILESET.rows) continue;
      drawAtlasFrame(
        ctx,
        atlas,
        frame,
        originX + col * tile,
        originY + row * tile,
        tile,
      );
    }
  }

  const ballX = originX + ballWorldX;
  const ballY = originY + ballWorldY;
  const ballRadius = Math.max(13, tile * 0.53);

  ctx.save();
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 232, 187, 0.9)";
  ctx.beginPath();
  ctx.moveTo(ballX, ballY);
  ctx.lineTo(ballX - tile * 2.2, ballY + tile * 1.5);
  ctx.stroke();
  ctx.setLineDash([]);

  const glow = ctx.createRadialGradient(
    ballX,
    ballY,
    2,
    ballX,
    ballY,
    ballRadius * 2.2,
  );
  glow.addColorStop(0, "rgba(255, 172, 70, 0.42)");
  glow.addColorStop(1, "rgba(255, 90, 20, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballRadius * 2.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f8f7ee";
  ctx.strokeStyle = "#171717";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

async function bootPreview() {
  const [data, atlas] = await Promise.all([
    apiClient.init(),
    loadImage("game/tilemap/tileset.png"),
  ]);
  const response = await fetch(mapUrl(data.mapId));
  if (!response.ok) throw new Error(`Failed to load map ${data.mapId}`);
  const map = parseTiledMap(await response.json());

  text("preview-day", data.daily.dateKey);
  text("preview-hole", `#${data.daily.holeNumber}`);
  text("preview-best", data.bestToday == null ? "-" : String(data.bestToday));

  const render = () => drawPreview(map, atlas);
  render();
  new ResizeObserver(render).observe(preview);
}

play.addEventListener("click", (event) => {
  try {
    if (webViewWindow.devvit?.entrypoints?.game) {
      requestExpandedMode(event, "game");
      return;
    }
  } catch (error) {
    console.error("Unable to open expanded game", error);
  }
  window.location.assign(`game.html${window.location.search}`);
});

void bootPreview().catch((error) => {
  console.error("Preview failed to load", error);
  text("preview-day", "Daily hole ready");
});
