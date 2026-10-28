<p align="center">
  <img src="./icon.svg" width="72" alt="dsh-nudge">
</p>

<h1 align="center">dsh-nudge</h1>

> **nudge** /nʌdʒ/<br>
> *v.* 轻推；轻触。<br>
> *n.* 一次恰到好处的推动；不接管，只影响。

在 DSH 里，nudge 是你对 agent 的一次轻推。推什么、何时推，由你决定。

<p align="center"><img src="https://github.com/user-attachments/assets/e37dc710-a457-4ec7-ae01-ea2ce2e709c3" width="720" alt="批注与快速回复演示"></p>

## 批注

在窗口里打开「快速批注」，选中对话里的文字，指针旁就会弹出卡片：

- 👍 同意、👎 不同意，或者自己写一句；卡片不重复原文，添加后原文标黄。
- 批注按会话保存在本地，窗口里汇总当前会话的批注，再统一写入输入框或发送。
- 在窗口列表里点一条批注，可以修改或删除。

## 快速回复

- 窗口里的「快捷输入」把常用问法（口径）平铺成按钮：简述、快一点、四行；点一下就把这句发给 agent，回答落回对话。
- 光标在输入框时改为写入草稿，不发送。
- 口径可以在设置里改，最多 8 条；急速模式下双击口径直接执行。
- 投递方式可选直接打断（默认）或排队。

窗口可拖动，也能收起成胶囊，位置记在本地；窄屏默认收起。

## 安装

桌面端先退出应用，再按所用的那一端执行：

```sh
dsh plugin --profile desktop add github:GioStarLC/dsh-nudge   # 桌面端
dsh plugin --profile web     add github:GioStarLC/dsh-nudge   # dsh web
```

重启或刷新窗口，无需构建。

## 开发

```sh
npm install
npm run check
npm run preview:all
```

`check` 跑 client 和 host 检查，提交钩子也会调用；`preview:all` 把界面场景渲染到 `preview-out/`。

## 许可

MIT
