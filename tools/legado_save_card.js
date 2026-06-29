// tools/legado_save_card.js
// 保存阅读卡片——支持两种模式：
// 1. saveImage: 保存分享卡片 PNG（全量版，对齐 weread-companion）
// 2. saveToObsidian: 将阅读内容（书摘、进度、笔记）写入 Obsidian 笔记

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// 从用户路径推断 Obsidian Vault 根目录
function guessObsidianVault() {
  const candidates = [
    // 用户已知的 Obsidian 路径
    "W:\\Games\\Obsidian\\Work",
    // 常见路径
    path.join(os.homedir(), "Obsidian"),
    path.join(os.homedir(), "Documents", "Obsidian"),
    path.join(os.homedir(), "Documents", "Obsidian Vault"),
    path.join(os.homedir(), "OneDrive", "Obsidian"),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) {
        // 检查是否是 vault（有 .obsidian 目录或有 md 文件��
        const hasObsidianDir = fs.existsSync(path.join(dir, ".obsidian"));
        const hasMDFiles = fs.readdirSync(dir).some(f => f.endsWith(".md"));
        if (hasObsidianDir || hasMDFiles) return dir;
      }
    } catch { continue; }
  }
  // 回退：桌面
  const desktop = path.join(os.homedir(), "Desktop");
  return fs.existsSync(desktop) ? desktop : os.homedir();
}

/**
 * 保存分享卡片 PNG（对齐 weread-companion）。
 */
async function saveImage(body, dataDir, log) {
  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  let filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";

  if (!dataUrl.startsWith("data:image/png;base64,")) {
    return { ok: false, code: "bad_payload", message: "dataUrl 不是合法 PNG dataURL" };
  }
  if (!filePath || !filePath.toLowerCase().endsWith(".png")) {
    // 自动生成文件名
    const timestamp = Date.now();
    filePath = path.join(guessObsidianVault(), "阅读卡片", `card-${timestamp}.png`);
  }
  // 展开 ~
  if (filePath.startsWith("~")) {
    filePath = path.join(os.homedir(), filePath.slice(1).replace(/^[\\/]/, ""));
  }

  try {
    const b64 = dataUrl.slice("data:image/png;base64,".length);
    const buf = Buffer.from(b64, "base64");
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buf);
    log?.info?.("share card saved", { filePath, bytes: buf.length });
    return { ok: true, filePath, bytes: buf.length };
  } catch (err) {
    log?.error?.("save-card image failed", { error: err.message });
    return { ok: false, code: "write_failed", message: err.message };
  }
}

/**
 * 保存阅读内容到 Obsidian。
 * @param {object} body
 * @param {string} body.type - card / note / progress / quote
 * @param {string} body.bookTitle - 书名
 * @param {string} body.author - 作者
 * @param {string} body.content - 正文内容
 * @param {string} body.chapter - 章节名（可选）
 * @param {number} body.rating - 评分（可选，1-5）
 */
async function saveToObsidian(body, dataDir, log) {
  const { type = "note", bookTitle, author, content, chapter, rating } = body;
  if (!bookTitle && !content) {
    return { ok: false, code: "bad_payload", message: "bookTitle 和 content 至少提供一个" };
  }

  const vaultRoot = guessObsidianVault();

  // 自动生成文件路径：阅读/<书名>/<类型>.md
  const safeName = (bookTitle || "未命名").replace(/[\\/:*?"<>|]/g, "_").slice(0, 50);
  const notesDir = path.join(vaultRoot, "阅读", safeName);
  fs.mkdirSync(notesDir, { recursive: true });

  const timestamp = new Date().toISOString().split("T")[0];
  const safeType = type === "progress" ? "阅读进度" :
                   type === "quote" ? "划线摘录" :
                   type === "card" ? "分享卡片" : "阅读笔记";

  const fileName = `${timestamp}-${safeType}.md`;
  const filePath = path.join(notesDir, fileName);

  // 构建 Markdown 内容
  const lines = [];
  lines.push("---");
  lines.push(`created: ${new Date().toISOString()}`);
  lines.push(`type: ${type}`);
  if (bookTitle) lines.push(`book: "${bookTitle}"`);
  if (author) lines.push(`author: "${author}"`);
  if (chapter) lines.push(`chapter: "${chapter}"`);
  if (rating) lines.push(`rating: ${rating}`);
  lines.push("---");
  lines.push("");
  if (bookTitle) {
    lines.push(`# ${bookTitle}`);
    if (author) lines.push(`> **作者：** ${author}`);
    if (chapter) lines.push(`> **章节：** ${chapter}`);
    if (rating) {
      const stars = "⭐".repeat(Math.min(Math.max(rating, 1), 5));
      lines.push(`> **评分：** ${stars}`);
    }
    lines.push("");
  }
  if (content) {
    if (type === "quote") {
      lines.push(`> ${content.replace(/\n/g, "\n> ")}`);
    } else {
      lines.push(content);
    }
    lines.push("");
  }
  lines.push(`--- *由阅读·伴脑记录于 ${timestamp}*`);

  try {
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
    log?.info?.("saved to obsidian", { filePath, type });
    return { ok: true, filePath, vaultRoot };
  } catch (err) {
    log?.error?.("save-to-obsidian failed", { error: err.message });
    return { ok: false, code: "write_failed", message: err.message };
  }
}

/**
 * 保存卡片入口。
 */
export default async function legado_save_card(body = {}, { dataDir, log } = {}) {
  const obsidian = body.obsidian === true || body.mode === "obsidian";
  if (obsidian) {
    return await saveToObsidian(body, dataDir, log);
  }
  return await saveImage(body, dataDir, log);
}