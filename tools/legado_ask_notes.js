// tools/legado_ask_notes.js
// 思问——基于书架数据的 AI 问答。
// LLM 通过宿主能力自动调用，用户无需配置模型。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { chatCompletion } from "./_lib/llm.js";
import { buildAskPrompt } from "./_lib/portrait.js";

export default async function legado_ask_notes(
  { query, bookUrl = null } = {},
  ctx = {}
) {
  const { dataDir, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);
    const filtered = bookUrl ? books.filter(b => b.bookUrl === bookUrl) : books;

    if (!query) {
      return {
        ok: true,
        data: {
          booksCount: filtered.length,
          message: "query 为空，返回数据概览",
          sample: filtered.slice(0, 10).map(b => ({
            title: b.name,
            author: b.author,
            kind: b.kind,
            progress: b.durChapterTitle || "未开始",
          })),
        },
      };
    }

    if (!bus?.request) {
      // LLM 不可用：返回数据摘要 + 引导提示
      return {
        ok: true,
        answer: null,
        data: {
          booksCount: filtered.length,
          sample: filtered.slice(0, 5).map(b => ({
            title: b.name,
            author: b.author,
            kind: b.kind,
            intro: (b.intro || "").slice(0, 100),
          })),
          hint: "AI 模型不可用，已返回原始数据。可在 Hanako 设置中配置默认模型。",
        },
      };
    }

    const prompt = buildAskPrompt(filtered, query);
    const llmResult = await chatCompletion(ctx, {
      operation: "legado-companion-ask-notes",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      maxTokens: 1500,
    });

    if (llmResult.ok) {
      return {
        ok: true,
        answer: llmResult.text,
        data: { booksCount: filtered.length, via: llmResult.via },
      };
    }

    // LLM 失败：降级返回数据
    return {
      ok: true,
      answer: null,
      data: {
        booksCount: filtered.length,
        code: llmResult.code,
        hint: llmResult.hint || llmResult.message || "AI 暂不可用，已返回原始数据",
        sample: filtered.slice(0, 5).map(b => ({
          title: b.name,
          author: b.author,
          kind: b.kind,
          intro: (b.intro || "").slice(0, 100),
        })),
      },
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}