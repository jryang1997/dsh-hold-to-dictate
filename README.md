<img src="icon.svg" width="64" height="64" alt="Hold to talk 图标">

# Hold to talk

**简体中文** · [English](README.en.md)

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的输入框里按住说话，松开后转写到草稿。**不会自动发送。**

<p align="center">
  <img src="docs/dictation-demo.gif" width="960" alt="实际操作录屏：鼠标悬停显示提示，长按开始录音，上滑后松开取消">
</p>

实操演示：悬停提示 → 长按录音 → 上滑取消。

## 交给 Agent 安装

在 DeepSeek Harness 中切换到 **Creator 模式**，把下面这段复制给 Agent：

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

**官方语音输入模块必须安装并启用，识别模型也要准备好。** 首次使用时，点击输入框旁的官方麦克风按钮，按提示下载模型并允许麦克风访问。本插件复用它的识别服务。

安装完成后刷新页面，在输入框内长按鼠标约 0.3 秒，录一句话再松开；文字出现在草稿中就可以使用了。

<details>
<summary>命令行安装</summary>

已有可用的语音输入模块时，也可以运行：

```bash
dsh plugin --profile <profile> add github:jryang1997/dsh-hold-to-dictate
```

把 `<profile>` 换成实际配置名。桌面应用的 `desktop` 配置由应用管理，请使用上面的 Agent 安装方式。

</details>

## 怎么用

- 在输入框内按住鼠标说话，松开后转写。
- 录音时向上拖动或移出输入框，看到取消提示后松开，即可丢弃；也可以按 `Esc` 取消。
- 键盘操作：按住 `Ctrl + Shift + Space` 录音，松开后转写。
- 识别期间修改了草稿，转写文字会保留在小标签中，点击即可插入。

在 **设置 → 插件 → 按住说话** 中，可以调整长按时长、快捷键、悬停提示、识别语言和动效。

开启 **边说边出字（实验）** 后，录音期间会滚动调用官方本地语音模块，将真实识别结果写入草稿，松开后用整段录音定稿。默认关闭。短句每次都重读整段，所以后续结果可以修正之前的文字；录音长到一次识别明显变慢后，改为在句间停顿处分段提交、只识别停顿之后的新音频，出字节奏因此保持每秒数次而不再越说越慢——代价是这段时间里已提交的文字不再自我修正，**松开后的定稿仍读完整录音，不受影响**。两种模式都不是模型原生逐字流。

此模式只对本地语音服务和不含引用芯片的纯文本草稿启用；环境不支持时保留松开识别。录音中手动编辑草稿会停止自动替换，最终结果保留供手动插入。取消时撤回仍属于本轮的临时文字；若你已编辑草稿，则保留你的编辑。

<p align="center">
  <img src="docs/settings-user.png" width="960" alt="按住说话的设置页面：长按时长、触屏长按时长、动效、悬停提示及键盘快捷键">
</p>

设置截图来自旧版 v1.5.2；当前版本已修复图中的说明文字，并更新了插件名称和图标。v2.1.0 新增的「边说边出字（实验）」开关、以及 v2.2.0 新增的「识别语言」都没有出现在这些旧截图中。

<details>
<summary>另一张设置截图</summary>

<p align="center">
  <img src="docs/settings-user-2.png" width="960" alt="按住说话的另一张设置页面截图，包含全部设置和组件运行状态">
</p>

</details>

## 更新或卸载

**v2.2.0 更新后**，刷新页面即可。**边说边出字（实验）** 仍需在 **设置 → 插件 → 按住说话** 中开启，不开启时沿用松开识别；同一处新增了**识别语言**，默认「跟随宿主」，固定成你实际说的语言会更快。

GitHub 安装不会自动更新。需要更新时，把这段交给 Harness 里的 Agent：

```text
请更新按住说话插件：使用 plugin_manager，先以 action: remove_bundle、
target: @jryang1997/dsh-hold-to-dictate 移除旧安装，再以 action: install_bundle、
target: github:jryang1997/dsh-hold-to-dictate 安装，并提示我刷新页面。
保留官方语音输入模块。
```

如果仍安装的是 v1.x 的旧包 `@jryang1997/dsh-composer-dictation`，先让 Agent 移除这个旧包，再安装上面的新包，避免同时启用两份插件。原有本机设置会保留。

只需卸载时，让 Agent 移除 `@jryang1997/dsh-hold-to-dictate` 即可。

## 需要知道

语音识别使用 Harness 当前选择的服务。官方默认配置使用本地 SenseVoice；如果配置了云端服务，录音会发给该服务。

社区插件，与 DeepSeek 无隶属关系。已在 DeepSeek Harness `0.2.0-rc.2` 上测试。

[版本记录](CHANGELOG.md) · [开发说明](CONTRIBUTING.md) · [实现笔记](docs/design.md) · [反馈问题](https://github.com/jryang1997/dsh-hold-to-dictate/issues) · [MIT](LICENSE)
