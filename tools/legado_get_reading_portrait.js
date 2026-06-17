// tools/legado_get_reading_portrait.js
// AI 阅读画像——基于书架数据生成用户阅读画像。

import { readCredentials } from "./_lib/credentials.js";
import { getBookshelf } from "./_lib/legado-api.js";
import { buildBookshelfPrompt, parsePortraitResponse } from "./_lib/portrait.js";
import { callLLM } from "./_lib/llm.js";

export default async function legado_get_reading_portrait(
  { forceRefresh = false } = {},
  { dataDir, model } = {}
) {
  const { serviceUrl } = readCredentials(dataDir);
  if (!serviceUrl) {
    return { ok: false, code: "no_service", message: "未配置服务地址" };
  }

  try {
    const books = await getBookshelf(serviceUrl, "0", 100);

    if (!model) {
      return {
        ok: false,
        code: "no_model",
        message: "LLM 模型不可用",
        data: { booksCount: books.length },
      };
    }

    const prompt = buildBookshelfPrompt(books, "生成一份详细的阅读画像，分析阅读偏好、题材偏好、阅读节奏等。");
    const llmResult = await callLLM({ model }, prompt);

    if (llmResult.ok) {
      const parsed = parsePortraitResponse(llmResult.text);
      return {
        ok: true,
        portrait: parsed || { raw: llmResult.text },
        data: { booksCount: books.length },
      };
    }

    return {
      ok: false,
      code: "llm_error",
      message: llmResult.message,
      data: { booksCount: books.length },
    };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message };
  }
}