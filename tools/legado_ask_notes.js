// tools/legado_ask_notes.js
// 笔记问答——基于书架数据回答阅读相关问题。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { callLLM } from "./_lib/llm.js";
import { buildBookshelfPrompt } from "./_lib/portrait.js";

export default async function legado_ask_notes(
  { query, bookUrl = null } = {},
  { dataDir, model } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);

    let filtered = books;
    if (bookUrl) {
      filtered = books.filter(b => b.bookUrl === bookUrl);
    }

    // 构建 prompt 供 LLM 分析
    if (!query) {
      return { ok: true, data: { booksCount: filtered.length, message: "query 为空，返回数据概览" } };
    }

    if (!model) {
      return {
        ok: true,
        data: { booksCount: filtered.length, booksPreview: filtered.slice(0, 5) },
        hint: "model 不可用，返回原始数据概览",
      };
    }

    const prompt = buildBookshelfPrompt(filtered, query);
    const llmResult = await callLLM({ model }, prompt);

    if (llmResult.ok) {
      return { ok: true, answer: llmResult.text, data: { booksCount: filtered.length } };
    } else {
      return {
        ok: true,
        answer: `LLM 不可用 (${llmResult.message})，返回数据概览`,
        data: { booksCount: filtered.length, booksPreview: filtered.slice(0, 5) },
      };
    }
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}