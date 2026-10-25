<!-- 已于 2026-10-25 提交到上游。上游仓库关闭了 Issues，实际发在 Discussions 的 Ideas 分类：
     https://github.com/deepseek-ai/deepseek-harness/discussions/10923 -->

# plugin_manager 增加 `update_bundle` action 的建议

## 问题

通过 `install_bundle`（target 形如 `github:owner/repo`）安装的社区插件，在仓库发布新版后**没有任何更新路径**：

- pnpm 会把 GitHub 依赖钉在安装时的具体 commit 上，新 tag/新提交不会自动跟随；
- 现在唯一的更新方式是「先 `remove_bundle` 再 `install_bundle`」，两步之间插件短暂消失；
- 这两步无法用一条指令表达，所以每个插件的 README 都要贴一整段 agent prompt 教用户怎么绕（本仓库 README 的「更新或卸载」一节就是一整段提示词，且要中英各一份）。

对用户的实际影响：更新摩擦大到很多安装会一直停留在旧版本，直到某次宿主更新把旧版弄坏。

## 建议

给 plugin_manager 增加一个原子的更新 action，例如：

```
action: update_bundle
target: github:owner/repo
```

语义建议：

1. 重新解析 target 的当前 ref（同 `install_bundle` 的解析规则），替换已安装版本；
2. **保留该插件的本地启用状态与本机设置**（等价于现在的「先移除再安装」之后设置仍然保留的行为）；
3. 失败时**旧安装保持原样**——下载或解析失败不能把用户留在「既没有旧的也没有新的」状态；
4. 幂等：target 解析出的 commit 与已安装一致时直接成功返回，不重装；
5. CLI 侧对应 `dsh plugin --profile <profile> update <target>`。

## 验收标准

- 已安装、已启用的插件执行 `update_bundle` 后仍是已启用，版本为新 commit；
- target 不可达时返回错误且旧版本继续可用；
- 与 `desktop` profile 的独占管理规则保持一致（拒绝时给出和 `add` 相同的提示）。

## 背景

来自社区插件 [dsh-hold-to-dictate](https://github.com/jryang1997/dsh-hold-to-dictate) 的维护实践：它的 README 需要用 6 行提示词教 agent 做两次 action 才能完成一次更新。如果上游提供这个 action，多数插件的文档里「更新」一节可以从一整段缩成一行。

---

## English summary

**Feature request: an `update_bundle` action for plugin_manager.** Plugins installed via `install_bundle` with a `github:` target are pinned by pnpm to the commit resolved at install time and have no update path: the only route today is `remove_bundle` followed by `install_bundle`, which cannot be expressed as one instruction, so plugin READMEs carry whole paste-blocks of agent prompt just to update (ours does, twice, in two languages). Proposed: `action: update_bundle, target: github:owner/repo` that re-resolves the ref, replaces the installed copy in place, keeps enablement and local settings, is idempotent when the ref is unchanged, and leaves the previous install intact on failure. CLI counterpart: `dsh plugin --profile <profile> update <target>`.
