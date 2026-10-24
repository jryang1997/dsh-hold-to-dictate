# Issue tracker: GitHub

任务和规格存放在 jryang1997/dsh-hold-to-dictate 的 GitHub Issues。
在仓库目录使用 gh CLI；仓库由 git remote 自动确定。

某个已发布版本没有对应 Issue 时，规格是 CHANGELOG.md 里该版本段，不是「没有规格」。

- 创建：gh issue create --title "..." --body-file <文件>
- 阅读：gh issue view <编号> --comments
- 列表：gh issue list --state open --json number,title,body,labels
- 评论：gh issue comment <编号> --body-file <文件>
- 标签：gh issue edit <编号> --add-label "..." / --remove-label "..."
- 关闭：gh issue close <编号>
多行正文写入临时文件后使用 --body-file，保留真实换行。
技能要求发布到任务系统时，指创建 GitHub Issue；
要求获取任务时，读取 Issue 正文、标签和评论。
配置本身不授权对外发布；按用户当前任务的授权执行。

## Pull requests as a triage surface
PRs as a request surface: no.

## Wayfinding operations
地图用一个 Issue；决策任务用子 Issue，不支持时用任务列表互相链接。
地图标签为 wayfinder:map，子任务标签为 wayfinder:<类型>。
阻塞关系优先使用 GitHub 原生 issue dependencies，
不支持时在正文写 Blocked by: #<编号>。
仅领取阻塞已解除且无人负责的任务；领取时分配给当前执行者。
解决后记录结论、关闭任务，并在地图中加入结论链接。
