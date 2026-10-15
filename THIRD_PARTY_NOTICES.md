# 第三方声明 (Third-party notices)

本项目的构建产物（`dist/index.html`、`docs/index.html`）内联了 three.js 的代码。
构建时 `legalComments: 'none'` 会去掉产物内的许可注释，因此在此随仓库提供其版权与许可声明。

## three.js

- 版本：0.170.0
- 许可：MIT
- 版权：Copyright © 2010-2024 three.js authors
- 主页：https://threejs.org/

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## 手 / 脚轮廓（qwertyaz111）

`src/printsPaths.js` 与 `src/render.js` 中用于「比手 / 比脚 / 比掌印」的手、脚轮廓 SVG 路径，取自 qwertyaz111 的 hand-size-comparison / foot-size-comparison 工具。
其条款：可截图、加工、描摹，禁止营利商用。因此本仓库整体采用非商业许可（CC BY-NC 4.0），使用这部分内容时请同样遵守其条款。

## 玩法与思路参考

- 整体玩法参考 qwertyaz111 的系列模拟器。
- 身高刻度线思路参考 MIT 许可的 height-compare（仅为思路参考）。

## 构建工具

esbuild 0.24.0（MIT）仅用于构建，不随产物分发。
