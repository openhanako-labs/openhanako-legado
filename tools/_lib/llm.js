// _lib/llm.js
// LLM 调用封装——复用 weread-companion 的 llm 逻辑。

import { readCredentials } from "./credentials.js";

/**
 * 调用宿主 LLM 模型。
 * 通过 Hana 的 model.sample capability 调用。
 */
export async function callLLM(ctx, prompt, systemPrompt = "你是一个分析助手。请仔细分析以下内容，给出专业的见解。") {
  if (!ctx || !ctx.model) {
    return { ok: false, message: "LLM 调用上下文不可用" };
  }

  try {
    const response = await ctx.model.sample({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      maxTokens: 2000,
    });

    return { ok: true, text: response?.text || response?.content || "" };
  } catch (err) {
    return { ok: false, message: `LLM 调用失败: ${err.message}` };
  }
}
