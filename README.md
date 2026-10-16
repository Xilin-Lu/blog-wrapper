# Blog Wrapper

一个在本地将 Markdown 构建为静态 HTML 的博客工具。使用浏览器默认样式。公式和代码块在构建时完成排版与高亮。

## 首次使用

安装 [mise](https://mise.jdx.dev/)，然后在项目目录执行：

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run init
mise exec -- pnpm run build
```

`init` 创建示例内容。`build` 生成 `dist/`，可以将 `dist/` 目录交给静态网页服务器进行浏览。

## 项目结构

```text
.
├── mise.toml
├── package.json
├── pnpm-lock.yaml
├── .gitignore
├── .gitattributes
├── build.mjs
├── init.mjs
├── template.html
├── test/
├── content/                       # 本地内容，不纳入 Git
│   ├── index.md                   # 主页
│   ├── links.md                   # 友链
│   ├── posts/
│   │   └── 2026-01-01-example.md
│   └── images/
└── dist/                          # 构建输出，不纳入 Git
    ├── index.html
    ├── articles.html
    ├── links.html
    ├── posts/
    ├── images/
    └── assets/
        ├── highlight.css
        └── katex/
            ├── katex.min.css
            └── fonts/
```

## 撰写内容

主页来自 `content/index.md`，友链来自 `content/links.md`。这两份文档必须存在。

除草稿外，其余 `.md` 文档自动作为文章，推荐统一放在 `content/posts/`，支持嵌套目录和中文文件名。输出保留相对路径，将 `.md` 改为 `.html`。

文件名以小写 `draft` 开头的 Markdown 会在构建时忽略。规则递归适用于整个内容目录，只检查文件名。非 Markdown 文件仍按资源复制。

文章列表没有分页，按相对文件路径倒序排列。使用 `YYYY-MM-DD-title.md` 命名时，同一目录的新文章会排在前面；多个目录之间仍按目录名排序，而非跨目录比较日期。

页面标题和文章链接文字取第一个一级标题，支持标题中的粗体、链接与行内代码。没有一级标题时使用文件名；主页和友链分别使用“主页”和“友链”。

公式使用 `$...$` 和 `$$...$$`：

```markdown
行内公式：$E = mc^2$。

$$
\int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}
$$
```

代码块在围栏后注明语言：

````markdown
```python
def square(x):
    return x * x
```
````

未注明或不支持的语言按普通代码显示。公式错误会报告文档路径，并在页面中保留错误公式。

站内链接直接指向源 Markdown，例如文章里的 `[主页](../index.md)`，构建时会自动转换成 HTML 链接。引用式链接同样支持，查询参数和片段会保留。外部链接不转换。需要片段锚点时可以使用原生 HTML，例如 `<a id="example"></a>`。

图片等非 Markdown 文件保留相对路径复制。例如把图片放在 `content/images/photo.png`，在 `posts/` 下的文章使用 `![图片](../images/photo.png)`。路径中的空格可以通过尖括号包住链接目标。优先使用相对资源链接；指向已存在内容文件的站点根路径也会转换为相对链接。

`assets/` 保留给公式和代码样式，`articles.html` 保留给文章列表。同名输出、文件与目录冲突、跨平台大小写冲突、失效的 Markdown 链接会中止构建。内容目录中的符号链接不支持。生成器不为作者原生 HTML 中的链接改写路径。

## 字体

请在 `content/fonts` 下放置用于正文的字体 `body.woff2` 以及用于代码的字体 `code.woff2` 。  

## 更新与验证

编辑内容后重新构建：

```bash
mise exec -- pnpm run build
mise exec -- pnpm test
```

成功构建会清除已删除文章和资源的旧输出。输入、渲染和资源检查完成前，已有 `dist/` 保持原样。
