<!-- 草稿：未发布。发布前由维护者审阅。 -->

# 给没有稳定扩展 API 的宿主应用写输入框插件

DeepSeek Harness（下文称 DSH）是一个桌面端 AI 编程宿主：你在它的输入框里对 agent 讲话。dsh-hold-to-dictate 是我为它写的社区插件——按住输入框说话，松开后转写文字落进草稿，从不自动发送。DSH 有插件系统，但输入框内部没有一份稳定的扩展 API，能用的全是内部接口，版本之间会动。这篇文章记录把插件挂进宿主输入框的过程中学到的四件事；所有结论都对照 DSH `0.2.0-rc.2` 核过：一边读发布包 `app.asar` 里的代码，一边看运行时真实的 slot 树。它不是功能介绍，是一份逆向宿主应用、并在宿主内部结构变动时优雅退化的实地记录。

## 一、对内部接口断言行为，而不是断言位置

读宿主的发布包，很快会攒出一份地址清单：`inputActions` 在 `dsh-client-ui-conversation/lib/client.js:13462-13485`，卡片容器 `data-composer-card` 在同一文件 17444 行，语音服务在 `dsh-experimental-client-ui-voice-input/lib/client.js:5818`。这份清单只对一个版本有效。行号是那个版本出厂时的坐标，不是稳定地址——这些行号在 `0.1.7-rc.2` 到 `0.2.0-rc.2` 之间就整体移动过一次。运行时若按行号或 DOM 下标去够这些接口，一次宿主更新就够空了。

所以检查一律写成行为断言。插件不从全局猜位置，而是从自己被渲染的节点往上走到 `div[data-composer-card]`；编辑器按属性认：Lexical 编辑器，`div[data-composer-input]`，带 `contenteditable` 与 `role=textbox`；插槽的存在和类型在运行时的 slot 树里当场验证。file:line 写进设计文档给人看，帮后来者快速定位；代码只信当场观察到的行为。

## 二、选一个不与宿主争座位的 slot

宿主输入框附近有几个 slot（插槽，宿主 UI 预留的挂载位）。最显眼的是 `conversation.input.activity`：宿主自带的麦克风（`VoiceInput`）就坐在这里。但它是单例槽，同一优先级再注册会直接抛异常；就算注册成功，也是把宿主自己的按钮顶下去。占它等于和宿主抢座位，以后每次宿主更新你都站在冲突现场。

插件最终落在 `conversation.input.overlay`。它由 `conversation.composer.bar` 声明，渲染在输入框卡片内部，是一个 `replaceRisk` 为 `none` 的 list 槽：新 id 只是加入列表，和宿主自带的 `slash-menu`、`command-popup`、`feedback-dialog` 并存，谁也不碰谁。选 slot 之前先弄清它的基数和现有占用，这比 slot 的名字重要得多。

## 三、零高度锚点是定位上下文，不是画布

overlay 的挂载几何反直觉，直接看结构：

```text
div[data-composer-card]                     ← position: relative
  └ div.<hash>_overlayAnchor                ← height: 0; position: absolute; inset: 0 0 auto
      └ div[data-slot="conversation.input.overlay"]   ← display: contents
          └ 插件自己的层
```

锚点 `overlayAnchor` 的高度是 0、绝对定位、`inset: 0 0 auto`——它不是盖住卡片的画布，而是贴在卡片上缘的一个定位上下文。在它里面写 `inset: 0`，会塌缩成看不见的一条线；宿主自己的用法（`dsh-client-ui-input-trigger` 里的 MenuView）是 `bottom: calc(100% + 4px); left: 0; right: 0`，让菜单浮到卡片上方。插件沿用同一套几何：录音胶囊以 `bottom: calc(100% + 10px)` 悬浮在卡片上方居中，和 slash-menu 用同一个套路。

留在卡片内部的那层要另想办法。锚点零高，层必须自己有高度，组件用 `ResizeObserver` 量卡片，不猜。这层也刻意不盖住任何东西：早期版本曾把整个输入框填成录音面板，两个后果立刻显形——录音期间草稿消失了，恰恰是用户可能还想看一眼的时候；退场动画播放时，那块正在淡出的透明面板变成盖在编辑器上的隐形点击盾。现在的层只在卡片外缘画轮廓，指针纪律是硬性的：层本身 `pointer-events: none`；对卡片的监听走捕获阶段，按住阈值达到之前不 `preventDefault` 任何事件，单击、移动光标、框选都和没装插件时一样；指针移动超过 10 px 就解除手势。悬浮在卡片上方的一切，不接任何指针事件。

## 四、缺件时降级，而不是报错

转写能力来自 `ctx.remote.speech`，一个客户端 Cordis 服务（Cordis 是宿主使用的依赖注入框架）。关键是，它不在宿主默认装配的 remote 服务里：官方语音输入插件自己用 `ctx.remote.$mount(TYPERT_REMOTE)` 把它挂上去。这反而给第三方留了一条干净的路——直接注入命名空间，`ctx.inject(['remote.speech', 'slots'], scope => ...)`，就能调用 `scope.remote.speech.transcribe`。代价也明摆着：官方语音模块被停用时，这个命名空间不存在，注入回调永远不会执行，于是插件什么也不注册——不报错，不留半个界面。这不是意外分支，而是设计姿态：既然内部接口都会动，「缺席」就必须是正常路径。同一姿态贯穿别处：`insertText` 在草稿修订号 `draftRev` 已前进、或输入框正忙（`adjudicating`、`submitting`）时返回 `false`，插件就把转写留在右下角的小标签里，等用户自己放，不覆盖、不抛错。硬顶着宿主写，不如缺什么就少做什么。

## 如果你要写宿主插件

- 先读宿主发布包和运行时的 slot 树，但把 file:line 当快照，不当契约；运行时只断言行为，不断言位置。
- 选 slot 先看基数和占用：单例槽注定和宿主冲突，优先加入一个 list。
- 渲染前弄清锚点几何：零高度锚点是定位上下文，不是画布；画在宿主上方的元素永远 `pointer-events: none`。
- 指针监听走捕获阶段，阈值达到前不 `preventDefault`，并给位移留一个解除距离。
- 依赖别的插件挂载的服务时用注入；服务缺席就整个不注册，把降级设计成正常路径。

代码与完整实现笔记：https://github.com/jryang1997/dsh-hold-to-dictate ，细节见仓库内的 `docs/design.md`。
