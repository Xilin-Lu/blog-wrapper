import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { katex } from '@mdit/plugin-katex';
import { ParseError, renderToString } from 'katex';
import hljs from 'highlight.js';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const isMarkdown = (name) => /\.md$/i.test(name);
const isDraftMarkdown = (name) => isMarkdown(name) && path.posix.basename(name).startsWith('draft');
const toHtml = (name) => name.replace(/\.md$/i, '.html');
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const encodePath = (name) => name.split('/').map(encodeURIComponent).join('/');
const relativeUrl = (page, target) => encodePath(path.posix.relative(path.posix.dirname(page), target));

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), name));
    } else if (entry.isFile()) {
      files.push(name);
    } else {
      throw new Error(`不支持符号链接或特殊文件：${name}`);
    }
  }
  return files.sort();
}

function walkTokens(tokens, visit) {
  for (const token of tokens) {
    visit(token);
    if (token.children) walkTokens(token.children, visit);
  }
}

function plainText(tokens) {
  return tokens.map((token) => {
    if (token.children) return plainText(token.children);
    return ['text', 'code_inline', 'math_inline'].includes(token.type) ? token.content : '';
  }).join('');
}

function documentTitle(tokens, fallback) {
  const index = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1');
  return index < 0 ? fallback : plainText(tokens[index + 1].children ?? []).trim() || fallback;
}

function createMarkdown(onWarning) {
  const md = new MarkdownIt({
    html: true,
    highlight(code, language) {
      const highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(code, { language, ignoreIllegals: true }).value
        : escapeHtml(code);
      return `<pre><code class="hljs">${highlighted}</code></pre>`;
    },
  }).use(katex);

  // Keep macros within one document and include the source path in math errors.
  const macros = {};
  for (const type of ['math_inline', 'math_block']) {
    md.renderer.rules[type] = (tokens, index, _options, env) => {
      const content = tokens[index].content;
      try {
        return renderToString(content, {
          displayMode: type === 'math_block',
          throwOnError: true,
          macros,
          strict(code, message) {
            if (code !== 'newLineInDisplayMode') onWarning(`${env.source}：公式警告：${message}`);
            return 'ignore';
          },
        });
      } catch (error) {
        if (!(error instanceof ParseError)) throw error;
        onWarning(`${env.source}：无法渲染公式：${error.message}`);
        const tag = type === 'math_block' ? 'p' : 'span';
        return `<${tag} class="katex-error" title="${escapeHtml(error.message)}">${escapeHtml(content)}</${tag}>`;
      }
    };
  }
  return md;
}

function rewriteUrl(url, source, page, targets) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(url)) return url;
  const [, pathname, suffix] = url.match(/^([^?#]*)(.*)$/);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return url;
  }
  const target = decoded.startsWith('/')
    ? path.posix.normalize(decoded.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(source), decoded));
  if (targets.has(target)) return relativeUrl(page, targets.get(target)) + suffix;
  if (isMarkdown(target)) throw new Error(`Markdown 链接目标不存在：${url}`);
  return url;
}

function renderPage(template, page, title, body) {
  const values = {
    title: escapeHtml(title),
    body,
    katexCss: escapeHtml(relativeUrl(page, 'assets/katex/katex.min.css')),
    highlightCss: escapeHtml(relativeUrl(page, 'assets/highlight.css')),
    homeUrl: escapeHtml(relativeUrl(page, 'index.html')),
    articlesUrl: escapeHtml(relativeUrl(page, 'articles.html')),
    linksUrl: escapeHtml(relativeUrl(page, 'links.html')),
    fontsUrl: escapeHtml(relativeUrl(page, 'fonts')),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key]);
}

function contains(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function build({
  contentDir = path.join(projectDir, 'content'),
  outputDir = path.join(projectDir, 'dist'),
  templatePath = path.join(projectDir, 'template.html'),
  onWarning = (message) => console.warn(message),
} = {}) {
  contentDir = path.resolve(contentDir);
  outputDir = path.resolve(outputDir);
  if (contains(contentDir, outputDir) || contains(outputDir, contentDir)) {
    throw new Error('内容目录与输出目录不能相同或互相包含');
  }
  const outputInfo = await lstat(outputDir).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (outputInfo && !outputInfo.isDirectory()) throw new Error(`输出路径必须是实际目录：${outputDir}`);

  let files;
  try {
    files = (await listFiles(contentDir)).filter((name) => !isDraftMarkdown(name));
  } catch (error) {
    throw new Error(`无法读取内容目录 ${contentDir}：${error.message}；首次使用请运行 pnpm run init`, { cause: error });
  }
  for (const required of ['index.md', 'links.md']) {
    if (!files.includes(required)) throw new Error(`缺少必需文档：${path.join(contentDir, required)}`);
  }

  const targets = new Map(files.map((name) => [name, isMarkdown(name) ? toHtml(name) : name]));
  const outputs = new Map([['articles.html', '自动生成的文章列表']]);
  for (const [source, target] of targets) {
    const key = target.toLowerCase();
    if (key === 'assets' || key.startsWith('assets/')) throw new Error(`输出路径冲突：${source}；assets/ 保留给公式与高亮资源`);
    for (const [existing, owner] of outputs) {
      if (key === existing || key.startsWith(`${existing}/`) || existing.startsWith(`${key}/`)) {
        throw new Error(`输出路径冲突：${source} 与 ${owner} → ${target}`);
      }
    }
    outputs.set(key, source);
  }

  const template = await readFile(templatePath, 'utf8');
  const placeholders = [...template.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
  const expected = ['title', 'body', 'katexCss', 'highlightCss', 'homeUrl', 'articlesUrl', 'linksUrl', 'fontsUrl'];
  if (expected.some((key) => !placeholders.includes(key)) || placeholders.some((key) => !expected.includes(key))) {
    throw new Error(`HTML 模板缺少必要占位符或包含未知占位符：${templatePath}`);
  }

  const pages = new Map();
  const articles = [];
  for (const source of files.filter(isMarkdown)) {
    try {
      const md = createMarkdown(onWarning);
      const env = { source };
      const tokens = md.parse(await readFile(path.join(contentDir, source), 'utf8'), env);
      const page = targets.get(source);
      walkTokens(tokens, (token) => {
        const attr = token.type === 'link_open' ? 'href' : token.type === 'image' ? 'src' : null;
        if (attr) token.attrSet(attr, rewriteUrl(token.attrGet(attr), source, page, targets));
      });
      const fallback = source === 'index.md' ? '主页' : source === 'links.md' ? '友链' : path.posix.basename(source).replace(/\.md$/i, '');
      const title = documentTitle(tokens, fallback);
      pages.set(page, renderPage(template, page, title, md.renderer.render(tokens, md.options, env)));
      if (source !== 'index.md' && source !== 'links.md') articles.push({ source, page, title });
    } catch (error) {
      throw new Error(`${source}：${error.message}`, { cause: error });
    }
  }
  articles.sort((a, b) => a.source < b.source ? 1 : a.source > b.source ? -1 : 0);
  const list = articles.map(({ page, title }) => `  <li><a href="${escapeHtml(relativeUrl('articles.html', page))}">${escapeHtml(title)}</a></li>`).join('\n');
  pages.set('articles.html', renderPage(template, 'articles.html', '文章列表', `<h1>文章列表</h1>\n<ul>\n${list}\n</ul>\n`));

  const katexDir = path.dirname(require.resolve('katex/package.json'));
  const resources = [
    { source: path.join(katexDir, 'dist/katex.min.css'), target: 'assets/katex/katex.min.css' },
    { source: path.join(katexDir, 'dist/fonts'), target: 'assets/katex/fonts' },
    { source: require.resolve('highlight.js/styles/default.css'), target: 'assets/highlight.css' },
    ...files.filter((name) => !isMarkdown(name)).map((name) => ({ source: path.join(contentDir, name), target: name })),
  ];
  for (const resource of resources) await lstat(resource.source);

  // All input and rendering checks finish before replacing the previous output.
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  for (const [page, html] of pages) {
    const target = path.join(outputDir, page);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html, 'utf8');
  }
  for (const resource of resources) {
    const target = path.join(outputDir, resource.target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(resource.source, target, { recursive: true });
  }
  return { pages: pages.size, articles: articles.length, outputDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await build();
    console.log(`已生成 ${result.pages} 个页面（${result.articles} 篇文章）：${result.outputDir}`);
  } catch (error) {
    console.error(`构建失败：${error.message}`);
    process.exitCode = 1;
  }
}
