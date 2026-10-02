// Generates the brand assets in public/ from pixel maps, with no image dependencies:
//   favicon.svg, sprites.svg, apple-touch-icon.png, og.png
// Run with `npm run brand` after changing the mark; the outputs are committed.

import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));

// Palette: keep in sync with the dark tokens in src/styles/global.css.
const PALETTE: Record<string, string> = {
  k: '#1b1812', // tile / background
  l: '#4a3f2c', // line
  c: '#f1e4c3', // cream
  a: '#f2a93b', // amber accent
  b: '#9b7a43', // brown
};

// The mark: a 16×16 chevron ladder — three rungs, newest (cream) on top.
const MARK = [
  '.kkkkkkkkkkkkkk.',
  'kkkkkkkcckkkkkkk',
  'kkkkkkcccckkkkkk',
  'kkkkkcckkcckkkkk',
  'kkkkcckkkkcckkkk',
  'kkkkkkkkkkkkkkkk',
  'kkkkkkkaakkkkkkk',
  'kkkkkkaaaakkkkkk',
  'kkkkkaakkaakkkkk',
  'kkkkaakkkkaakkkk',
  'kkkkkkkkkkkkkkkk',
  'kkkkkkkbbkkkkkkk',
  'kkkkkkbbbbkkkkkk',
  'kkkkkbbkkbbkkkkk',
  'kkkkbbkkkkbbkkkk',
  '.kkkkkkkkkkkkkk.',
];

// Small UI sprites (16×16), drawn in currentColor-free fixed colours so they survive both themes.
const HOURGLASS = [
  '................',
  '...llllllllll...',
  '...lccccccccl...',
  '....lccccccl....',
  '.....laaaal.....',
  '......laal......',
  '.......ll.......',
  '.......ll.......',
  '......lccl......',
  '.....lccccl.....',
  '....lcaaaacl....',
  '...laaaaaaaal...',
  '...llllllllll...',
  '................',
  '................',
  '................',
];

const FLAG = [
  '................',
  '...ll...........',
  '...laaaaaaa.....',
  '...laaaaaaaaaa..',
  '...laaaaaaaaaa..',
  '...laaaaaaaaaa..',
  '...laaaaaaaaaa..',
  '...l......aaaa..',
  '...l............',
  '...l............',
  '...l............',
  '...l............',
  '...l............',
  '..lll...........',
  '................',
  '................',
];

/** One <path> per colour, merging horizontal runs, keeps the SVGs to a few hundred bytes. */
function svgRects(map: string[], dx = 0): string {
  const paths: Record<string, string> = {};
  map.forEach((row, y) => {
    if (row.length !== 16) throw new Error(`bad sprite row ${y}: ${row}`);
    for (let x = 0; x < row.length; ) {
      const ch = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') paths[ch] = (paths[ch] ?? '') + `M${x + dx} ${y}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  });
  return Object.entries(paths).map(([ch, d]) => `<path fill="${PALETTE[ch]}" d="${d}"/>`).join('');
}

const svg = (w: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 16" width="${w}" height="16" shape-rendering="crispEdges">${body}</svg>\n`;

writeFileSync(out('favicon.svg'), svg(16, svgRects(MARK)));
// Sprite sheet: mark | hourglass | flag, 16px apart. Used with background-position + image-rendering: pixelated.
writeFileSync(out('sprites.svg'), svg(48, svgRects(MARK) + svgRects(HOURGLASS, 16) + svgRects(FLAG, 32)));

// ---- PNG ---------------------------------------------------------------------

class Canvas {
  readonly px: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: string) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }
  rect(x: number, y: number, w: number, h: number, hex: string) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) {
        const o = (yy * this.w + xx) * 3;
        this.px[o] = r;
        this.px[o + 1] = g;
        this.px[o + 2] = b;
      }
    }
  }
  sprite(map: string[], x: number, y: number, scale: number) {
    map.forEach((row, yy) =>
      [...row].forEach((ch, xx) => {
        if (ch !== '.') this.rect(x + xx * scale, y + yy * scale, scale, scale, PALETTE[ch]!);
      }),
    );
  }
  text(str: string, x: number, y: number, scale: number, hex: string): number {
    let cx = x;
    for (const ch of str) {
      const glyph = FONT[ch] ?? FONT['?']!;
      glyph.forEach((row, yy) =>
        [...row].forEach((bit, xx) => {
          if (bit === '#') this.rect(cx + xx * scale, y + yy * scale, scale, scale, hex);
        }),
      );
      cx += (glyph[0]!.length + 1) * scale;
    }
    return cx;
  }
  png(): Buffer {
    const raw = Buffer.alloc((this.w * 3 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      Buffer.from(this.px.buffer, y * this.w * 3, this.w * 3).copy(raw, y * (this.w * 3 + 1) + 1);
    }
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolour RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

// A tiny 5×7 bitmap font of our own for the OG image.
const FONT: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '..#..', '.#...'],
  '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
};

// Apple touch icon: the mark on its own tile, 180×180 (16 × 11 = 176 + 2px margin).
{
  const c = new Canvas(180, 180, PALETTE.k!);
  c.sprite(MARK, 2, 2, 11);
  writeFileSync(out('apple-touch-icon.png'), c.png());
}

// Open Graph image, 1200×630.
{
  const c = new Canvas(1200, 630, PALETTE.k!);
  // Stepped pixel frame.
  const line = PALETTE.l!;
  c.rect(40, 32, 1120, 8, line);
  c.rect(40, 590, 1120, 8, line);
  c.rect(32, 40, 8, 550, line);
  c.rect(1160, 40, 8, 550, line);
  c.sprite(MARK, 96, 155, 20); // 320×320
  let y = 180;
  c.text('REACT NATIVE', 470, y, 7, PALETTE.c!);
  y += 80;
  c.text('VERSION MATRIX', 470, y, 7, PALETTE.a!);
  y += 100;
  c.text('EXPO SDK, REACT, HERMES,', 470, y, 3, PALETTE.c!);
  y += 36;
  c.text('XCODE, ANDROID SDK, NODE, JDK', 470, y, 3, PALETTE.c!);
  c.text('REACT-NATIVE.DEV', 96, 520, 5, PALETTE.a!);
  c.text('INDEPENDENT. NOT AFFILIATED WITH THE REACT FOUNDATION.', 96, 562, 2, PALETTE.b!);
  writeFileSync(out('og.png'), c.png());
}

console.log('brand assets written to public/');
