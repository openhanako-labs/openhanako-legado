// tools/legado_recap.js
// 智能前情提要 — AI 基于当前阅读位置生成上下文回顾。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf, getBookChapters, getChapterContent } from "./_lib/legado-api.js";
import { chatCompletion } from "./_lib/llm.js";

export default async function legado_recap(
  { bookUrl, forceRefresh = false } = {},
  ctx = {}
) {
  const { dataDir, log, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) return { ok: false, code: "no_service", message: "未配置服务地址" };

  try {
    const books = await getBookshelf(serviceUrl, "0", 200);
    const book = books.find(b => b.bookUrl === bookUrl);
    if (!book) return { ok: false, code: "not_found", message: "该书不在书架中" };

    const curIdx = book.durChapterIndex ?? 0;
    const chapters = await getBookChapters(serviceUrl, bookUrl);

    // 收集当前章节及前 3 章的内容用于生成回顾
    const recapStart = Math.max(0, curIdx - 3);
    const contextChunks = [];

    for (let i = recapStart; i <= curIdx; i++) {
      const ch = chapters[i];
      const chTitle = typeof ch === "string" ? ch : (ch.title || ch.name || `第${i + 1}章`);
      let content = "";
      try { content = await getChapterContent(serviceUrl, bookUrl, i); } catch { continue; }
      if (typeof content === "string") {
        // 只取每章最后 500 字（最近的剧情）
        const tail = content.slice(-500);
        contextChunks.push(`【${chTitle}】\n${tail}`);
      }
    }

    if (contextChunks.length === 0) {
      return { ok: true, recap: null, hint: "暂无法获取章节内容生成回顾" };
    }

    const contextText = contextChunks.join("\n\n");

    if (!bus?.request) {
      // LLM 不可用时，返回原始内容摘要
      return {
        ok: true,
        recap: null,
        snippet: contextText.slice(0, 300),
        hint: "LLM 不可用，已返回原文摘要",
      };
    }

    const prompt = `你是一个阅读助手。读者正在读《${book.name}》${book.author ? "（" + book.author + "）" : ""}，当前读到第 ${curIdx + 1} 章。请根据以下最近的剧情内容，生成一段 150-200 字的前情提要，帮助读者快速回顾之前的情节。语言自然流畅，不要输出 JSON 或列表。\n\n${contextText}`;

    const llmResult = await chatCompletion(ctx, {
      operation: "legado-companion-recap",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 500,
    });

    if (llmResult.ok) {
      return {
        ok: true,
        recap: llmResult.text,
        bookTitle: book.name,
        author: book.author,
        currentChapter: typeof chapters[curIdx] === "string" ? chapters[curIdx] : (chapters[curIdx]?.title || chapters[curIdx]?.name || `第${curIdx + 1}章`),
        chapterIndex: curIdx,
      };
    }

    return {
      ok: true,
      recap: null,
      snippet: contextText.slice(0, 300),
      hint: llmResult.message || "生成失败",
    };
  } catch (err) {
    return { ok: false, code: err.code || "unknown", message: err.message };
  }
}