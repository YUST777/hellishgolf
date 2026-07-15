(function () {
  "use strict";

  var MAP_IDS = [
    1, 2, 450, 451, 452, 453, 454, 455, 456, 457, 458, 459, 460, 461, 462, 463,
    464, 465, 466, 467, 468, 469, 470,
  ];
  var TILE_SOURCE = 16;
  var TILE_RENDER = 32;
  var TILES_PER_ROW = 33;
  var canvas = document.getElementById("boot-preview-canvas");
  var preview = document.getElementById("boot-preview");
  var status = document.getElementById("boot-preview-status");
  if (!(canvas instanceof HTMLCanvasElement) || !preview || !status) return;

  var context = canvas.getContext("2d", { alpha: false });
  if (!context) return;
  context.imageSmoothingEnabled = false;

  var state = {
    map: null,
    tileset: null,
    spawn: { col: 1, row: 1 },
    startTime: performance.now(),
    animationFrame: 0,
    stopped: false,
    pixelRatio: 1,
  };

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function hashDate(value) {
    var hash = 2166136261 >>> 0;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function offlineInit() {
    var dateKey = todayKey();
    var seed = hashDate(dateKey);
    var mapId = MAP_IDS[seed % MAP_IDS.length];
    var epoch = Date.UTC(2025, 0, 1);
    var holeNumber = Math.floor((Date.parse(dateKey) - epoch) / 86400000) + 1;
    return {
      postId: "offline",
      accountId: null,
      username: null,
      daily: {
        dateKey: dateKey,
        holeNumber: holeNumber,
        seed: seed,
        mapId: mapId,
      },
      bestToday: null,
      streak: 0,
      mapId: mapId,
      player: null,
    };
  }

  function fetchJson(url) {
    return fetch(url).then(function (response) {
      if (!response.ok) throw new Error("Request failed: " + response.status);
      return response.json();
    });
  }

  function imagePromise(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.decoding = "async";
      image.onload = function () {
        resolve(image);
      };
      image.onerror = reject;
      image.src = url;
    });
  }

  function tileData(map) {
    if (!map || !Array.isArray(map.layers)) return [];
    for (var i = 0; i < map.layers.length; i++) {
      if (Array.isArray(map.layers[i].data)) return map.layers[i].data;
    }
    return [];
  }

  function solid(gid) {
    var id = (gid & 0x1fffffff) - 1;
    return (
      gid > 0 &&
      id !== 10 &&
      id !== 11 &&
      id !== 152 &&
      id !== 153 &&
      id !== 175 &&
      id !== 208
    );
  }

  function deriveSpawn(map) {
    var data = tileData(map);
    var cols = map.width || 1;
    var rows = map.height || 1;
    var finish = { col: Math.floor(cols / 2), row: 1 };
    for (var i = 0; i < data.length; i++) {
      if ((data[i] & 0x1fffffff) - 1 === 153) {
        finish = { col: i % cols, row: Math.floor(i / cols) };
        break;
      }
    }

    var best = { col: 1, row: Math.max(1, rows - 2) };
    var bestDistance = -1;
    for (var row = 0; row < rows - 1; row++) {
      for (var col = 0; col < cols; col++) {
        var here = data[row * cols + col] || 0;
        var below = data[(row + 1) * cols + col] || 0;
        if (here !== 0 || !solid(below)) continue;
        var dx = col - finish.col;
        var dy = row - finish.row;
        var distance = dx * dx + dy * dy;
        if (distance > bestDistance) {
          best = { col: col, row: row };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  function resize() {
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.max(1, Math.floor(window.innerWidth * ratio));
    var height = Math.max(1, Math.floor(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    state.pixelRatio = ratio;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = false;
  }

  function drawBackground(width, height) {
    var gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#160604");
    gradient.addColorStop(0.56, "#52120a");
    gradient.addColorStop(1, "#9a2c12");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = "rgba(255, 119, 35, 0.08)";
    for (var y = 0; y < height; y += 64) {
      for (var x = (y / 64) % 2 ? -32 : 0; x < width; x += 64) {
        context.fillRect(x, y, 32, 32);
      }
    }
  }

  function drawMap(width, height, elapsed) {
    var map = state.map;
    var tileset = state.tileset;
    if (!map || !tileset) return;
    var data = tileData(map);
    var mapWidth = map.width * TILE_RENDER;
    var mapHeight = map.height * TILE_RENDER;
    var spawnX = (state.spawn.col + 0.5) * TILE_RENDER;
    var spawnY = (state.spawn.row + 0.5) * TILE_RENDER;
    var zoom = Math.max(0.36, Math.min(0.72, width / Math.max(mapWidth, 900)));
    var cameraX = spawnX - width / (2 * zoom);
    var cameraY = spawnY - height / (2 * zoom);
    cameraX += Math.sin(elapsed * 0.00016) * Math.min(120, mapWidth * 0.04);
    cameraY -=
      (0.5 + 0.5 * Math.sin(elapsed * 0.00012)) *
      Math.min(180, mapHeight * 0.06);
    cameraX = Math.max(-80, Math.min(mapWidth - width / zoom + 80, cameraX));
    cameraY = Math.max(-80, Math.min(mapHeight - height / zoom + 80, cameraY));

    context.save();
    context.scale(zoom, zoom);
    context.translate(-cameraX, -cameraY);
    var minCol = Math.max(0, Math.floor(cameraX / TILE_RENDER) - 1);
    var maxCol = Math.min(
      map.width - 1,
      Math.ceil((cameraX + width / zoom) / TILE_RENDER) + 1,
    );
    var minRow = Math.max(0, Math.floor(cameraY / TILE_RENDER) - 1);
    var maxRow = Math.min(
      map.height - 1,
      Math.ceil((cameraY + height / zoom) / TILE_RENDER) + 1,
    );

    for (var row = minRow; row <= maxRow; row++) {
      for (var col = minCol; col <= maxCol; col++) {
        var gid = (data[row * map.width + col] || 0) & 0x1fffffff;
        if (gid <= 0) continue;
        var frame = gid - 1;
        var sourceX = (frame % TILES_PER_ROW) * TILE_SOURCE;
        var sourceY = Math.floor(frame / TILES_PER_ROW) * TILE_SOURCE;
        context.drawImage(
          tileset,
          sourceX,
          sourceY,
          TILE_SOURCE,
          TILE_SOURCE,
          col * TILE_RENDER,
          row * TILE_RENDER,
          TILE_RENDER,
          TILE_RENDER,
        );
      }
    }

    var ballX = spawnX + Math.sin(elapsed * 0.0011) * 58;
    var bounce = Math.abs(Math.sin(elapsed * 0.0021));
    var ballY = spawnY - 22 - bounce * 44;
    var screenBallX = (ballX - cameraX) * zoom;
    var screenBallY = (ballY - cameraY) * zoom;
    var screenGroundY = (spawnY - cameraY) * zoom;
    context.restore();

    context.fillStyle = "rgba(0, 0, 0, 0.28)";
    context.beginPath();
    context.ellipse(
      screenBallX + 2,
      screenGroundY + 2,
      13 - bounce * 3,
      5 - bounce,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = "#f7f3e8";
    context.strokeStyle = "#2a2b2d";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(screenBallX, screenBallY, 13, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.72)";
    context.beginPath();
    context.arc(screenBallX - 4, screenBallY - 5, 3.5, 0, Math.PI * 2);
    context.fill();
  }

  function render(now) {
    if (state.stopped) return;
    resize();
    var width = window.innerWidth;
    var height = window.innerHeight;
    var elapsed = now - state.startTime;
    drawBackground(width, height);
    drawMap(width, height, elapsed);
    state.animationFrame = requestAnimationFrame(render);
  }

  function revealGame() {
    if (state.stopped) return;
    state.stopped = true;
    cancelAnimationFrame(state.animationFrame);
    document.body.classList.remove("booting");
    preview.classList.add("is-ready");
    window.setTimeout(function () {
      preview.remove();
    }, 220);
  }

  function fail(message) {
    status.textContent = message;
  }

  var bridge = {
    initPromise: null,
    mapPromise: null,
    mapId: null,
    fail: fail,
  };
  var initPromise = fetchJson("/api/init")
    .catch(function () {
      return offlineInit();
    })
    .then(function (data) {
      bridge.mapId = Number(data.mapId);
      bridge.mapPromise = fetchJson(
        "game/tilemap/map-" + bridge.mapId + ".json",
      );
      return data;
    });
  bridge.initPromise = initPromise;
  window.__hellishGolfBoot = bridge;
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("hellish-golf-ready", revealGame, { once: true });
  state.animationFrame = requestAnimationFrame(render);

  initPromise
    .then(function () {
      return Promise.all([
        bridge.mapPromise,
        imagePromise("game/tilemap/tileset.webp"),
      ]);
    })
    .then(function (assets) {
      state.map = assets[0];
      state.tileset = assets[1];
      state.spawn = deriveSpawn(state.map);
      status.textContent = "Preparing today's hole";
    })
    .catch(function () {
      fail("Preparing today's hole");
    });
})();
