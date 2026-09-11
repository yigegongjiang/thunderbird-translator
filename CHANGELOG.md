```When Editing
本文档作用: 面向使用者的发版记录; 只写用户感受得到的变化, MUST NOT 写技术细节 (→ CHANGELOG.dev.md)
遵循 AGENTS.md 文档编写规范
- 写: 新功能 / 行为修复 / 体验 / 安全 / 命令迁移
- MUST NOT 写: 文件路径 / 函数名 / 组件名 / 依赖包名 / 重构细节
- 单条 ≤ 2 行, 单版本 ≤ 5 条; 段落: Added / Changed / Fixed / Removed / Security
- 无用户可感知变化 → 占位: `跟随版本同步发布`
```

# Changelog

[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) + [SemVer](https://semver.org/).

## [1.11.1] - 2026-09-11

### Removed

- 不再翻译邮件主题: 每封邮件少发一次翻译请求, 正文顶部的「已翻译 / 主题」横幅一并移除

### Fixed

- 主题翻译失败不再把已经成功的正文翻译判定为失败 (按钮红色「!」)

## [1.11.0] - 2026-09-11

### Changed

- 译文保留原排版: 链接 / 加粗 / 换行 / 行内间距不再被打散; 英译日等语序差异大的语言对不再语序错乱
- 翻译提示词重写: 要求段数行数一一对应, 并按邮件语域处理称呼与落款; 默认 Ollama 模型改为 `gemma3:4b`, 仍指向 `translategemma` 的旧安装自动回退

### Fixed

- 短文本不再在送入模型前被丢弃; 模型多返回的行也不再被静默丢弃
- 模型漏掉或合并段落时不再整体错位, 仅该段受影响并自动重试一次; 链接 URL 与邮箱地址不再送去翻译
- 邮件正文不再混入 HTML 实体 (`AT&T` 曾显示为 `AT&amp;T`) 或推理模型的思维链; 设置页 prompt 默认值与实际使用的重新一致

## [1.10.0] - 2026-09-11

### Added

- OpenAI 兼容 API 作为第四个翻译服务 (OpenAI / LM Studio / vLLM / llama.cpp / OpenRouter / LiteLLM / 本地代理)

### Changed

- 语言检测改用 Thunderbird 内置的本地检测, 不再为此消耗 API 调用; 配置的检测模型仅在无法判定时兜底
- 自动翻译跳过已是目标语言或在「不翻译」列表中的邮件, 判定在任何正文外发之前完成
- 默认目标语言跟随 Thunderbird 界面语言 (此前硬编码英语); 工具栏「Translate to」仍可覆盖

### Fixed

- 设置页 prompt 默认值与实际使用的不一致, 保存未改动的字段会静默替换为旧版本

### Security

- API key 输入框改为密码掩码

## [1.9.1] - 2026-08-12

### Fixed

- 偏好设置页标题仍显示旧名称, 7 种界面语言均已更新

## [1.9.0] - 2026-08-12

### Changed

- 更名为 "Privacy Translator for Thunderbird"
- 主机访问改为可选权限: 安装时不索取, 首次保存 / 测试连接时才按单个主机请求; 拒绝则该服务翻译不可用
- 安装提示中不再出现 `tabs` 权限

### Removed

- XPI 不再打包文档与截图, 下载体积从 2.6 MB 降到 28 KB

### Fixed

- Ollama URL 带结尾斜杠时不再拼出双斜杠路径; 后台消息处理不再吞掉其他监听器的响应

## [1.8.3] - 2026-05-27

### Security

- 邮件内容送入 prompt 前做 XML 转义, 默认 prompt 用 `<text>` 标签包裹, 隔离指令与数据

### Fixed

- 翻译未完成就切换邮件时, 进行中角标不再残留
- 双击 / 连点不再触发并发翻译, 当前翻译结束前忽略新请求
- 页面断连时挂起的请求立即失败, 不再空等 30 秒

## [1.8.2] - 2026-05-26

### Added

- 自动翻译语言豁免: 右键菜单显示检测到的源语言, 可一键加入 / 移出「不翻译」列表
- 独立的检测模型与检测 prompt, 默认沿用翻译模型
- 翻译与检测 prompt 可在高级设置中自定义, 支持 `{TEXT}` / `{TARGET_LANG}` / `{TARGET_CODE}` / `{SOURCE_LANG}` / `{SOURCE_CODE}`; 清空恢复内置默认

### Changed

- 「Model」字段更名为「Translate Model」, 与新增的检测模型区分
- 自动翻译进行中禁用「不翻译此语言」开关, 检测完成后恢复

## [1.8.1] - 2026-05-22

### Added

- 阅读与撰写窗口各自独立的目标语言菜单

### Changed

- 设置页改用内联状态提示, 替代弹窗

### Fixed

- 切换目标语言后翻译缓存失效, 不再返回旧语言的结果

## [1.8.0] - 2026-05-21

### Added

- 工具栏按钮右键菜单 (阅读 + 撰写)
- 每个服务记住各自的目标语言
- 深浅两套 SVG 图标

### Changed

- 直接切换翻译 / 还原, 不再经过弹窗
- 工具栏按钮标题显示当前目标语言

## [1.7.1] - 2026-05-20

### Added

- 邮件正文顶部固定显示译后主题栏, 适配深色模式, 还原时移除

## [1.7.0] - 2026-05-20

### Added

- 撰写窗口选区翻译
- 自动翻译 (可选), 角标显示进度
- 自建 LibreTranslate: 可配置 URL + 可选 API key + 测试连接
- Ollama API key, 支持代理 / 远程实例

### Changed

- 阅读与撰写工具栏改用原生按钮, 替换注入式工具栏

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

### Changed

- 兼容 Thunderbird 128–147+

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
