```When Editing
本文档作用: 工程工作流程 (可用工具 / 调试 / 发布); MUST NOT 写工程说明 (→ README.md) / LLM 约束 (→ AGENTS.md)
遵循 AGENTS.md 文档编写规范
- 所有段落均为条件段, 根据工程实际决定保留或删除; 存在即为明确流程, MUST NOT 附加强度标记
- 发布内按顺序编号步骤; 顶部 TL;DR ≤ 5 行; 删除子段后重编号保持连续
- 风险点 / 不可逆操作用 `>` 引用块; 高危操作 MUST 标禁用条件
```

# 可用工具

- `gh` 已登录

# 发布

代码变更完成后立即执行（= 需求交付的最后环节）。交付 = 预部署 + push。

## TL;DR

依序执行:

1. 验证: `node --check` 全部 JS + `jq` 全部 JSON
2. 写版本: `manifest.json` + `CHANGELOG.md` + `CHANGELOG.dev.md` 同步编辑 (与 tag 一致)
3. 预部署: `./make_xpi.sh`
4. 发布: commit + annotated tag + push branch + tag

## 1. 验证

```bash
for f in background.js content/translator.js content/composer.js options/options.js; do node --check "$f" || exit 1; done
for f in manifest.json _locales/*/messages.json; do jq -e . "$f" > /dev/null || echo "BAD JSON: $f"; done
```

## 2. 写版本

- 版本号: 默认递增 PATCH (第三位); 超大功能更新/调整 → MINOR; 禁止 → MAJOR（除非人类主动要求）
- `manifest.json#version` + `CHANGELOG.md` + `CHANGELOG.dev.md` 同步编辑 (与 tag 一致)

## 3. 预部署

```bash
./make_xpi.sh   # → thunderbird-translator-v<version>.xpi, 版本号读自 manifest.json
```

产出的 xpi = 交付物, 人类自行装入 Thunderbird 验证。

> 新增 / 重命名源文件后 MUST 同步 `make_xpi.sh` 与 `make_xpi.ps1` 的 include 列表, 否则文件不进包
> `*.xpi` 已在 `.gitignore`, MUST NOT 提交

## 4. 发布

```bash
git add <本次改动的文件>            # MUST NOT `git add -A` / `git add .`
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```
