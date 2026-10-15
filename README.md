# 熊兔身高模拟器

用两个积木人偶（高个熊、矮个兔）直观比身高差：调身高、手长、脚长，换 37 个姿势，一键复制分享链接。纯前端单文件网页，断网也能玩。

在线玩：https://sophiaashang.github.io/bear-rabbit-height-sim/

## 功能

- 身高 145–200 cm 可调（数字框和滑块），两人身高差上限 35 cm；名字、性别、颜色（预设色板）、耳朵（无 / 熊耳 / 兔耳）都能改
- 手长、脚长可调，用于比手、比脚、比掌印
- 37 个姿势，分「日常」「贴贴」「抱起」「坐·躺」四组，也可看全部；部分姿势带场景和道具（床、沙发、书架、钢琴、雨伞、围巾、衬衫、自拍手机等）
- 比手大小 / 比脚大小 / 比前掌印 / 比后掌印：只画轮廓，直接对比大小
- 三种视角：第三人称、A 视角、B 视角；拖动旋转，双指或滚轮缩放，双击复位；背景带身高刻度线
- 复制链接：把身高、姿势等参数连同一句分享文案一起复制，打开链接自动还原
- 截图导出
- 手机竖屏可玩：姿势列表可收起，触屏可旋转缩放
- 单文件，无需联网

## 本地运行与构建

需要 Node.js。依赖版本已锁定（esbuild 0.24.0、three 0.170.0）。

```
npm install
npm run build
```

构建产物是单个 `dist/index.html`（three 与全部代码已内联），直接用浏览器打开即可，不需要服务器。
仓库里的 `docs/index.html` 是同样的构建产物，供 GitHub Pages 发布（Pages 选 main 分支的 /docs 目录）。改了 `src/` 之后重新构建，并把 `dist/index.html` 复制到 `docs/index.html`。

## 致谢

- [three.js](https://threejs.org/)（MIT）
- 手 / 脚轮廓来自 qwertyaz111 的 hand-size-comparison / foot-size-comparison 工具（其条款：可截图、加工、描摹，禁止营利商用）
- 整体玩法参考 qwertyaz111 的系列模拟器；身高刻度线思路参考 MIT 许可的 height-compare

第三方许可详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 作者与许可

作者：晚风

本项目采用 CC BY-NC 4.0（署名、非商业使用），见 [LICENSE](LICENSE)。手 / 脚轮廓的来源条款禁止营利商用，所以整个项目不可商用。
