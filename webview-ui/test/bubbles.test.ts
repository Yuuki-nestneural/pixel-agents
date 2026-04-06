/**
 * Unit tests for bubble sprite data, furniture bubble mapping,
 * and character idle interaction behaviors.
 *
 * Run with: cd webview-ui && npm test
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Bubble Sprite JSON Validation ───────────────────────────────

const BUBBLE_FILES = [
  'bubble-book.json',
  'bubble-coffee.json',
  'bubble-permission.json',
  'bubble-waiting.json',
  'bubble-water.json',
  'bubble-thought.json',
  'bubble-plant.json',
  'bubble-fridge.json',
];

for (const filename of BUBBLE_FILES) {
  test(`bubble sprite ${filename} has valid structure`, () => {
    const filePath = path.join(root, 'src', 'office', 'sprites', filename);
    assert.ok(fs.existsSync(filePath), `File does not exist: ${filePath}`);

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Must have palette and pixels
    assert.ok(data.palette, `${filename} missing palette`);
    assert.ok(data.pixels, `${filename} missing pixels`);
    assert.ok(typeof data.palette === 'object', `${filename} palette not object`);
    assert.ok(Array.isArray(data.pixels), `${filename} pixels not array`);

    // Pixels must be a 2D array of strings
    assert.ok(data.pixels.length > 0, `${filename} pixels empty`);
    for (let row = 0; row < data.pixels.length; row++) {
      assert.ok(Array.isArray(data.pixels[row]), `${filename} row ${row} not array`);
    }

    // All rows should have the same width
    const width = data.pixels[0].length;
    for (let row = 0; row < data.pixels.length; row++) {
      assert.equal(
        data.pixels[row].length,
        width,
        `${filename} row ${row} has width ${data.pixels[row].length}, expected ${width}`,
      );
    }

    // Palette keys should match pixel references
    const paletteKeys = new Set(Object.keys(data.palette));
    paletteKeys.add('.'); // transparent

    for (let row = 0; row < data.pixels.length; row++) {
      for (let col = 0; col < data.pixels[row].length; col++) {
        const cell = data.pixels[row][col];
        assert.ok(
          paletteKeys.has(cell),
          `${filename} pixel [${row}][${col}] = '${cell}' not in palette`,
        );
      }
    }
  });
}

test('all bubble sprites are 11x13 (standard bubble size)', () => {
  for (const filename of BUBBLE_FILES) {
    const filePath = path.join(root, 'src', 'office', 'sprites', filename);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const height = data.pixels.length;
    const width = data.pixels[0].length;

    assert.equal(width, 11, `${filename} width is ${width}, expected 11`);
    assert.equal(height, 13, `${filename} height is ${height}, expected 13`);
  }
});

// ── Bubble Type Coverage ────────────────────────────────────────

test('spriteData.ts imports all bubble JSON files', () => {
  const spriteDataPath = path.join(root, 'src', 'office', 'sprites', 'spriteData.ts');
  const content = fs.readFileSync(spriteDataPath, 'utf-8');

  for (const filename of BUBBLE_FILES) {
    const importName = filename.replace('.json', '');
    assert.ok(content.includes(importName), `spriteData.ts does not import ${importName}`);
  }
});

test('spriteData.ts exports BUBBLE_*_SPRITE for all types', () => {
  const spriteDataPath = path.join(root, 'src', 'office', 'sprites', 'spriteData.ts');
  const content = fs.readFileSync(spriteDataPath, 'utf-8');

  const expectedExports = [
    'BUBBLE_BOOK_SPRITE',
    'BUBBLE_COFFEE_SPRITE',
    'BUBBLE_PERMISSION_SPRITE',
    'BUBBLE_WAITING_SPRITE',
    'BUBBLE_WATER_SPRITE',
    'BUBBLE_THOUGHT_SPRITE',
    'BUBBLE_PLANT_SPRITE',
    'BUBBLE_FRIDGE_SPRITE',
  ];

  for (const name of expectedExports) {
    assert.ok(content.includes(`export const ${name}`), `spriteData.ts does not export ${name}`);
  }
});

// ── Renderer Bubble Completeness ────────────────────────────────

test('renderer.ts has switch cases for all bubble types', () => {
  const rendererPath = path.join(root, 'src', 'office', 'engine', 'renderer.ts');
  const content = fs.readFileSync(rendererPath, 'utf-8');

  const requiredCases = [
    "'permission'",
    "'coffee'",
    "'book'",
    "'water'",
    "'thought'",
    "'plant'",
    "'fridge'",
  ];

  for (const c of requiredCases) {
    assert.ok(content.includes(`case ${c}`), `renderer.ts missing case for ${c}`);
  }
});

test('renderer.ts includes all timed bubble types in fade check', () => {
  const rendererPath = path.join(root, 'src', 'office', 'engine', 'renderer.ts');
  const content = fs.readFileSync(rendererPath, 'utf-8');

  const timedTypes = ['waiting', 'coffee', 'book', 'water', 'thought', 'plant', 'fridge'];
  for (const t of timedTypes) {
    assert.ok(
      content.includes(`ch.bubbleType === '${t}'`),
      `renderer.ts timed check missing '${t}'`,
    );
  }
});

// ── Furniture Bubble Map ────────────────────────────────────────

test('officeState.ts FURNITURE_BUBBLE_MAP covers all interactive furniture types', () => {
  const osPath = path.join(root, 'src', 'office', 'engine', 'officeState.ts');
  const content = fs.readFileSync(osPath, 'utf-8');

  const expectedFurniture = [
    'COFFEE',
    'COFFEE_TABLE',
    'BOOKSHELF',
    'DOUBLE_BOOKSHELF',
    'WATER_COOLER',
    'FRIDGE',
    'PLANT',
    'PLANT_2',
    'LARGE_PLANT',
    'SMALL_PLANT',
    'CACTUS',
  ];

  for (const f of expectedFurniture) {
    assert.ok(content.includes(`${f}:`), `FURNITURE_BUBBLE_MAP missing entry for ${f}`);
  }
});

// ── Type Definitions ────────────────────────────────────────────

test('types.ts bubbleType union includes all bubble types', () => {
  const typesPath = path.join(root, 'src', 'office', 'types.ts');
  const content = fs.readFileSync(typesPath, 'utf-8');

  const allTypes = [
    'permission',
    'waiting',
    'coffee',
    'book',
    'water',
    'thought',
    'plant',
    'fridge',
  ];
  for (const t of allTypes) {
    assert.ok(content.includes(`'${t}'`), `types.ts bubbleType missing '${t}'`);
  }
});

test('types.ts wanderBubble union includes furniture interaction types', () => {
  const typesPath = path.join(root, 'src', 'office', 'types.ts');
  const content = fs.readFileSync(typesPath, 'utf-8');

  // wanderBubble should include furniture types (not permission/waiting/thought)
  const wanderTypes = ['coffee', 'book', 'water', 'plant', 'fridge'];
  for (const t of wanderTypes) {
    assert.ok(content.includes(`'${t}'`), `types.ts wanderBubble missing '${t}'`);
  }
});

// ── Constants ───────────────────────────────────────────────────

test('constants.ts has thought bubble constants', () => {
  const constPath = path.join(root, 'src', 'constants.ts');
  const content = fs.readFileSync(constPath, 'utf-8');

  assert.ok(
    content.includes('WANDER_THOUGHT_CHANCE'),
    'constants.ts missing WANDER_THOUGHT_CHANCE',
  );
  assert.ok(
    content.includes('THOUGHT_BUBBLE_DURATION_SEC'),
    'constants.ts missing THOUGHT_BUBBLE_DURATION_SEC',
  );
});

// ── Characters.ts ───────────────────────────────────────────────

test('characters.ts InteractableFurniture includes all furniture bubble types', () => {
  const charsPath = path.join(root, 'src', 'office', 'engine', 'characters.ts');
  const content = fs.readFileSync(charsPath, 'utf-8');

  const furnitureTypes = ['coffee', 'book', 'water', 'plant', 'fridge'];
  for (const t of furnitureTypes) {
    assert.ok(content.includes(`'${t}'`), `characters.ts InteractableFurniture missing '${t}'`);
  }
});

test('characters.ts imports thought bubble constants', () => {
  const charsPath = path.join(root, 'src', 'office', 'engine', 'characters.ts');
  const content = fs.readFileSync(charsPath, 'utf-8');

  assert.ok(
    content.includes('THOUGHT_BUBBLE_DURATION_SEC'),
    'characters.ts missing THOUGHT_BUBBLE_DURATION_SEC import',
  );
  assert.ok(
    content.includes('WANDER_THOUGHT_CHANCE'),
    'characters.ts missing WANDER_THOUGHT_CHANCE import',
  );
});
