<img src="icon.svg" width="64" height="64" alt="按住说话图标">

# 按住说话

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的输入框里按住鼠标说话，松开后转写成草稿。**不会自动发送。**

[![check](https://github.com/jryang1997/dsh-hold-to-dictate/actions/workflows/check.yml/badge.svg)](https://github.com/jryang1997/dsh-hold-to-dictate/actions/workflows/check.yml)
[![version](https://img.shields.io/github/v/tag/jryang1997/dsh-hold-to-dictate?label=version)](https://github.com/jryang1997/dsh-hold-to-dictate/tags)
[![license](https://img.shields.io/github/license/jryang1997/dsh-hold-to-dictate)](LICENSE)

**简体中文** · [English](README.en.md)

<p align="center">
  <img src="docs/dictation-demo.gif" width="960" alt="实操录屏：悬停出现提示，长按开始录音，上滑后松开取消">
</p>

<p align="center">
  <img src="docs/gesture-overview.zh.svg" width="840" alt="三步示意图：按住约 0.3 秒，说话，松开后文字进入草稿">
</p>

## 装之前：两样东西要先就位

这个插件不自带识别引擎，它复用官方语音输入模块的服务。

| 需要什么 | 怎么确认 |
|---|---|
| 官方模块 `@deepseek-ai/dsh-experimental-voice-input-bundle` | **设置 → 插件** 里已安装、已启用 |
| 本地识别模型 | 点输入框旁的官方麦克风按钮，按提示「下载并准备」 |

模型没准备好时，插件会在录音界面上直接告诉你该去哪里点。但如果整个语音模块缺失，它按设计**不注册任何东西**，界面上不会有任何反应，所以先确认模块在位。

## 安装

### 交给 Agent（推荐）

在 DeepSeek Harness 中切换到 **Creator 模式**，把下面这段发给 Agent：

```text
请使用 plugin_manager，在当前 DeepSeek Harness 配置中安装并启用按住说话插件。

先检查官方语音输入模块 @deepseek-ai/dsh-experimental-voice-input-bundle：
缺失时安装，已安装则确认启用。

然后安装本插件：
action: install_bundle
target: github:jryang1997/dsh-hold-to-dictate
如果已经安装，请检查启用状态，避免重复安装。

请检查语音识别模型是否已准备好。需要我下载模型或授权麦克风时，
告诉我在哪里操作。完成后告诉我如何刷新页面并测试。
```

装完刷新页面，在输入框内长按鼠标约 0.3 秒，说一句话再松开。文字出现在草稿里就能用了。

<details>
<summary>命令行安装</summary>

已有可用的语音输入模块时，也可以运行：

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-hold-to-dictate
```

把 `<profile>` 换成实际配置名。桌面应用的 `desktop` 配置由应用独占管理，命令行会被拒绝，请用上面的 Agent 方式。

</details>

## 怎么用

| 操作 | 怎么做 |
|---|---|
| 录音 | 在输入框内按住鼠标，或按 `Ctrl + Shift + Space` |
| 转写 | 松开 |
| 取消 | 向上拖出输入框，看到取消提示后松开；也可以按 `Esc` |
| 插入被搁置的结果 | 识别期间改动过草稿时，转写文字会留在右下角的小标签里，点一下插到光标处 |

鼠标移入输入框时，工具行中间会显示一行提示，写着「按住鼠标语音输入文字 · 上滑取消」。工具行中间剩下的宽度不足 48 像素时（比如模型名很长），这行提示会被丢掉，而不是压在别的控件上。胶囊的颜色、圆角、阴影和动效曲线都取宿主自己的令牌，所以浅色、深色、降低透明度、增强对比度都跟着走。

## 设置

**设置 → 插件 → 按住说话**。这些设置只影响本机。

| 设置 | 默认 | 可选项 |
|---|---|---|
| 按住时长 | 300 毫秒 | 150 至 800 毫秒。手慢调长，误触调短 |
| 触屏按住时长 | 450 毫秒 | 250 至 1200 毫秒。比鼠标长，因为触屏长按同时是选词 |
| 识别语言 | 跟随宿主 | 跟随宿主 / 中文 / 英文 / 粤语 / 日文 / 韩文 |
| 键盘快捷键 | `Ctrl + Shift + Space` | 关闭 / `Ctrl + Shift + Space` / `Ctrl + Shift + D` / `Ctrl + Shift + M` / `Ctrl + Alt + Space` |
| 悬停提示 | 开 | 开 / 关 |
| 动效 | 完整 | 完整 / 精简（去掉位移与缩放，只保留淡入淡出） |
| 边说边出字（实验） | 关 | 开 / 关，见下节 |

固定「识别语言」可以省掉宿主每次请求自己判断语种的那一步。实测多数长度下更快，也可能持平。

<details>
<summary>设置页面截图（v1.5.2 旧版）</summary>

<p align="center">
  <img src="docs/settings-user.png" width="960" alt="按住说话的设置页面：按住时长、触屏按住时长、动效、悬停提示和键盘快捷键">
</p>

这两张截图来自 v1.5.2。图中的说明文字当时有误，插件名称和图标也是旧的，并且都没有 v2.1.0 的「边说边出字」开关和 v2.2.0 的「识别语言」。以上面的表格为准。

<p align="center">
  <img src="docs/settings-user-2.png" width="960" alt="另一张设置页面截图，包含全部设置和组件运行状态">
</p>

</details>

## 边说边出字（实验）

开启后，录音期间会滚动调用官方本地语音模块，把识别结果写进草稿；松开后用整段录音定稿。

它的行为分两段：

- **短句**：每次都重读整段录音，所以后面的结果可以修正前面的文字。
- **长录音**：一次整段识别超过约 0.7 秒后，改为在**句间停顿**处提交已定稿部分，之后只识别停顿以来的新音频。停顿从录音本身检测，切点取静音段中点，所以不会切在词中间；没有句间停顿就不提交，退回整段识别。已提交的文字在本次录音内冻结。

两段都不影响你最终留下的文字：**松开后的定稿仍然读完整录音。**

实测同一段 21 秒带停顿音频、只换代码版本：出字刷新从 14 次升到 46 次，首次出字从 1246 毫秒降到 802 毫秒。旧版变慢的瓶颈是插件自己固定的 1 秒等待，不是模型。

只对本地语音服务和不含引用芯片的纯文本草稿启用，其他环境沿用松开识别。录音中手动编辑草稿会停止自动替换，最终结果保留在小标签里供你手动插入。两种模式都不是模型原生逐字流。

## 出问题的时候

| 现象 | 原因和处理 |
|---|---|
| 长按完全没反应 | 多半是官方语音输入模块被停用了。插件按设计静默降级，不会报错，所以这里没提示。去 **设置 → 插件** 确认它已启用 |
| 提示语音模型没准备好 | 到 **设置 → 插件 → 语音输入** 点一次「下载并准备」 |
| 提示麦克风不可用 | 在系统设置里允许 Harness 使用麦克风，然后重试 |
| 转写失败，显示服务不可达 | 识别服务那一刻连不上。失败不会吃掉已经录到的音频，用胶囊上的**重试**按钮对同一段录音再来一次，或关掉重录 |

识别期间改过草稿时，结果会退到右下角的小标签里，不会覆盖你的编辑。

## 已知限制

- 长录音分段提交后，已提交的临时文字不再自我修正。松手定稿不受影响。
- 一致性数字来自同一份录音棚素材、同一模型、单机、有限组数，不是跨素材保证。
- 浏览器实测用的是假麦克风喂 WAV 加简化 DOM 桩，**真实麦克风与真实页面未测**。真人即兴口述的停顿检测更难；噪声大时检测不到停顿会退回整段识别，是安全方向。
- 录音上限约 110 秒、4 MiB，以语音服务声明的更小值为准。

## 更新或卸载

GitHub 安装不会自动更新。原因是 pnpm 会把 GitHub 依赖钉在某个具体 commit 上，仓库发了新版也不会自动跟随。所以更新要走「先移除再安装」：

```text
请更新按住说话插件：使用 plugin_manager，先以 action: remove_bundle、
target: @jryang1997/dsh-hold-to-dictate 移除旧安装，再以 action: install_bundle、
target: github:jryang1997/dsh-hold-to-dictate 安装，并提示我刷新页面。
保留官方语音输入模块。
```

装完刷新页面。本机设置会保留。

如果仍安装的是 v1.x 的旧包 `@jryang1997/dsh-composer-dictation`，先移除它再装上面的新包，避免同时启用两份插件。只需卸载时，移除 `@jryang1997/dsh-hold-to-dictate` 即可。

## 需要知道

识别使用 Harness 当前选择的语音服务。官方默认是本地 SenseVoice，音频不出这台电脑；如果你配置了云端服务，录音会发给该服务。

社区插件，与 DeepSeek 无隶属关系。已在 DeepSeek Harness `0.2.0-rc.2` 上测试。

[版本记录](CHANGELOG.md) · [开发说明](CONTRIBUTING.md) · [实现笔记](docs/design.md) · [反馈问题](https://github.com/jryang1997/dsh-hold-to-dictate/issues) · [MIT](LICENSE)
