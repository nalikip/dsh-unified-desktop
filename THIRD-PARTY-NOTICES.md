# Third-Party Notices

本项目（`dsh-unified-desktop`）的聚合层代码——`lib/`、`scripts/`、`test/` 目录下的全部内容——为原创，
以 MIT 许可证发布，版权归 nalikip 所有。

本项目**在运行时依赖、在文档中引用了**以下上游项目。它们的能力通过 MCP 协议在进程边界调用，
本项目不包含其源代码，但按 MIT 许可证的要求，在此保留其版权声明。

---

## 1. dsh-computer-use-win

- **来源**：https://github.com/Yu-tao-Li/dsh-computer-use-win
- **许可证**：MIT License
- **版权**：Copyright (c) Yu-tao-Li
- **本项目如何使用**：通过 stdio 启动其 `mcp/server.mjs`，转发 22 个 UI Automation / OCR 工具调用
- **是否包含其代码**：否

---

## 2. Windows-MCP

- **来源**：https://github.com/CursorTouch/Windows-MCP
- **许可证**：MIT License
- **版权**：Copyright (c) CursorTouch
- **本项目如何使用**：通过 stdio 启动 `windows-mcp.exe`，转发 7 个浏览器 DOM / 截图 / 应用启动工具调用
- **是否包含其代码**：否
- **备注**：`scripts/patch-backend.mjs` 会修改本机安装的 windows-mcp 源码（见 README 警告），
  该修改不被上游认可，仅供本地规避已知缺陷使用。本项目的 `docs/repro/repro-zero-delta.py`
  引用了上游 `MSLLHOOKSTRUCT` 结构体定义，已在该文件内标注来源。

---

## MIT License 全文

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
