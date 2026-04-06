import {
  RAIN_DROP_COLOR,
  RAIN_DROP_COUNT,
  RAIN_DROP_MAX_LENGTH,
  RAIN_DROP_MAX_SPEED,
  RAIN_DROP_MIN_LENGTH,
  RAIN_DROP_MIN_SPEED,
  RAIN_SPLASH_COLOR,
  RAIN_SPLASH_DURATION_SEC,
  RAIN_WIND_ANGLE,
} from '../../constants.js';
import { TILE_SIZE } from '../types.js';

interface RainDrop {
  x: number; // position in sprite-pixel coords
  y: number;
  speed: number; // pixels per second
  length: number; // streak length in pixels
}

interface RainSplash {
  x: number;
  y: number;
  age: number; // seconds since created
}

export interface RainState {
  drops: RainDrop[];
  splashes: RainSplash[];
  active: boolean;
}

export function createRainState(): RainState {
  return { drops: [], splashes: [], active: false };
}

function randomDrop(cols: number, rows: number): RainDrop {
  const mapW = cols * TILE_SIZE;
  const mapH = rows * TILE_SIZE;
  return {
    x: Math.random() * mapW,
    y: Math.random() * mapH,
    speed: RAIN_DROP_MIN_SPEED + Math.random() * (RAIN_DROP_MAX_SPEED - RAIN_DROP_MIN_SPEED),
    length: RAIN_DROP_MIN_LENGTH + Math.random() * (RAIN_DROP_MAX_LENGTH - RAIN_DROP_MIN_LENGTH),
  };
}

function spawnDropAtTop(cols: number): RainDrop {
  const mapW = cols * TILE_SIZE;
  return {
    x: Math.random() * mapW,
    y: -10,
    speed: RAIN_DROP_MIN_SPEED + Math.random() * (RAIN_DROP_MAX_SPEED - RAIN_DROP_MIN_SPEED),
    length: RAIN_DROP_MIN_LENGTH + Math.random() * (RAIN_DROP_MAX_LENGTH - RAIN_DROP_MIN_LENGTH),
  };
}

export function updateRain(
  rain: RainState,
  dt: number,
  isRaining: boolean,
  cols: number,
  rows: number,
): void {
  const mapH = rows * TILE_SIZE;

  // Toggle active state
  if (isRaining && !rain.active) {
    rain.active = true;
    // Spawn initial drops spread across the map
    rain.drops = [];
    for (let i = 0; i < RAIN_DROP_COUNT; i++) {
      rain.drops.push(randomDrop(cols, rows));
    }
  } else if (!isRaining && rain.active) {
    // Let existing drops fall off, don't spawn new ones
    if (rain.drops.length === 0 && rain.splashes.length === 0) {
      rain.active = false;
    }
  }

  if (!rain.active) return;

  // Update drops
  const windDx = Math.sin(RAIN_WIND_ANGLE);
  const windDy = Math.cos(RAIN_WIND_ANGLE);

  for (let i = rain.drops.length - 1; i >= 0; i--) {
    const drop = rain.drops[i];
    drop.x += drop.speed * windDx * dt;
    drop.y += drop.speed * windDy * dt;

    // If gone off bottom, create splash and recycle or remove
    if (drop.y > mapH) {
      rain.splashes.push({ x: drop.x, y: mapH - 1, age: 0 });
      if (isRaining) {
        // Recycle drop at top
        const newDrop = spawnDropAtTop(cols);
        rain.drops[i] = newDrop;
      } else {
        // Remove drop (draining)
        rain.drops.splice(i, 1);
      }
    }
  }

  // Update splashes
  for (let i = rain.splashes.length - 1; i >= 0; i--) {
    rain.splashes[i].age += dt;
    if (rain.splashes[i].age >= RAIN_SPLASH_DURATION_SEC) {
      rain.splashes.splice(i, 1);
    }
  }
}

export function renderRain(
  ctx: CanvasRenderingContext2D,
  rain: RainState,
  offsetX: number,
  offsetY: number,
  zoom: number,
): void {
  if (!rain.active && rain.drops.length === 0) return;

  const windDx = Math.sin(RAIN_WIND_ANGLE);
  const windDy = Math.cos(RAIN_WIND_ANGLE);

  // Draw rain streaks
  ctx.strokeStyle = RAIN_DROP_COLOR;
  ctx.lineWidth = Math.max(1, zoom * 0.5);
  ctx.beginPath();
  for (const drop of rain.drops) {
    const sx = offsetX + drop.x * zoom;
    const sy = offsetY + drop.y * zoom;
    const ex = sx - windDx * drop.length * zoom;
    const ey = sy - windDy * drop.length * zoom;
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
  }
  ctx.stroke();

  // Draw splashes
  if (rain.splashes.length > 0) {
    ctx.fillStyle = RAIN_SPLASH_COLOR;
    for (const splash of rain.splashes) {
      const progress = splash.age / RAIN_SPLASH_DURATION_SEC;
      const radius = (1 + progress * 2) * zoom;
      const alpha = 1 - progress;
      ctx.globalAlpha = alpha;
      const sx = offsetX + splash.x * zoom;
      const sy = offsetY + splash.y * zoom;
      // Small horizontal splash line instead of circle
      ctx.fillRect(sx - radius, sy, radius * 2, Math.max(1, zoom * 0.3));
    }
    ctx.globalAlpha = 1;
  }
}
