// tools/legado_get_reading_portrait.js
// AI 阅读画像——基于书架数据生成用户阅读画像。
// LLM 通过宿主能力自动调用，用户无需配置模型。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { buildBookshelfPrompt, parsePortraitResponse } from "./_lib/portrait.js";
import { chatCompletion } from "./_lib/llm.js";

export default async function legado_get_reading_portrait(
  { forceRefresh = false } = {},
  ctx = {}
) {
  const { dataDir, bus } = ctx;
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);

    if (!bus?.request) {
      // LLM 不可用时，降级返回数据摘要（不直接报错）
      return {
        ok: true,
        portrait: null,
        data: {
          booksCount: books.length,
          hint: "LLM 不可用，已返回原始数据摘要",
          sample: books.slice(0, 5).map(b => ({
            title: b.name,
            author: b.author,
            kind: b.kind,
            progress: b.durChapterTitle || "未开始",
          })),
        },
      };
    }

    const prompt = buildBookshelfPrompt(books, "生成一份详细的阅读画像，分析阅读偏好、题材偏好、阅读节奏等。");
    const llmResult = await chatCompletion(ctx, {
      operation: "legado-companion-portrait",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      maxTokens: 1500,
    });

    if (llmResult.ok) {
      const parsed = parsePortraitResponse(llmResult.text);
      return {
        ok: true,
        portrait: parsed || { raw: llmResult.text },
        data: { booksCount: books.length, via: llmResult.via },
      };
    }

    // LLM 调用失败：返回数据兜底
    return {
      ok: true,
      portrait: null,
      data: {
        booksCount: books.length,
        code: llmResult.code,
        hint: llmResult.hint || llmResult.message || "LLM 暂不可用",
        sample: books.slice(0, 5).map(b => ({
          title: b.name,
          author: b.author,
          kind: b.kind,
        })),
      },
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}