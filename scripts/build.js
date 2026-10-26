#!/usr/bin/env node
/**
 * รวมซอร์สใน gas/ เป็นไฟล์พร้อมวางใน Apps Script ที่ dist/
 *   dist/Code.gs          โค้ดฝั่ง server ทุกไฟล์ต่อกัน
 *   dist/Index.html       หน้าเว็บ + CSS (Tailwind ที่ compile แล้ว) + ฟอนต์ (base64) + JavaScript ในไฟล์เดียว
 *   dist/appsscript.json
 * ไม่มีการโหลดอะไรจาก CDN ตอนใช้งาน
 *
 * ใช้: npm run build        (เขียนไฟล์)
 *      require('./build').buildAll()  (คืนเนื้อหาไฟล์ — ใช้ในเทสต์)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const GAS = path.join(ROOT, 'gas');
const DIST = path.join(ROOT, 'dist');

// ลำดับไฟล์ใน Code.gs (ใน GAS ทุกไฟล์อยู่ global scope เดียวกัน ลำดับมีผลแค่การอ่าน)
const SERVER_FILES = [
  'Config.js', 'Repo.js', 'RevParser.js', 'Graph.js', 'Sync.js', 'Processor.js',
  'SearchIndex.js', 'Api.js', 'WebApp.js', 'Menu.js', 'Setup.js',
];

// ฟอนต์ที่ฝังในหน้าเว็บ (เฉพาะ subset ไทย + ละติน)
const FONTS = [
  ['noto-serif-thai', [400]],
  ['ibm-plex-sans-thai', [400, 500]],
];
const FONT_SUBSETS = ['thai', 'latin'];

function buildCode() {
  const missing = fs.readdirSync(GAS).filter((f) => f.endsWith('.js') && !SERVER_FILES.includes(f));
  if (missing.length) throw new Error(`เพิ่มไฟล์ใน SERVER_FILES ของ scripts/build.js: ${missing.join(', ')}`);
  const header = '/**\n * Document Schematic — ไฟล์นี้สร้างจาก gas/*.js ด้วย `npm run build` ห้ามแก้ไขโดยตรง\n */\n';
  return header + SERVER_FILES
    .map((f) => `\n// ==================== ${f} ====================\n\n` + fs.readFileSync(path.join(GAS, f), 'utf8').trim() + '\n')
    .join('');
}

function buildFontCss() {
  const nm = path.join(ROOT, 'node_modules', '@fontsource');
  const out = [];
  for (const [family, weights] of FONTS) {
    for (const w of weights) {
      const css = fs.readFileSync(path.join(nm, family, `${w}.css`), 'utf8');
      for (const block of css.match(/@font-face\s*{[^}]*}/g)) {
        const file = (block.match(/url\(\.\/files\/([^)]+\.woff2)\)/) || [])[1];
        if (!file || !FONT_SUBSETS.some((s) => file.endsWith(`-${s}-${w}-normal.woff2`))) continue;
        const b64 = fs.readFileSync(path.join(nm, family, 'files', file)).toString('base64');
        out.push(block.replace(/src:[^;]+;/, `src: url(data:font/woff2;base64,${b64}) format('woff2');`));
      }
    }
  }
  if (out.length !== FONT_SUBSETS.length * FONTS.reduce((n, [, ws]) => n + ws.length, 0)) {
    throw new Error('ไม่พบไฟล์ฟอนต์ครบ — รัน npm install');
  }
  return out.join('\n');
}

function buildTailwindCss() {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'tailwindcss');
  return execFileSync(bin, ['-c', path.join(ROOT, 'tailwind.config.js'), '-i', path.join(__dirname, 'tailwind.css'), '--minify'],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function buildIndex() {
  const read = (f) => fs.readFileSync(path.join(GAS, 'ui', f), 'utf8');
  const parts = {
    fonts: `<style>\n${buildFontCss()}\n</style>`,
    tailwind: `<style>\n${buildTailwindCss().trim()}\n</style>`,
    'Styles.html': read('Styles.html').trim(),
    'App.js.html': read('App.js.html').trim(),
  };
  const html = read('Index.html').replace(/<!-- @inline (\S+) -->/g, (m, key) => {
    if (!(key in parts)) throw new Error(`ไม่รู้จัก ${m}`);
    return parts[key];
  });
  if (/<\?/.test(html)) throw new Error('Index.html ไม่ควรมี scriptlet <? ?> (ส่งออกด้วย createHtmlOutputFromFile)');
  return html;
}

function buildAll() {
  return {
    'Code.gs': buildCode(),
    'Index.html': buildIndex(),
    'appsscript.json': fs.readFileSync(path.join(GAS, 'appsscript.json'), 'utf8'),
  };
}

if (require.main === module) {
  fs.mkdirSync(DIST, { recursive: true });
  for (const [name, content] of Object.entries(buildAll())) {
    fs.writeFileSync(path.join(DIST, name), content);
    console.log(`dist/${name}  ${(Buffer.byteLength(content) / 1024).toFixed(0)} KB`);
  }
}

module.exports = { buildAll, DIST };
