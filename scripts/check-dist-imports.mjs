/**
 * 产物导入形态校验（`npm run check:dist`）。
 *
 * 背景：库产物里如果出现「动态导入内部 chunk + 命名空间取属性」的写法，
 * 宿主再构建（Vite / Rollup / Webpack）就会踩坑：
 *
 *   // 本库 dist 输出（Rollup 为动态导入的内部模块生成）
 *   const { createDxfLoaderWorker } = await import("./chunk.js").then((ns) => ns.w);
 *
 * 宿主的动态导入分析会把 `import()` 包装成只含被解构字段的对象
 * `{ createDxfLoaderWorker }`，而库里的 `.then((ns) => ns.w)` 仍在命名空间上
 * 取 `w`，于是拿到 undefined，运行时报：
 *   Cannot destructure property 'createDxfLoaderWorker' of '(intermediate value)' as it is undefined.
 *
 * 因此：内部模块一律静态导入；确需懒加载时，对 `import()` 结果直接解构
 * （`.then(({ buildSceneIndexAsync }) => ...)`），这种形态宿主能正确重写。
 *
 * 本脚本扫描 dist 下的 JS，命中上述危险形态即失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

if (!fs.existsSync(DIST)) {
  console.log('· 未找到 dist/，跳过产物导入形态校验（先执行 npm run build:lib）');
  process.exit(0);
}

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const jsFiles = walk(DIST).filter(file => file.endsWith('.js'));
const LITERAL_IMPORT = /import\(\s*(["'])([^"']+)\1\s*\)/g;

/** 安全形态：对 import() 结果直接解构 —— `.then(({ a, b }) => ...)`。 */
const DESTRUCTURED_THEN = /^\s*\.\s*then\(\s*(?:async\s*)?\(?\s*\{/;

/** 危险形态：先拿命名空间再取属性 —— `.then((ns) => ns.prop)`。 */
const NAMESPACE_THEN =
  /^\s*\.\s*then\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\{?\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)/;

const problems = [];
let dynamicImports = 0;

for (const file of jsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');

  for (const match of code.matchAll(LITERAL_IMPORT)) {
    dynamicImports++;
    const start = match.index;
    const end = start + match[0].length;
    const tail = code.slice(end, end + 240);
    const line = code.slice(0, start).split('\n').length;
    const snippet = code.slice(start, end + 60).replace(/\s+/g, ' ').trim();

    if (!DESTRUCTURED_THEN.test(tail)) {
      const namespaceThen = NAMESPACE_THEN.exec(tail);
      if (namespaceThen && namespaceThen[1] === namespaceThen[2]) {
        problems.push({
          file: relative,
          line,
          specifier: match[2],
          snippet,
        });
        continue;
      }
    }

    // `(await import("...")).prop`：交给宿主重写时同样会丢属性。
    const head = code.slice(Math.max(0, start - 48), start);
    const awaited = /\(\s*await\s*$/.test(head);
    const member = awaited && /^\)\s*\.\s*([A-Za-z_$][\w$]*)/.exec(tail);
    if (member) {
      problems.push({
        file: relative,
        line,
        specifier: match[2],
        snippet,
      });
    }
  }
}

if (problems.length === 0) {
  console.log(`✓ 产物导入形态正常（${jsFiles.length} 个 JS 文件，${dynamicImports} 处字面量动态导入）`);
  process.exit(0);
}

console.log(`✗ 发现 ${problems.length} 处危险的动态导入形态：\n`);
for (const problem of problems) {
  console.log(`  ${problem.file}:${problem.line}  →  import("${problem.specifier}")`);
  console.log(`    ${problem.snippet}`);
}
console.log(`
说明：上面这类「import("chunk").then((ns) => ns.prop)」是 Rollup 为内部动态导入生成的，
宿主项目再次构建后 ns 会变成只含被解构字段的对象，运行时报
"Cannot destructure property 'xxx' of '(intermediate value)' as it is undefined."。
修复方式：把该内部模块改为静态导入；确需懒加载时直接解构
（.then(({ xxx }) => ...)），不要先取命名空间再取属性。
`);
process.exit(1);