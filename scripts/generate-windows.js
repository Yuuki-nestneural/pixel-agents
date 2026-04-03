#!/usr/bin/env node
/**
 * Generate WINDOW furniture sprites for weather effects.
 * Creates 3 state variants: clear, rain, night
 * Each is a 32x32 PNG (2x2 tile wall-mounted item)
 */
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const WIDTH = 32;
const HEIGHT = 32;

function hexToRgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255;
  return [r, g, b, a];
}

function setPixel(png, x, y, hex) {
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const [r, g, b, a] = hexToRgba(hex);
  const idx = (y * WIDTH + x) * 4;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

function drawRect(png, x1, y1, w, h, color) {
  for (let y = y1; y < y1 + h; y++) {
    for (let x = x1; x < x1 + w; x++) {
      setPixel(png, x, y, color);
    }
  }
}

function drawBorder(png, x1, y1, w, h, color) {
  for (let x = x1; x < x1 + w; x++) {
    setPixel(png, x, y1, color);
    setPixel(png, x, y1 + h - 1, color);
  }
  for (let y = y1; y < y1 + h; y++) {
    setPixel(png, x1, y, color);
    setPixel(png, x1 + w - 1, y, color);
  }
}

function createPng() {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  // Fill transparent
  for (let i = 0; i < png.data.length; i++) png.data[i] = 0;
  return png;
}

function savePng(png, filepath) {
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filepath, buffer);
  console.log(`  Created: ${filepath}`);
}

// ── CLEAR window (sunny) ─────────────────────────────────────
function createClearWindow() {
  const png = createPng();
  const FRAME = '#6B5B3D'; // wooden frame
  const FRAME_DARK = '#4A3D2A'; // dark frame edge
  const SKY = '#87CEEB'; // sky blue
  const SKY_LIGHT = '#B0E2FF'; // light sky
  const CLOUD = '#FFFFFF'; // white cloud
  const SILL = '#8B7355'; // window sill

  // Outer wooden frame
  drawRect(png, 0, 0, 32, 32, FRAME);
  // Frame dark edge (top/left)
  drawRect(png, 0, 0, 32, 1, FRAME_DARK);
  drawRect(png, 0, 0, 1, 32, FRAME_DARK);

  // Glass panes - left pane
  drawRect(png, 3, 3, 12, 24, SKY);
  drawRect(png, 3, 3, 12, 8, SKY_LIGHT);

  // Glass panes - right pane
  drawRect(png, 17, 3, 12, 24, SKY);
  drawRect(png, 17, 3, 12, 8, SKY_LIGHT);

  // Center divider
  drawRect(png, 15, 2, 2, 26, FRAME);

  // Horizontal divider
  drawRect(png, 2, 15, 28, 2, FRAME);

  // Cloud in top-left pane
  drawRect(png, 5, 6, 6, 2, CLOUD);
  drawRect(png, 6, 5, 4, 1, CLOUD);
  drawRect(png, 6, 8, 4, 1, CLOUD);

  // Small cloud in top-right pane
  drawRect(png, 20, 8, 4, 2, CLOUD);
  drawRect(png, 21, 7, 2, 1, CLOUD);

  // Bottom sill
  drawRect(png, 0, 28, 32, 4, SILL);
  drawRect(png, 0, 28, 32, 1, FRAME_DARK);

  return png;
}

// ── RAIN window ──────────────────────────────────────────────
function createRainWindow() {
  const png = createPng();
  const FRAME = '#6B5B3D';
  const FRAME_DARK = '#4A3D2A';
  const SKY = '#607080'; // dark cloudy sky
  const SKY_DARK = '#505868'; // darker sky
  const RAIN = '#8899BB'; // rain streaks
  const SILL = '#8B7355';

  // Outer wooden frame
  drawRect(png, 0, 0, 32, 32, FRAME);
  drawRect(png, 0, 0, 32, 1, FRAME_DARK);
  drawRect(png, 0, 0, 1, 32, FRAME_DARK);

  // Glass panes - left
  drawRect(png, 3, 3, 12, 24, SKY);
  drawRect(png, 3, 3, 12, 6, SKY_DARK);

  // Glass panes - right
  drawRect(png, 17, 3, 12, 24, SKY);
  drawRect(png, 17, 3, 12, 6, SKY_DARK);

  // Center divider
  drawRect(png, 15, 2, 2, 26, FRAME);
  // Horizontal divider
  drawRect(png, 2, 15, 28, 2, FRAME);

  // Rain streaks on left pane
  setPixel(png, 5, 5, RAIN);
  setPixel(png, 5, 6, RAIN);
  setPixel(png, 8, 8, RAIN);
  setPixel(png, 8, 9, RAIN);
  setPixel(png, 11, 4, RAIN);
  setPixel(png, 11, 5, RAIN);
  setPixel(png, 6, 11, RAIN);
  setPixel(png, 6, 12, RAIN);
  setPixel(png, 10, 18, RAIN);
  setPixel(png, 10, 19, RAIN);
  setPixel(png, 4, 20, RAIN);
  setPixel(png, 4, 21, RAIN);
  setPixel(png, 8, 22, RAIN);
  setPixel(png, 8, 23, RAIN);
  setPixel(png, 12, 17, RAIN);
  setPixel(png, 12, 18, RAIN);

  // Rain streaks on right pane
  setPixel(png, 19, 6, RAIN);
  setPixel(png, 19, 7, RAIN);
  setPixel(png, 22, 4, RAIN);
  setPixel(png, 22, 5, RAIN);
  setPixel(png, 25, 9, RAIN);
  setPixel(png, 25, 10, RAIN);
  setPixel(png, 20, 11, RAIN);
  setPixel(png, 20, 12, RAIN);
  setPixel(png, 24, 18, RAIN);
  setPixel(png, 24, 19, RAIN);
  setPixel(png, 18, 21, RAIN);
  setPixel(png, 18, 22, RAIN);
  setPixel(png, 26, 22, RAIN);
  setPixel(png, 26, 23, RAIN);

  // Bottom sill
  drawRect(png, 0, 28, 32, 4, SILL);
  drawRect(png, 0, 28, 32, 1, FRAME_DARK);

  return png;
}

// ── NIGHT window ─────────────────────────────────────────────
function createNightWindow() {
  const png = createPng();
  const FRAME = '#5B4B2D'; // slightly darker frame at night
  const FRAME_DARK = '#3A2D1A';
  const SKY = '#1A1A3A'; // dark night sky
  const SKY_DEEP = '#0D0D2A'; // deeper sky
  const STAR = '#FFFFCC'; // warm star
  const STAR_DIM = '#AAAACC'; // dim star
  const MOON = '#EEEEDD'; // moonlight
  const SILL = '#7B6345';

  // Outer wooden frame
  drawRect(png, 0, 0, 32, 32, FRAME);
  drawRect(png, 0, 0, 32, 1, FRAME_DARK);
  drawRect(png, 0, 0, 1, 32, FRAME_DARK);

  // Glass panes - left
  drawRect(png, 3, 3, 12, 24, SKY);
  drawRect(png, 3, 3, 12, 10, SKY_DEEP);

  // Glass panes - right
  drawRect(png, 17, 3, 12, 24, SKY);
  drawRect(png, 17, 3, 12, 10, SKY_DEEP);

  // Center divider
  drawRect(png, 15, 2, 2, 26, FRAME);
  // Horizontal divider
  drawRect(png, 2, 15, 28, 2, FRAME);

  // Moon in top-right pane
  drawRect(png, 23, 5, 3, 3, MOON);
  drawRect(png, 24, 4, 2, 1, MOON);
  drawRect(png, 24, 8, 2, 1, MOON);
  setPixel(png, 22, 6, MOON);
  setPixel(png, 26, 6, MOON);

  // Stars in left pane
  setPixel(png, 6, 5, STAR);
  setPixel(png, 10, 7, STAR_DIM);
  setPixel(png, 4, 10, STAR);
  setPixel(png, 12, 4, STAR_DIM);
  setPixel(png, 8, 19, STAR_DIM);
  setPixel(png, 5, 22, STAR);
  setPixel(png, 11, 24, STAR_DIM);

  // Stars in right pane
  setPixel(png, 19, 9, STAR_DIM);
  setPixel(png, 27, 7, STAR);
  setPixel(png, 21, 19, STAR);
  setPixel(png, 25, 22, STAR_DIM);
  setPixel(png, 18, 25, STAR);

  // Bottom sill
  drawRect(png, 0, 28, 32, 4, SILL);
  drawRect(png, 0, 28, 32, 1, FRAME_DARK);

  return png;
}

// ── Main ─────────────────────────────────────────────────────
const outDir = path.join(__dirname, '..', 'webview-ui', 'public', 'assets', 'furniture', 'WINDOW');
fs.mkdirSync(outDir, { recursive: true });

console.log('Generating WINDOW sprites...');
savePng(createClearWindow(), path.join(outDir, 'WINDOW_CLEAR.png'));
savePng(createRainWindow(), path.join(outDir, 'WINDOW_RAIN.png'));
savePng(createNightWindow(), path.join(outDir, 'WINDOW_NIGHT.png'));

// Create manifest
const manifest = {
  id: 'WINDOW',
  name: 'Window',
  category: 'wall',
  type: 'group',
  groupType: 'state',
  canPlaceOnWalls: true,
  canPlaceOnSurfaces: false,
  backgroundTiles: 0,
  members: [
    {
      type: 'asset',
      id: 'WINDOW_CLEAR',
      file: 'WINDOW_CLEAR.png',
      width: 32,
      height: 32,
      footprintW: 2,
      footprintH: 2,
      state: 'off',
    },
    {
      type: 'asset',
      id: 'WINDOW_RAIN',
      file: 'WINDOW_RAIN.png',
      width: 32,
      height: 32,
      footprintW: 2,
      footprintH: 2,
      state: 'on',
    },
    {
      type: 'asset',
      id: 'WINDOW_NIGHT',
      file: 'WINDOW_NIGHT.png',
      width: 32,
      height: 32,
      footprintW: 2,
      footprintH: 2,
      state: 'night',
    },
  ],
};

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`  Created: ${path.join(outDir, 'manifest.json')}`);
console.log('Done!');
