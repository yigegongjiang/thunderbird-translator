```When Editing
本文档作用: 工程总览 (价值主张 / 使用 / 架构 / 结构); MUST NOT 写发布流程 (→ workflow.md) / LLM 约束 (→ AGENTS.md)
遵循 AGENTS.md 文档编写规范
- 章节按需增删, 只留项目真有的; 首行一行价值主张, MUST NOT 带 LLM 提示
- 短并列项用表格; 可执行步骤 fenced + `#` 注释同行
- NEVER 写「开发」段 (VibeCoding 不向人类解释 dev 命令)
```

# Privacy Translator for Thunderbird

Thunderbird MailExtension (MV2), 翻译邮件正文 / 撰写窗口选区; 后端可选 Ollama (本地) / OpenAI 兼容 API / LibreTranslate / Google Translate。fork of [zoott28354/thunderbird-translator](https://github.com/zoott28354/thunderbird-translator)。

## 使用

交付物 = `thunderbird-translator-v<version>.xpi` (未签名, 自用直装)。Thunderbird ≥ 128 → Tools → Add-ons → ⚙ → Install Add-on from file。

阅读 / 撰写窗口工具栏出现 Translate 按钮: 左键翻译 ↔ 还原, 右键选目标语言 + 自动翻译开关; 后端与模型在 Preferences 配置。

后端配置约束 (装不上 / 翻不动时对照):

<!-- prettier-ignore -->
| 现象 | 原因 / 处置 |
|---|---|
| Ollama `403 Forbidden` | 启动 Ollama 前设 `OLLAMA_ORIGINS=moz-extension://*` 并重启 |
| Ollama `model not found` | `ollama pull gemma3:4b` (或设置中选定的模型) |
| OpenAI 兼容 404 / 无法列模型 | Base URL 必须含版本路径 (`https://api.openai.com/v1`), 扩展只追加 `/chat/completions`; Test Connection 失败不致命, 部分网关不提供 `/models` |
| LibreTranslate 连不上 | 核对 URL 与 API key, 先 Test Connection |
| Compose `No text selected` | 点按钮前必须先在正文中选中文本 |

## 架构

<!-- prettier-ignore -->
| 项 | 事实 |
|---|---|
| 形态 | manifest v2 MailExtension; 无构建 / 无依赖 / vanilla JS |
| 翻译路由 | `background.js` `translateText()` 单 switch → 4 个 fetch 站点 (Ollama / OpenAI 兼容 / Google / LibreTranslate), 无其他外发请求 |
| 正文协议 | 整块送模型 + `[[n]]` 内联占位 + `#n#` 块 id; 标记回不来 → 该块退回逐节点纯文本协议重试一次。仅 Ollama + OpenAI 兼容启用, Google / LibreTranslate 走纯文本 |
| 语言检测 | `i18n.detectLanguage()` (Gecko 内置 CLD2) 优先, 检测模型仅兜底 |
| 主机权限 | `*://*/*` 为 optional_permissions, 首次 Save / Test Connection 时按单主机请求 |
| 打包 | `make_xpi.sh` 白名单 zip; 版本号唯一来源 = `manifest.json#version` |

## 项目结构

<!-- prettier-ignore -->
| 路径 | 职责 |
|---|---|
| `background.js` | 服务路由 + 4 个后端 fetch + menus / badge / 端口生命周期 |
| `content/translator.js` | 阅读窗口正文抽取与回写 |
| `content/composer.js` | 撰写窗口选区就地替换 |
| `options/` | 设置页 (服务 / 模型 / 语言 / 自定义 prompt) |
| `_locales/` | 7 种界面语言 `messages.json` |
| `icons/` | 工具栏 SVG (dark / light) |
| `make_xpi.sh` | 打包脚本; `make_xpi.ps1` = Windows 等价物, 两者 include 列表必须同步 |
| `_docs/` | 截图 / GIF; MUST NOT 打入 XPI |

`content/translator.css` 无人引用, 故意不打包。

## License

MIT。原始作品 [zoott28354](https://github.com/zoott28354/thunderbird-translator)。
