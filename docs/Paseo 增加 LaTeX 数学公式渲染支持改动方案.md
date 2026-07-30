# Paseo 增加 LaTeX 数学公式渲染支持改动方案

## 目标

让 Paseo 支持 AI Agent 输出中的 LaTeX 数学公式。

支持：

- 行内公式：

```
$ f(x)=x^2 $
```

显示为数学公式。

- 块级公式：

```
$$
\lim_{x\to0}\frac{\sin x}{x}=1
$$
```

显示为独立公式。

---

# 一、当前渲染链路分析

Paseo 当前渲染流程：

```
Agent 输出
    |
    v
Markdown 文本
    |
    v
react-native-markdown-display
    |
    v
MarkdownIt
    |
    v
React Native UI
```

涉及文件：

```
packages/app/src/components/message.tsx

packages/app/src/components/file-pane.tsx

packages/app/src/components/plan-card.tsx
```

数学渲染属于客户端 Markdown Renderer 功能。

不需要修改：

- Agent
- Server
- API
- 数据结构

---

# 二、安装依赖

进入 app 目录：

```bash
cd packages/app
```

安装：

```bash
npm install markdown-it-katex katex
```

或者：

```bash
pnpm add markdown-it-katex katex
```

---

# 三、修改 Markdown Renderer

## 修改位置

文件：

```
packages/app/src/components/message.tsx
```

找到当前 MarkdownIt 初始化代码：

```ts
MarkdownIt({
  typographer: true,
  linkify: true,
});
```

修改：

```ts
import MarkdownIt from "markdown-it";
import markdownItKatex from "markdown-it-katex";

const markdownParser = new MarkdownIt({
  typographer: true,
  linkify: true,
}).use(markdownItKatex);
```

---

# 四、引入 KaTeX 样式

增加：

```ts
import "katex/dist/katex.min.css";
```

---

# 五、修改 Markdown 组件

原：

```tsx
<Markdown>{content}</Markdown>
```

改：

```tsx
<Markdown markdownit={markdownParser}>{content}</Markdown>
```

---

# 六、同步修改其他 Markdown 渲染位置

Paseo 还有其他 Markdown 展示位置。

## 1. 文件预览

文件：

```
packages/app/src/components/file-pane.tsx
```

修改：

```tsx
<Markdown markdownit={markdownParser}>{content}</Markdown>
```

---

## 2. Plan Card

文件：

```
packages/app/src/components/plan-card.tsx
```

同样替换 Markdown Renderer。

---

# 七、兼容处理

## 1. 代码块不要解析数学公式

例如：

````markdown
```latex
$x^2$
```
````

应该保持代码显示。

---

## 2. 普通美元符号不要误解析

例如：

```
价格 $100
```

不要被识别为数学公式。

支持以下定界符：

```
$公式$
\(公式\)
$$公式$$
\[公式\]
```

并增加判断：

- `$` 两侧存在数学字符
- 单独美元符号忽略

---

# 八、测试用例

## 测试 1：极限

输入：

```markdown
$$
\lim_{x\to0}\frac{\sin x}{x}=1
$$
```

预期：

正常显示极限公式。

---

## 测试 2：积分

输入：

```markdown
$$
\int_0^1 x^2 dx=\frac13
$$
```

预期：

正常显示积分公式。

---

## 测试 3：算法复杂度

输入：

```markdown
$$
T(n)=2T(n/2)+O(n)
$$
```

预期：

正常显示递归复杂度公式。

---

# 九、推荐实现方案

## MVP 版本

优先只修改：

```
message.tsx
```

支持：

- AI 回复中的数学公式

原因：

大部分使用场景来自 Agent 对话。

---

## 完整版本

继续修改：

```
file-pane.tsx

plan-card.tsx
```

支持：

- Markdown 文件预览
- Agent Plan
- 文档展示

---

# 十、提交 PR 建议

Commit：

```
feat: add latex math rendering support
```

PR 描述：

```
Add LaTeX math rendering support for assistant markdown output.

Features:
- Support inline math: $...$
- Support block math: $$...$$
- Use KaTeX renderer
- Keep invalid formulas fallback to plain text

This only changes client-side markdown rendering.
No server protocol changes required.
```

---

# 十一、长期维护方案

如果官方接受：

```
你的 PR
 |
 v
Paseo main
```

以后无需额外维护。

---

如果官方不接受：

维护：

```
official/paseo

      |

your fork

      |

latex-support branch
```

更新官方代码：

```bash
git fetch upstream

git rebase upstream/main
```

即可。

---

# 十二、替代方案

如果官方考虑 React Native 性能问题，可以采用：

```
LaTeX
 |
 v
MathML
 |
 v
Native WebView Renderer
```

优势：

- 更轻量
- 不需要 KaTeX CSS
- 移动端性能更好

但是第一版实现推荐：

```
KaTeX
```

因为：

- 成熟
- 社区使用广
- 实现成本低
- 适合快速提交 PR

---

# 十三、最终建议

对于 Paseo 当前架构：

推荐路线：

1. 使用 `markdown-it-katex`
2. 先支持 assistant message
3. 验证移动端性能
4. 再扩展 file preview 和 plan card
5. 如果官方接受，合并进入主分支

该功能属于低侵入、高收益修改，非常适合作为 Paseo 第一个贡献 PR。
