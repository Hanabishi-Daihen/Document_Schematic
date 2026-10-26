const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAll, DIST } = require('../scripts/build');
const { createGas } = require('./gas-harness');

const built = buildAll();

test('dist/ ตรงกับซอร์สล่าสุด (ถ้าไม่ผ่าน ให้รัน npm run build)', () => {
  for (const [name, content] of Object.entries(built)) {
    assert.equal(fs.readFileSync(path.join(DIST, name), 'utf8'), content, `dist/${name} ไม่ตรงกับซอร์ส`);
  }
});

test('Index.html ไม่โหลดอะไรจากเว็บภายนอก', () => {
  const html = built['Index.html'];
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /url\(\s*['"]?https?:/i);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /<!-- @inline/);
  assert.match(html, /font-family:\s*'Noto Serif Thai'/);
  assert.match(html, /font-family:\s*'IBM Plex Sans Thai'/);
  assert.match(html, /\.bg-canvas\{/); // Tailwind compile แล้ว
});

test('dist/Code.gs รัน flow หลักได้ครบ', () => {
  const g = createGas({ source: 'dist' });
  g.run('setup()');
  g.run(`adminAddSource('pw', 'https://company-my.sharepoint.com/:f:/g/x', 'QA')`);
  g.onedrive.add({ id: 'a1', name: 'Spec Rev.1.pdf', content: 'v1' });
  g.onedrive.add({ id: 'a2', name: 'Spec Rev.2.pdf', content: 'v2', modified: new Date().toISOString() });
  const r = g.run('syncNow()');
  assert.equal(r.processed, 2);
  const doc = g.run('getBootstrap()').documents[0];
  assert.equal(doc.rev, '2');
  assert.equal(doc.badge, 'revised');
  for (const name of ['onOpen', 'menuInstall', 'menuSettings', 'saveSettingsFromDialog', 'doGet', 'runScheduled']) {
    assert.equal(g.run(`typeof ${name}`), 'function', name);
  }
});
