import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const samples = {
  'index.md': '# 我的博客\n\n欢迎来到我的博客。\n\n这里记录学习、思考与生活。\n\n[阅读示例文章](posts/2026-01-01-example.md)\n',
  'links.md': '# 友链\n\n- [Markdown](https://commonmark.org/)\n- [KaTeX](https://katex.org/)\n',
  'posts/2026-01-01-example.md': String.raw`# 示例文章

这是一篇普通的 Markdown 文章，可以使用 **粗体**、*斜体*、列表和表格。

## 公式

行内公式：$E = mc^2$。

$$
\int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}
$$

## 代码

` + '```python\ndef square(x):\n    return x * x\n```\n' + `
| 功能 | 渲染方式 |
| --- | --- |
| 公式 | KaTeX |
| 代码 | 语法高亮 |

[返回主页](../index.md)
`,
};

export async function initContent({ contentDir = path.join(projectDir, 'content') } = {}) {
  await mkdir(path.join(contentDir, 'images'), { recursive: true });
  const created = [];
  for (const [name, content] of Object.entries(samples)) {
    const target = path.join(contentDir, name);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
      created.push(name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw new Error(`无法初始化 ${target}：${error.message}`, { cause: error });
    }
  }
  return created;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const created = await initContent();
    console.log(`初始化完成，新增 ${created.length} 个文档；已有文件保持原样。`);
  } catch (error) {
    console.error(`初始化失败：${error.message}`);
    process.exitCode = 1;
  }
}
