// tools/legado_save_booklist.js
// 主题书单 — 保存推荐结果或手动指定书单到 Obsidian，支持列出/分享。

import fs from "node:fs";
import path from "node:path";

const BOOKLIST_DIR = "W:\\Games\\Obsidian\\Work\\无极限\\书单";

/**
 * 主题书单管理。
 * @param {object} input
 * @param {"save"|"list"|"get"|"delete"} [input.action="save"]
 * @param {string} [input.name] - 书单名称（save/get/delete 时必填）
 * @param {string} [input.description] - 书单描述
 * @param {Array} [input.books] - 书籍列表 [{title, author, reason, genres, source}]
 * @param {boolean} [input.shareable=false] - 生成可分享的 Markdown 格式
 */
export default async function legado_save_booklist(
  { action = "save", name, description = "", books = [], shareable = false } = {},
  { log } = {}
) {
  try {
    fs.mkdirSync(BOOKLIST_DIR, { recursive: true });

    // ---- 列出所有书单 ----
    if (action === "list") {
      const files = fs.readdirSync(BOOKLIST_DIR)
        .filter(f => f.endsWith(".md"))
        .map(f => {
          const fp = path.join(BOOKLIST_DIR, f);
          const stat = fs.statSync(fp);
          // 从文件内容读取标题
          try {
            const content = fs.readFileSync(fp, "utf-8").slice(0, 200);
            const titleMatch = content.match(/^#\s*(.+)/m);
            return {
              filename: f,
              title: titleMatch ? titleMatch[1] : f.replace(".md", ""),
              size: stat.size,
              modified: stat.mtime,
            };
          } catch {
            return { filename: f, title: f.replace(".md", "") };
          }
        })
        .sort((a, b) => b.modified - a.modified);
      return { ok: true, lists: files, total: files.length };
    }

    // ---- 查看单个书单 ----
    if (action === "get") {
      if (!name) return { ok: false, code: "bad_payload", message: "name 必填" };
      const safeName = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
      const fp = path.join(BOOKLIST_DIR, `${safeName}.md`);
      if (!fs.existsSync(fp)) return { ok: false, code: "not_found", message: `书单「${name}」不存在` };
      const content = fs.readFileSync(fp, "utf-8");
      return { ok: true, name, content, filePath: fp };
    }

    // ---- 删除 ----
    if (action === "delete") {
      if (!name) return { ok: false, code: "bad_payload", message: "name 必填" };
      const safeName = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
      const fp = path.join(BOOKLIST_DIR, `${safeName}.md`);
      if (!fs.existsSync(fp)) return { ok: false, code: "not_found", message: `书单「${name}」不存在` };
      fs.unlinkSync(fp);
      log?.info?.("booklist deleted", { name });
      return { ok: true, deleted: name };
    }

    // ---- 保存 ----
    if (!name) return { ok: false, code: "bad_payload", message: "name 必填" };
    if (!Array.isArray(books) || books.length === 0) {
      return { ok: false, code: "bad_payload", message: "至少提供一本书" };
    }

    const safeName = name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
    const timestamp = new Date().toISOString().split("T")[0];

    const lines = [];
    lines.push(`# ${name}`);
    lines.push("");
    if (description) lines.push(`> ${description}`);
    lines.push("");
    lines.push(`**${books.length} 本书** · 创建于 ${timestamp}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (let i = 0; i < books.length; i++) {
      const b = books[i];
      lines.push(`### ${i + 1}. 《${b.title || "未知"}》`);
      if (b.author) lines.push(`**作者：** ${b.author}`);
      if (b.genres && b.genres.length) lines.push(`**类型：** ${b.genres.join("、")}`);
      if (b.reason) lines.push(`**推荐理由：** ${b.reason}`);
      if (b.source) lines.push(`*来源：${b.source}*`);
      lines.push("");
    }

    if (shareable) {
      lines.push("---");
      lines.push("*由阅读·伴脑生成 · 可自由分享*");
    }

    const fp = path.join(BOOKLIST_DIR, `${safeName}.md`);
    fs.writeFileSync(fp, lines.join("\n"), "utf-8");
    log?.info?.("booklist saved", { name, count: books.length, filePath: fp });

    return { ok: true, filePath: fp, name, count: books.length };
  } catch (err) {
    return { ok: false, code: "tool_error", message: err.message };
  }
}