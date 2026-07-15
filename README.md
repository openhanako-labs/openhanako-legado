# 阅读·伴脑 (Legado Companion)


![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)


让 Hanako 联结你的开源阅读（Legado），伴你阅读。

## 功能

- 📚 **书架浏览** — 查看书籍列表、封面、简介、阅读进度
- 📖 **直接阅读** — 在 Hanako 中阅读章节，含分页/上下章/字号调节
- 📊 **阅读统计** — 总藏书、已读、进行中、完结等数据一览
- 🧠 **AI 阅读画像** — 基于书架数据生成阅读偏好分析（需 LLM）
- 💬 **思问** — 基于阅读数据的 AI 问答（需 LLM）
- 🎲 **拾遗** — 随机抽一本书
- 🔍 **搜书源** — 搜索在线书源
- ⚙ **分组管理** — 自定义分组名称、持久化保存

## 前提条件

1. 安卓 APP「开源阅读」(Legado) 中启用 Web 服务
   - 设置 → 网络 → Web 服务 → 开启
2. Hanako 中配置好 LLM 模型（画像/思问功能需要）
3. 手机与电脑处于同一局域网

## 安装

### 通过社区插件（TODO）
等待上架社区插件市场。

### 手动安装
```bash
git clone https://github.com/你的用户名/legado-companion.git
# 放入 Hanako 插件目录后重启
```

## 开发

```bash
cp -r W:\Games\Hanako\.hanako\plugins\legado-companion <project-dir>
cd <project-dir>
npm install   # 安装依赖
```

## 技术栈

- **运行环境**: Hanako 插件 SDK
- **后端**: Node.js + Hono (Serverless)
- **前端**: 原生 JS + HTML/CSS (内联, iframe 内运行)
- **数据源**: Legado Web API (HTTP + WebSocket)

## 鸣谢

- [Legado / 开源阅读](https://github.com/gedoor/legado) — 强大的安卓阅读器
- [weread-companion](https://github.com/hanako-skills) — 微信阅读插件，UI 设计参考
- Hanako 插件 SDK 团队

## License

[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html)

## 许可

本项目采用**双重许可**：

- **开源许可**：[GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html) — 开源免费，但修改必须开源
- **商业许可**：闭源使用需购买商业授权，详见 [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md)
