```When Editing
本文档作用: 面向开发者的发版记录; CHANGELOG.md 的超集, 1:1 镜像 + 技术变更子项
遵循 AGENTS.md 文档编写规范
- 每条主项 = CHANGELOG.md 对应条目 (原文), 下方缩进子项承载技术变更
- 子项 MAY 写路径 / 函数 / 机制; ≤ 1 行
```

# Changelog (developer, follow [CHANGELOG.md](./CHANGELOG.md))

## [1.11.1] - 2026-09-11

### Removed

- 不再翻译邮件主题: 每封邮件少发一次翻译请求, 正文顶部的「已翻译 / 主题」横幅一并移除
  - `background.js`: 删 `getTranslatedSubject` 端口分支 + 仅它使用的 `SERVICE_LABELS` / `SERVICE_URL_KEY`
  - `content/translator.js`: 删 `sendSubjectTranslateRequest` / `subjectPendingRequests` / `injectSubjectBar` 等主题栏三函数与 `translatedSubject` / `subjectBar` 状态; `reloadPage()` 不再需要清横幅
  - 横幅是 `position: fixed` + 对 `document.body` 强加 `padding-top: !important`, 随之移除; 正文翻译不含主题 (抽取只走消息正文 document, 主题在 Thunderbird chrome 层)
  - `_locales/*/messages.json`: 删 7 份中的死键 `subjectLabel` (横幅硬编码 `"📧 "`, 从未读取)

### Fixed

- 主题翻译失败不再把已经成功的正文翻译判定为失败 (按钮红色「!」)
  - `startTranslation()` 原先 `await subjectPromise` 在同一 try 内, 主题请求抛错即整体 `{success:false}`

## [1.11.0] - 2026-09-11

### Changed

- 译文保留原排版: 链接 / 加粗 / 换行 / 行内间距不再被打散; 英译日等语序差异大的语言对不再语序错乱
  - `content/translator.js`: 整块序列化 + `[[n]]` 内联占位, 回写进原 DOM 节点; 旧实现按 text node 逐个送译, 一句跨 `<a>` 的话被拆成互不相关的片段
  - 片段按译文出现顺序回填而非按 marker id; DOM 位置固定, 模型把 `[[2]]` 提前时按 id 回填会渲染成乱序
  - `background.js` `STRUCTURE_RULES`: 自定义 prompt 也会追加该规则块, 且在占位符替换前拼接, 规则内可用 `{TARGET_LANG}` 等占位符
  - 标记模式仅 Ollama + OpenAI 兼容启用; Google / LibreTranslate 走 legacy 逐节点协议, 但同样吃到抽取与空白修复
- 翻译提示词重写: 要求段数行数一一对应, 并按邮件语域处理称呼与落款; 默认 Ollama 模型改为 `gemma3:4b`, 仍指向 `translategemma` 的旧安装自动回退
  - `DEFAULT_TRANSLATE_PROMPT` 规则 1 锁定段 / 行数, 另加 URL 数字原样、目标语行透传、禁 code fence; `DEFAULT_DETECT_PROMPT` 改问 dominant language 并忽略引用与签名档
  - `DEFAULT_MODEL`; `translategemma` 只认自家 JSON schema, 会把格式规则当正文翻译 → 标记损坏 → 命中 fallback

### Fixed

- 短文本不再在送入模型前被丢弃; 模型多返回的行也不再被静默丢弃
  - 长度门槛从单个 text node 上移到整块, 此前 `Press <b>X</b> to stop` 里的 `X` 在送译前就被删掉
  - legacy 回退中多出的行并入最后一个不在 `<a>` 内的片段; 无条件并入最后一个节点会把半句话吞进链接
- 模型漏掉或合并段落时不再整体错位, 仅该段受影响并自动重试一次; 链接 URL 与邮箱地址不再送去翻译
  - 块改用 `#n#` id 匹配而非位置匹配; 标记缺失 / 重复 / 越界的块退回 legacy 协议重试
  - anchor 文本本身就是 URL / mail 地址时留在 DOM 不动; 嵌套块内的 `<br>` 不再漏进外层块的 payload
- 邮件正文不再混入 HTML 实体 (`AT&T` 曾显示为 `AT&amp;T`) 或推理模型的思维链; 设置页 prompt 默认值与实际使用的重新一致
  - 新增 `unescapeFromPrompt()`, `&amp;` 最后解, 避免 `&amp;lt;` 塌成 `<`; 新增 `stripReasoning()` 统一三处, 此前仅 `openaiChat` 剥 `<think>`
  - `options/options.js` 的 placeholder 与 `background.js` 默认 prompt 再次同步 (v1.10.0 修过, 又漂移)
  - `parseLangCode` 反查改用新增的 `LANGUAGE_NAMES_EN`; 原表存的是本族名 (日本語 / Русский), 模型英文回答永远不匹配

## [1.10.0] - 2026-09-11

### Added

- OpenAI 兼容 API 作为第四个翻译服务 (OpenAI / LM Studio / vLLM / llama.cpp / OpenRouter / LiteLLM / 本地代理)
  - `translateWithOpenAI()` 加入 `translateText()` switch; 独立 Base URL / key / 翻译模型 / 检测模型 / prompt; Base URL 原样追加 `/chat/completions`

### Changed

- 语言检测改用 Thunderbird 内置的本地检测, 不再为此消耗 API 调用; 配置的检测模型仅在无法判定时兜底
  - `detectLanguageLocally()` 走 `messenger.i18n.detectLanguage` (Gecko 内置 CLD2), `detectLanguage()` 仅在其返回 null 时打模型
- 自动翻译跳过已是目标语言或在「不翻译」列表中的邮件, 判定在任何正文外发之前完成
  - 取样本地检测 → 命中即跳过, 四个服务通用; 译后豁免检查同时比对 target, 不再只比 never 列表
- 默认目标语言跟随 Thunderbird 界面语言 (此前硬编码英语); 工具栏「Translate to」仍可覆盖

### Fixed

- 设置页 prompt 默认值与实际使用的不一致, 保存未改动的字段会静默替换为旧版本
  - `options/options.js` placeholder 与 `background.js` 默认 prompt 对齐 (旧变体缺 `<text>` 标签)

### Security

- API key 输入框改为密码掩码
  - `ollamaApiKey` / `libreApiKey` / `openaiApiKey` 改 `type="password"`

## [1.9.1] - 2026-08-12

### Fixed

- 偏好设置页标题仍显示旧名称, 7 种界面语言均已更新
  - 设置页标题取本地化串 `appName`, 与 manifest name 分离, v1.9.0 改名时漏改

## [1.9.0] - 2026-08-12

### Changed

- 更名为 "Privacy Translator for Thunderbird"
  - Mozilla 商标政策只允许 `NAME for Thunderbird` 形式
- 主机访问改为可选权限: 安装时不索取, 首次保存 / 测试连接时才按单个主机请求; 拒绝则该服务翻译不可用
  - `*://*/*` 从 `permissions` 移到 `optional_permissions`; `permissions.request()` 前 MUST NOT 有 await, 否则丢失用户手势
- 安装提示中不再出现 `tabs` 权限
  - 实际只用 `tabs.onRemoved`, 该 API 不需要该权限

### Removed

- XPI 不再打包文档与截图, 下载体积从 2.6 MB 降到 28 KB
  - `make_xpi.sh` / `make_xpi.ps1` 白名单排除 `_docs/`

### Fixed

- Ollama URL 带结尾斜杠时不再拼出双斜杠路径; 后台消息处理不再吞掉其他监听器的响应
  - Ollama 路径拼接补上 strip trailing slash (LibreTranslate 早已有)
  - `runtime.onMessage` 监听器改同步返回; async 监听器对每条消息都返回 Promise, 包括不由它处理的

## [1.8.3] - 2026-05-27

### Security

- 邮件内容送入 prompt 前做 XML 转义, 默认 prompt 用 `<text>` 标签包裹, 隔离指令与数据

### Fixed

- 翻译未完成就切换邮件时, 进行中角标不再残留
  - badge 生命周期与当前 message id 绑定
- 双击 / 连点不再触发并发翻译, 当前翻译结束前忽略新请求
- 页面断连时挂起的请求立即失败, 不再空等 30 秒
  - port disconnect 时 reject 全部 pending, 不再靠 30s timeout 兜底

## [1.8.2] - 2026-05-26

### Added

- 自动翻译语言豁免: 右键菜单显示检测到的源语言, 可一键加入 / 移出「不翻译」列表
  - 先翻译 → 检测源语言 → 命中列表则静默还原
- 独立的检测模型与检测 prompt, 默认沿用翻译模型
- 翻译与检测 prompt 可在高级设置中自定义, 支持 `{TEXT}` / `{TARGET_LANG}` / `{TARGET_CODE}` / `{SOURCE_LANG}` / `{SOURCE_CODE}`; 清空恢复内置默认

### Changed

- 「Model」字段更名为「Translate Model」, 与新增的检测模型区分
- 自动翻译进行中禁用「不翻译此语言」开关, 检测完成后恢复

## [1.8.1] - 2026-05-22

### Added

- 阅读与撰写窗口各自独立的目标语言菜单
  - `menus.onClicked` 用 id 前缀路由区分 read / compose

### Changed

- 设置页改用内联状态提示, 替代弹窗
  - 同时删除已失效的 popup 代码

### Fixed

- 切换目标语言后翻译缓存失效, 不再返回旧语言的结果

## [1.8.0] - 2026-05-21

### Added

- 工具栏按钮右键菜单 (阅读 + 撰写)
- 每个服务记住各自的目标语言
- 深浅两套 SVG 图标
  - `theme_icons` light / dark 变体

### Changed

- 直接切换翻译 / 还原, 不再经过弹窗
- 工具栏按钮标题显示当前目标语言
  - 主题翻译失败时向上传播错误, 不再静默

## [1.7.1] - 2026-05-20

### Added

- 邮件正文顶部固定显示译后主题栏, 适配深色模式, 还原时移除

## [1.7.0] - 2026-05-20

### Added

- 撰写窗口选区翻译
  - `content/composer.js` 就地替换选区, 保留 undo 栈
- 自动翻译 (可选), 角标显示进度
- 自建 LibreTranslate: 可配置 URL + 可选 API key + 测试连接
- Ollama API key, 支持代理 / 远程实例

### Changed

- 阅读与撰写工具栏改用原生按钮, 替换注入式工具栏
  - `message_display_action` + `compose_action`

## [1.6.0] - 2026-05-20

### Added

- 邮件视图内工具栏: 服务选择 / 语言选择 / 翻译·还原按钮
- 深色模式
- 源语言检测 + 翻译缓存

### Changed

- Ollama 服务地址可配置; 设置页精简

## [1.5.0] - 2026-03-16

### Fixed

- 标签页与预览窗格的翻译路由确定化, 译文不再落到错误的邮件上
  - `menus.onShown` + framePortMap, `lastClickedPort` 优先于 tabId

### Changed

- 兼容 Thunderbird 128–147+
  - `messageDisplayScripts` 改程序化注册

## [1.0.0] - 2026-02-17

### Added

- 首个公开版本: Ollama / Google Translate / LibreTranslate, 右键菜单 UI, 7 种界面语言

[1.11.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.11.0
[1.10.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.10.0
[1.9.1]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.9.1
[1.9.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.9.0
[1.8.3]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.8.3
[1.8.2]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.8.2
[1.8.1]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.8.1
[1.8.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.8.0
[1.7.1]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.7.1
[1.7.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.7.0
[1.6.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.6.0
[1.5.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.5.0
[1.0.0]: https://github.com/yigegongjiang/thunderbird-translator/releases/tag/v1.0.0
