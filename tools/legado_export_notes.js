// tools/legado_export_notes.js
// 笔记导出 — 按书聚合或全部导出为 Markdown，支持写入 Obsidian。

import fs from "node:fs";
import path from "node:path";
import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getAllBookNotes } from "./_lib/legado-api.js";

const DIARY_BASE = "W:\\Games\\Obsidian\\Work\\无极限";

export default async function legado_export_notes(
  { action = "preview", bookUrl = null, format = "markdown", writeToObsidian = false } = {},
  { dataDir, log } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);

    let allNotes = [];
    if (bookUrl) {
      // 导出单本书的笔记
      const { getBookNotes } = await import("./_lib/legado-api.js");
      allNotes = await getBookNotes(serviceUrl, bookUrl);
      const book = books.find(b => b.bookUrl === bookUrl);
      const bookName = book?.name || "未知";
      for (const n of allNotes) { if (!n.bookName) n.bookName = bookName; }
    } else {
      // 导出所有笔记
      allNotes = await getAllBookNotes(serviceUrl, books, 3);
    }

    if (allNotes.length === 0) {
      return { ok: true, hint: "暂无笔记", notes: [] };
    }

    // 按时间倒序
    allNotes.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));

    // preview: 返回原始数据
    if (action === "preview") {
      return {
        ok: true,
        notes: allNotes.slice(0, 50),
        totalCount: allNotes.length,
      };
    }

    // 生成 Markdown
    const lines = [];
    lines.push("# 📝 阅读笔记导出");
    lines.push("");
    lines.push(`导出时间：${new Date().toLocaleString("zh-CN")}`);
    lines.push(`笔记总数：${allNotes.length}`);
    if (bookUrl) {
      const book = books.find(b => b.bookUrl === bookUrl);
      lines.push(`来源书籍：${book?.name || "未知"}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");

    // 按书聚合
    const byBook = {};
    for (const n of allNotes) {
      const key = n.bookName || "未知";
      if (!byBook[key]) byBook[key] = [];
      byBook[key].push(n);
    }

    for (const [bookName, notes] of Object.entries(byBook)) {
      lines.push(`## 《${bookName}》`);
      lines.push("");
      for (const n of notes) {
        lines.push(`> ${n.content || ""}`);
        if (n.chapterName) lines.push(`*— ${n.chapterName}*`);
        if (n.createTime) {
          const d = new Date(n.createTime);
          lines.push(`*${d.toLocaleDateString("zh-CN")}*`);
        }
        lines.push("");
      }
    }

    const markdown = lines.join("\n");

    if (writeToObsidian) {
      const fileName = `笔记导出-${new Date().toISOString().split("T")[0]}.md`;
      const filePath = path.join(DIARY_BASE, "阅读", fileName);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, markdown, "utf-8");
      log?.info?.("notes exported to obsidian", { filePath, count: allNotes.length });
      return { ok: true, filePath, count: allNotes.length };
    }

    return { ok: true, markdown, count: allNotes.length };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}