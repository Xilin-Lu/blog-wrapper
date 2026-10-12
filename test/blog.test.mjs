import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from '../build.mjs';
import { initContent } from '../init.mjs';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function fixture(t, files = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'blog-wrapper-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const contentDir = path.join(directory, 'content');
  const outputDir = path.join(directory, 'dist');
  await mkdir(contentDir);
  for (const [name, content] of Object.entries({ 'index.md': '# 主页\n', 'links.md': '# 友链\n', ...files })) {
    const target = path.join(contentDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { directory, contentDir, outputDir };
}

const page = (f, name) => readFile(path.join(f.outputDir, name), 'utf8');

test('初始化仅补充缺失文档，保留文章和主页', async (t) => {
  const f = await fixture(t, { 'index.md': '# 我的真实主页\n' });
  assert.deepEqual(await initContent(f), ['posts/2026-01-01-example.md']);
  assert.deepEqual(await initContent(f), []);
  assert.equal(await readFile(path.join(f.contentDir, 'index.md'), 'utf8'), '# 我的真实主页\n');
  await access(path.join(f.contentDir, 'images'));
  await rm(path.join(f.contentDir, 'links.md'));
  assert.deepEqual(await initContent(f), ['links.md']);
  assert.equal((await build(f)).articles, 1);
});

test('渲染 Markdown、行内与块级公式、彩色代码和原生 HTML', async (t) => {
  const f = await fixture(t, {
    'posts/example.md': '# **示例** 与 `代码`\n\n**粗体** 和 *斜体*，行内 $x^2$。\n\n$$\nx^2+y^2=z^2\n$$\n\n```python\ndef square(x):\n    return x * x\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n<a id="公式"></a>\n',
  });
  const result = await build(f);
  assert.equal(result.pages, 4);
  const html = await page(f, 'posts/example.html');
  assert.match(html, /<title>示例 与 代码<\/title>/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<em>斜体<\/em>/);
  assert.match(html, /<table>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /class="hljs-keyword"/);
  assert.match(html, /<a id="公式"><\/a>/);
  assert.doesNotMatch(html, /<script\b/i);
  assert.doesNotMatch(html, /<style\b/i);
  assert.equal((html.match(/rel="stylesheet"/g) ?? []).length, 2);
});

test('未知或未注明的代码语言得到转义，代码里的公式不参与排版', async (t) => {
  const f = await fixture(t, {
    'example.md': '```unknown-language\n<script>$x$ & "text"</script>\n```\n\n```\n<plain>\n```\n',
  });
  await build(f);
  const html = await page(f, 'example.html');
  assert.match(html, /&lt;script&gt;\$x\$ &amp; &quot;text&quot;&lt;\/script&gt;/);
  assert.match(html, /&lt;plain&gt;/);
  assert.doesNotMatch(html, /class="katex"|<script\b/i);
});

test('按路径倒序列出所有文章，排除主页和友链并转义标题', async (t) => {
  const f = await fixture(t, {
    'posts/2026-01-01-old.md': '# 旧文章\n',
    'posts/2026-02-01-new.md': '# **新文章** & `code`\n',
    'extra.md': '没有一级标题\n',
    'posts/index.md': '# 子目录文章\n',
  });
  assert.equal((await build(f)).articles, 4);
  const html = (await page(f, 'articles.html')).split('<main>')[1];
  assert.equal((html.match(/<li>/g) ?? []).length, 4);
  assert.ok(html.indexOf('posts/index.html') < html.indexOf('posts/2026-02-01-new.html'));
  assert.ok(html.indexOf('posts/2026-02-01-new.html') < html.indexOf('posts/2026-01-01-old.html'));
  assert.ok(html.indexOf('posts/2026-01-01-old.html') < html.indexOf('extra.html'));
  assert.match(html, />新文章 &amp; code<\/a>/);
  assert.match(html, />extra<\/a>/);
  assert.doesNotMatch(html, /href="(?:index|links)\.html"/);
});

test('嵌套导航、中文路径、引用链接、查询参数和片段正确转换', async (t) => {
  const f = await fixture(t, {
    'posts/深层/入口.md': '# 入口\n\n[主页](/index.md?x=1&y=2#top)\n\n[文章][ref]\n\n[外部](https://example.com/example.md?q=1#part)\n\n[协议相对](//example.com/example.md)\n\n[锚点](#local)\n\n![图片](</images/测试 图.svg>)\n\n[ref]: ../目标.md?mode=full#公式\n',
    'posts/目标.md': '# 目标\n\n<a id="公式"></a>\n',
    'images/测试 图.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  });
  await build(f);
  const html = await page(f, 'posts/深层/入口.html');
  assert.match(html, /href="\.\.\/\.\.\/index\.html\?x=1&amp;y=2#top"/);
  assert.match(html, /href="\.\.\/%E7%9B%AE%E6%A0%87\.html\?mode=full#/);
  assert.match(html, /href="https:\/\/example\.com\/example\.md\?q=1#part"/);
  assert.match(html, /href="\/\/example\.com\/example\.md"/);
  assert.match(html, /href="#local"/);
  assert.match(html, /src="\.\.\/\.\.\/images\/%E6%B5%8B%E8%AF%95%20%E5%9B%BE\.svg"/);
  for (const target of ['index.html', 'articles.html', 'links.html']) {
    assert.match(html, new RegExp(`href="\\.\\./\\.\\./${target.replace('.', '\\.')}"`));
  }
  assert.match(html, /href="\.\.\/\.\.\/assets\/katex\/katex\.min\.css"/);
  assert.equal(await readFile(path.join(f.outputDir, 'images/测试 图.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
});

test('主页、友链标题缺失时使用默认标题，空文章列表可构建', async (t) => {
  const f = await fixture(t, { 'index.md': '欢迎\n', 'links.md': '- [链接](https://example.com/)\n' });
  assert.equal((await build(f)).pages, 3);
  assert.match(await page(f, 'index.html'), /<title>主页<\/title>/);
  assert.match(await page(f, 'links.html'), /<title>友链<\/title>/);
  assert.doesNotMatch(await page(f, 'articles.html'), /<li>/);
});

test('复制公式样式、所有引用字体和高亮主题，不复制依赖 JavaScript', async (t) => {
  const f = await fixture(t);
  await build(f);
  const css = await readFile(path.join(f.outputDir, 'assets/katex/katex.min.css'), 'utf8');
  const references = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) => match[1].replace(/["']/g, ''));
  assert.ok(references.length > 0);
  for (const url of references) await access(path.join(f.outputDir, 'assets/katex', url));
  assert.match(await readFile(path.join(f.outputDir, 'assets/highlight.css'), 'utf8'), /\.hljs-keyword/);
  assert.deepEqual((await readdir(path.join(f.outputDir, 'assets/katex'))).sort(), ['fonts', 'katex.min.css']);
});

test('重建清除已删除文章和资源', async (t) => {
  const f = await fixture(t, { 'posts/old.md': '# 旧文\n', 'images/old.txt': 'old' });
  await build(f);
  await rm(path.join(f.contentDir, 'posts/old.md'));
  await rm(path.join(f.contentDir, 'images/old.txt'));
  await build(f);
  await assert.rejects(access(path.join(f.outputDir, 'posts/old.html')), { code: 'ENOENT' });
  await assert.rejects(access(path.join(f.outputDir, 'images/old.txt')), { code: 'ENOENT' });
  assert.doesNotMatch(await page(f, 'articles.html'), /old\.html/);
});

test('缺失必需文档时报告路径，并保留已有输出', async (t) => {
  const f = await fixture(t);
  await build(f);
  const previous = await page(f, 'index.html');
  await rm(path.join(f.contentDir, 'links.md'));
  await assert.rejects(build(f), /缺少必需文档：.*links\.md/);
  assert.equal(await page(f, 'index.html'), previous);
});

test('缺失内容目录提示初始化命令', async (t) => {
  const f = await fixture(t);
  await rm(f.contentDir, { recursive: true });
  await assert.rejects(build(f), /pnpm run init/);
});

for (const [name, files] of Object.entries({
  '自动生成的文章列表': { 'articles.md': '# 冲突\n' },
  '保留的样式目录': { 'assets/custom.css': 'body {}' },
  'Markdown 和同名资源': { 'extra.md': '# 文档\n', 'extra.html': 'static' },
  '大小写不同的页面': { 'INDEX.MD': '# 冲突\n' },
  '文件与目录': { 'example.md': '# 文档\n', 'example.html/file.txt': 'static' },
})) {
  test(`拒绝输出路径冲突：${name}`, async (t) => {
    const f = await fixture(t, files);
    await assert.rejects(build(f), /输出路径冲突/);
    await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
  });
}

test('失效 Markdown 链接报告源文件且保留已有输出', async (t) => {
  const f = await fixture(t);
  await build(f);
  const previous = await page(f, 'index.html');
  await writeFile(path.join(f.contentDir, 'index.md'), '# 主页\n\n[链接](missing.md)\n');
  await assert.rejects(build(f), /index\.md：Markdown 链接目标不存在：missing\.md/);
  assert.equal(await page(f, 'index.html'), previous);
});

test('公式错误报告文章路径，并保留可读错误公式', async (t) => {
  const f = await fixture(t, { 'posts/bad-math.md': '# 公式\n\n$\\unknownCommand{x}$\n' });
  const warnings = [];
  await build({ ...f, onWarning: (message) => warnings.push(message) });
  assert.ok(warnings.some((message) => message.includes('posts/bad-math.md') && message.includes('unknownCommand')));
  assert.match(await page(f, 'posts/bad-math.html'), /katex-error/);
});

test('不同文章的 KaTeX 宏不会相互泄漏', async (t) => {
  const f = await fixture(t, {
    'posts/a.md': '$\\gdef\\myMacro{x}\\myMacro$\n',
    'posts/b.md': '$\\myMacro$\n',
  });
  const warnings = [];
  await build({ ...f, onWarning: (message) => warnings.push(message) });
  assert.doesNotMatch(await page(f, 'posts/a.html'), /katex-error/);
  assert.match(await page(f, 'posts/b.html'), /katex-error/);
  assert.ok(warnings.some((message) => message.includes('posts/b.md')));
});

test('模板缺失占位符时保留已有输出', async (t) => {
  const f = await fixture(t);
  await build(f);
  const previous = await page(f, 'index.html');
  const templatePath = path.join(f.directory, 'invalid.html');
  await writeFile(templatePath, '{{body}}');
  await assert.rejects(build({ ...f, templatePath }), /HTML 模板/);
  assert.equal(await page(f, 'index.html'), previous);
});

test('输出路径不能覆盖输入或通过符号链接删除其他目录', async (t) => {
  const f = await fixture(t);
  await assert.rejects(build({ ...f, outputDir: f.contentDir }), /互相包含/);
  await assert.rejects(build({ ...f, outputDir: f.directory }), /互相包含/);
  await symlink(f.contentDir, f.outputDir, 'dir');
  await assert.rejects(build(f), /输出路径必须是实际目录/);
  await access(path.join(f.contentDir, 'index.md'));
});

test('CLI 在缺失输入时返回非零状态及明确报错', async (t) => {
  const f = await fixture(t);
  // Run a copy of the CLI without default content, resolving the real dependencies.
  const cliPath = path.join(f.directory, 'build.mjs');
  await writeFile(cliPath, await readFile(path.join(projectDir, 'build.mjs')));
  await symlink(path.join(projectDir, 'node_modules'), path.join(f.directory, 'node_modules'), 'dir');
  await rm(path.join(f.contentDir, 'links.md'));
  const result = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
  if (result.error?.code === 'EPERM') {
    t.skip('当前沙箱限制 Node 子进程，需要单独验证 CLI');
    return;
  }
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /构建失败：缺少必需文档：.*links\.md/);
});

test('Git 忽略指定内容，CRLF 文本进入暂存区后变为 LF', async (t) => {
  const f = await fixture(t);
  const git = (...args) => execFileSync('git', args, { cwd: f.directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  for (const name of ['.gitignore', '.gitattributes']) {
    await writeFile(path.join(f.directory, name), await readFile(path.join(projectDir, name)));
  }
  assert.deepEqual(git('check-ignore', 'dist/index.html', 'content/index.md', 'node_modules/x.js', 'run.sh').trim().split('\n'), [
    'dist/index.html', 'content/index.md', 'node_modules/x.js', 'run.sh',
  ]);
  await writeFile(path.join(f.directory, 'sample.mjs'), 'const x = 1;\r\nconst y = 2;\r\n');
  git('-c', 'core.autocrlf=true', 'add', '.gitattributes', 'sample.mjs');
  assert.equal(git('show', ':sample.mjs'), 'const x = 1;\nconst y = 2;\n');
  assert.match(git('check-attr', 'eol', '--', 'sample.mjs'), /eol: lf/);
});
