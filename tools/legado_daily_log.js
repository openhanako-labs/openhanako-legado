// tools/legado_daily_log.js
// 每日阅读打卡 — 读取 Legado 阅读数据，仅在有实际阅读变化时写入 Obsidian 日记。
// 变化检测：与上一次快照对比，书目/章节/进度无变化则不写。

import fs from "node:fs";
import path from "node:path";
import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getAllBookNotes } from "./_lib/legado-api.js";

// Obsidian 日记路径
const DIARY_BASE = "W:\\Games\\Obsidian\\Work\\无极限\\03-日记";
const DEFAULT_CATEGORY = "日常";

/** 构建当前快照键（用于变化检测） */
function buildSnapshotKey(books) {
  const reading = books.filter(b => b.durChapterTitle && b.durChapterTitle.length > 0);
  return reading.map(b => ({
    name: b.name || "",
    chapter: b.durChapterTitle || "",
    index: b.durChapterIndex ?? -1,
    total: b.totalChapterNum ?? 0,
  }));
}

/** 比较两个快照是否相同 */
function snapshotEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].chapter !== b[i].chapter || a[i].index !== b[i].index) {
      return false;
    }
  }
  return true;
}

/** 加载上次快照 */
function loadSnapshot(dataDir) {
  try {
    const fp = path.join(dataDir, "legado-companion", "daily-snapshot.json");
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {}
  return null;
}

/** 保存快照 */
function saveSnapshot(dataDir, snapshot, dateStr) {
  try {
    const dir = path.join(dataDir, "legado-companion");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "daily-snapshot.json"), JSON.stringify({ date: dateStr, books: snapshot }, null, 2), "utf-8");
  } catch {}
}

/** 文件命名 */
function getDiaryFilename(year, month, day) {
  return `${year}-${month}-${day}-阅读记录.md`;
}

/**
 * 每日阅读打卡。
 * @param {object} input
 * @param {string} [input.date] - 指定日期（YYYY-MM-DD）
 * @param {string} [input.category="日常"]
 * @param {boolean} [input.force=false] - 强制写入，跳过变化检测
 */
export default async function legado_daily_log(
  { date = null, category = DEFAULT_CATEGORY, force = false } = {},
  { dataDir, log } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);
    if (books.length === 0) {
      return { ok: true, hint: "书架为空，不生成日记", wrote: false };
    }

    const now = date ? new Date(date) : new Date();
    const y = String(now.getFullYear());
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const dateStr = `${y}-${mo}-${d}`;

    const reading = books.filter(b => b.durChapterTitle && b.durChapterTitle.length > 0);
    const finished = books.filter(b =>
      (b.wordCount || "").includes("完结") || (b.kind || "").includes("完结")
    );

    // ---- 变化检测 ----
    const currentSnapshot = buildSnapshotKey(books);
    if (!force) {
      const last = loadSnapshot(dataDir);
      const lastDate = last?.date || "";
      if (last && last.books && snapshotEqual(currentSnapshot, last.books)) {
        log?.info?.("daily log skipped: no changes since", { lastDate });
        return {
          ok: true,
          skipped: true,
          reason: "自上次记录后无阅读变化",
          lastDate,
          wrote: false,
        };
      }
    }

    // ---- 变化标记：列出变化项目 ----
    const changes = [];
    const last = loadSnapshot(dataDir);
    if (last?.books) {
      const lastMap = {};
      for (const b of last.books) lastMap[b.name] = b;
      for (const b of currentSnapshot) {
        const prev = lastMap[b.name];
        if (!prev) { changes.push(`📖 开始阅读《${b.name}》`); }
        else if (b.chapter !== prev.chapter) {
          changes.push(`📖 《${b.name}》→ ${b.chapter}`);
        }
      }
      for (const b of last.books) {
        if (!currentSnapshot.find(c => c.name === b.name)) {
          changes.push(`✅ 读完《${b.name}》`);
        }
      }
    }

    // ---- 生成 Markdown ----
    const lines = [];
    lines.push(`# 📖 阅读记录 — ${dateStr}`);
    lines.push("");
    lines.push("## 今日操作");
    lines.push("");
    if (changes.length > 0) {
      lines.push("今日阅读变化：");
      for (const c of changes) lines.push(`- ${c}`);
    } else {
      lines.push("阅读数据无变化，记录当前书架状态。");
    }
    lines.push("");
    lines.push("## 📊 阅读概览");
    lines.push("");
    lines.push(`| 指标 | 数值 |`);
    lines.push(`| --- | --- |`);
    lines.push(`| 总藏书 | ${books.length} 本 |`);
    lines.push(`| 在读 | ${reading.length} 本 |`);
    lines.push(`| 已完结 | ${finished.length} 本 |`);
    lines.push("");
    lines.push("## 📚 在读书籍");
    lines.push("");

    if (reading.length === 0) {
      lines.push("（暂无）");
      lines.push("");
    } else {
      for (const b of reading.slice(0, 10)) {
        const progress = b.totalChapterNum > 0
          ? `${Math.round(((b.durChapterIndex || 0) + 1) / b.totalChapterNum * 100)}%`
          : "";
        lines.push(`- **《${b.name || "未知"}》** — ${b.author || "未知"}`);
        lines.push(`  - ${b.durChapterTitle || ""}`);
        if (progress) lines.push(`  - 进度：${progress}`);
        lines.push("");
      }
    }

    // ---- 近期笔记 ----
    try {
      const allNotes = await getAllBookNotes(serviceUrl, books.slice(0, 5), 2);
      const recentNotes = allNotes
        .sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
        .slice(0, 5);
      if (recentNotes.length > 0) {
        lines.push("## 📝 近期笔记/划线");
        lines.push("");
        for (const n of recentNotes) {
          lines.push(`- **《${n.bookName || ""}》** ${n.chapterName || ""}`);
          lines.push(`  > ${(n.content || "").slice(0, 100)}`);
          lines.push("");
        }
      }
    } catch {}

    lines.push("## 文件变更");
    lines.push("");
    lines.push(`- \`03-日记\\${category}\\${getDiaryFilename(y, mo, d)}\` — 阅读记录`);
    lines.push("");
    lines.push(`—— 奥菲莉娅`);

    // ---- 写入日记 ----
    const catDir = path.join(DIARY_BASE, category);
    const filePath = path.join(catDir, getDiaryFilename(y, mo, d));
    fs.mkdirSync(catDir, { recursive: true });

    if (fs.existsSync(filePath)) {
      // 追加模式：在文件末尾加阅读更新块
      const existing = fs.readFileSync(filePath, "utf-8");
      const appendSection = `\n\n---\n\n## 📖 ${dateStr} 更新\n\n${lines.slice(7).join("\n")}`;
      fs.writeFileSync(filePath, existing + appendSection, "utf-8");
    } else {
      fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
    }

    // 保存当前快照
    saveSnapshot(dataDir, currentSnapshot, dateStr);

    log?.info?.("daily log written", { filePath, changes: changes.length });
    return {
      ok: true,
      filePath,
      date: dateStr,
      changes,
      stats: { totalBooks: books.length, reading: reading.length, finished: finished.length },
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}