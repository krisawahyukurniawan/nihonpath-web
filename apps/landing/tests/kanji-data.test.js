import test from 'node:test';
import assert from 'node:assert/strict';
import { kanjiData } from '../web/kanji-data.js';

// All 17 requested glyphs, in design order (the brief's count of 16 is a typo).
const expected = [
  ['日', 4, 'ひ', 'hi', 'sun/day', 'matahari/hari'],
  ['月', 4, 'つき', 'tsuki', 'moon/month', 'bulan'],
  ['山', 3, 'やま', 'yama', 'mountain', 'gunung'],
  ['川', 3, 'かわ', 'kawa', 'river', 'sungai'],
  ['水', 4, 'みず', 'mizu', 'water', 'air'],
  ['火', 4, 'ひ', 'hi', 'fire', 'api'],
  ['木', 4, 'き', 'ki', 'tree', 'pohon'],
  ['人', 2, 'ひと', 'hito', 'person', 'orang'],
  ['口', 3, 'くち', 'kuchi', 'mouth', 'mulut'],
  ['心', 4, 'こころ', 'kokoro', 'heart', 'hati'],
  ['友', 4, 'とも', 'tomo', 'friend', 'teman'],
  ['空', 8, 'そら', 'sora', 'sky', 'langit'],
  ['雨', 8, 'あめ', 'ame', 'rain', 'hujan'],
  ['花', 7, 'はな', 'hana', 'flower', 'bunga'],
  ['学', 8, 'がく', 'gaku', 'learning', 'pembelajaran'],
  ['旅', 10, 'たび', 'tabi', 'journey', 'perjalanan'],
  ['道', 12, 'みち', 'michi', 'path', 'jalan'],
];

const fields = ['kanji', 'strokes', 'kana', 'romaji', 'english', 'indonesian', 'paths'];

test('contains exactly 17 unique kanji in the requested order', () => {
  assert.ok(Array.isArray(kanjiData));
  assert.equal(kanjiData.length, 17);
  assert.equal(new Set(kanjiData.map(({ kanji }) => kanji)).size, 17);
  assert.deepEqual(kanjiData.map(({ kanji }) => kanji), expected.map(([kanji]) => kanji));
});

test('entries have exactly the required fields', () => {
  for (const entry of kanjiData) {
    assert.deepEqual(Object.keys(entry).sort(), [...fields].sort(), entry.kanji);
    for (const field of ['kanji', 'kana', 'romaji', 'english', 'indonesian']) {
      assert.equal(typeof entry[field], 'string', `${entry.kanji}: ${field}`);
      assert.ok(entry[field].trim().length > 0, `${entry.kanji}: nonempty ${field}`);
    }
  }
});

test('stroke counts match the expected counts and nonempty path arrays', () => {
  for (const [kanji, strokes] of expected) {
    const entry = kanjiData.find((item) => item.kanji === kanji);
    assert.ok(entry, `${kanji}: present`);
    assert.ok(Number.isInteger(entry.strokes), `${kanji}: integer stroke count`);
    assert.equal(entry.strokes, strokes, `${kanji}: expected stroke count`);
    assert.ok(Array.isArray(entry.paths), `${kanji}: path array`);
    assert.equal(entry.paths.length, strokes, `${kanji}: one path per stroke`);
    assert.equal(new Set(entry.paths).size, strokes, `${kanji}: distinct stroke paths`);
    for (const [index, path] of entry.paths.entries()) {
      assert.equal(typeof path, 'string', `${kanji}: stroke ${index + 1}`);
      assert.ok(path.trim().length > 0, `${kanji}: nonempty stroke ${index + 1}`);
      assert.match(path, /^M[-\d.]/, `${kanji}: stroke ${index + 1} starts with moveto`);
    }
  }
  assert.equal(kanjiData.reduce((total, { paths }) => total + paths.length, 0), 92);
});

test('kana, romaji, and translations match the chosen common readings', () => {
  assert.deepEqual(
    kanjiData.map(({ kanji, strokes, kana, romaji, english, indonesian }) => [
      kanji, strokes, kana, romaji, english, indonesian,
    ]),
    expected,
  );
});
