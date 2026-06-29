// tools/_lib/llm.js
// LLM 调起封装：签名对齐 weread-companion，链路一致。
// 内部走 ctx.bus.request：
//   - 优先 model:sample-text（单次调用，最贴合）
//   - 降级 session:send（复用 plugin-private session）
//   - 最后降级 utility:call-text（老路径）
//
// 设计要点：
//   - 不需要用户配置模型：直接走宿主能力，由 Hanako 全局配置决定
//   - operation 必填：用于宿主侧用量归因
//   - 失败分层：no_bus / missing_messages / bus_threw / llm_error / llm_empty
//   - 60s 默认超时（LLM 长生成需要）

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_TOKENS = 800;
const VALID_ROLES = new Set(["system", "user", "assistant"]);

// session 缓存：plugin 进程内复用
let _sessionPromise = null;
function ensureSession(ctx) {
  if (_sessionPromise) return _sessionPromise;
  _sessionPromise = (async () => {
    try {
      const s = await ctx.bus.request("session:create", {
        ownerPluginId: ctx.pluginId,
        visibility: "plugin_private",
        title: "legado-companion-llm",
        thinkingLevel: "off",
        memoryEnabled: false,
      }, { timeout: 15_000 });
      if (s && s.sessionPath) {
        try {
          await ctx.bus.request("session:update", {
            sessionPath: s.sessionPath,
            thinkingLevel: "off",
          }, { timeout: 5_000 });
        } catch { /* 忽略 */ }
      }
      if (s && s.sessionPath) return s.sessionPath;
    } catch (e) {
      ctx?.log?.warn?.("llm.ensureSession:create failed", { error: e?.message });
    }
    return null;
  })();
  return _sessionPromise;
}

/** 从多种可能的返回形态里抠出文本 */
function extractText(result) {
  if (!result || typeof result !== "object") return "";
  if (typeof result.text === "string" && result.text) return result.text;
  if (typeof result.response === "string" && result.response) return result.response;
  if (typeof result.content === "string" && result.content) return result.content;
  if (result.message && typeof result.message === "object") {
    if (typeof result.message.content === "string") return result.message.content;
    if (Array.isArray(result.message.content)) {
      const t = result.message.content.map((c) => c?.text || "").join("");
      if (t) return t;
    }
  }
  if (Array.isArray(result.choices)) {
    const c = result.choices[0];
    if (c?.message?.content) return typeof c.message.content === "string" ? c.message.content : "";
    if (c?.text) return c.text;
  }
  return "";
}

/**
 * 调宿主 LLM（统一接口）。
 * @param {object} ctx  host 注入的 plugin ctx（含 bus / dataDir / log / sessionPath）
 * @param {Object} opts
 * @param {string} opts.operation          必填：用量归因 ID，建议 'legado-companion-<action>'
 * @param {Array}  opts.messages            必填：OpenAI 格式多轮消息 [{role, content}]
 * @param {string} [opts.systemPrompt]     可选：拼到 messages 最前一条 system
 * @param {number} [opts.temperature]      默认 0.4
 * @param {number} [opts.maxTokens]        默认 800
 * @param {number} [opts.timeoutMs]        默认 60_000
 * @returns {Promise<{ok:true,text:string} | {ok:false,code:string,message?:string,hint?:string}>}
 */
export async function chatCompletion(ctx, opts = {}) {
  const log = ctx?.log;

  if (!ctx?.bus?.request) {
    return {
      ok: false,
      code: "no_bus",
      hint: "宿主未暴露 bus.request，无法调 LLM。请确认 Hanako 启动正常。",
    };
  }

  const operation = typeof opts.operation === "string" && opts.operation.trim()
    ? opts.operation.trim()
    : null;
  if (!operation) {
    return { ok: false, code: "missing_messages", hint: "operation 必填（宿主用量归因 ID）。" };
  }

  const rawMessages = Array.isArray(opts.messages) ? opts.messages : null;
  if (!rawMessages || rawMessages.length === 0) {
    return { ok: false, code: "missing_messages", hint: "请提供 messages 数组。" };
  }

  const systemPrompt = typeof opts.systemPrompt === "string" && opts.systemPrompt.trim()
    ? opts.systemPrompt.trim()
    : "";

  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  for (const m of rawMessages) {
    if (!m) continue;
    if (!VALID_ROLES.has(m.role)) continue;
    if (typeof m.content !== "string" || !m.content) continue;
    messages.push({ role: m.role, content: m.content });
  }
  if (messages.length === 0) {
    return { ok: false, code: "missing_messages", hint: "messages 过滤后为空。" };
  }

  const temperature = Number.isFinite(opts.temperature) ? Number(opts.temperature) : DEFAULT_TEMPERATURE;
  const maxTokens = Number.isFinite(opts.maxTokens) ? Number(opts.maxTokens) : DEFAULT_MAX_TOKENS;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const meta = { operation, messages, temperature, maxTokens };

  log?.info?.("llm.chatCompletion", {
    operation,
    messagesLen: messages.length,
    firstMsgRole: messages[0]?.role,
    temperature,
    maxTokens,
    timeoutMs,
  });

  // 尝试复用 plugin-private session
  let sessionPath = opts.sessionPath || ctx.sessionPath || null;
  if (!sessionPath) {
    try { sessionPath = await ensureSession(ctx); } catch { sessionPath = null; }
  }

  // 链路 1: model:sample-text（官方路径）
  let result = null;
  let usedVia = "model:sample-text";
  try {
    result = await ctx.bus.request("model:sample-text", {
      ...meta,
      ...(sessionPath ? { sessionPath } : {}),
    }, { timeout: timeoutMs });
  } catch (err) {
    log?.warn?.("llm.chatCompletion model:sample-text threw", { error: err?.message });
    result = null;
  }

  // 链路 2: session:send
  if (!result || !extractText(result)) {
    usedVia = "session:send";
    if (sessionPath) {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const systemMsgs = messages.filter((m) => m.role === "system");
        const nonSystemNonLastUser = messages.filter((m) => m !== lastUser && m.role !== "system");
        const r2 = await ctx.bus.request("session:send", {
          sessionPath,
          text: lastUser?.content || "",
          context: {
            ...(systemMsgs.length ? { system: systemMsgs.map((m) => m.content).join("\n\n") } : {}),
            ...(nonSystemNonLastUser.length ? { beforeUser: nonSystemNonLastUser.map((m) => ({ label: m.role, text: m.content })) } : {}),
          },
          temperature,
          maxTokens,
        }, { timeout: timeoutMs });
        if (r2 && extractText(r2)) result = r2;
      } catch (err) {
        log?.warn?.("llm.chatCompletion session:send threw", { error: err?.message });
      }
    }
  }

  // 链路 3: utility:call-text（老路径）
  if (!result || !extractText(result)) {
    usedVia = "utility:call-text";
    try {
      const r3 = await ctx.bus.request("utility:call-text", meta, { timeout: timeoutMs });
      if (r3 && extractText(r3)) result = r3;
    } catch (err) {
      log?.warn?.("llm.chatCompletion utility:call-text threw", { error: err?.message });
      return { ok: false, code: "bus_threw", message: err?.message, hint: "LLM 调用异常" };
    }
  }

  if (result?.error) {
    const msg = result.error.message || String(result.error);
    return {
      ok: false,
      code: "llm_error",
      message: msg,
      hint: "LLM 返回错误：" + msg,
    };
  }

  const text = extractText(result);
  if (!text) {
    return {
      ok: false,
      code: "llm_empty",
      hint: "LLM 返回为空。可能 token 用尽 / 网络断开 / 模型未配置。",
    };
  }

  log?.info?.("llm.chatCompletion ok", { via: usedVia, textLen: text.length });
  return { ok: true, text, via: usedVia };
}

/**
 * 兼容旧调用方式：chatCompletion(ctx, { messages, ... }) 简化版。
 * 直接传 prompt 字符串，自动包成 user 消息。
 */
export async function callLLM(ctx, prompt, systemPrompt = "") {
  return chatCompletion(ctx, {
    operation: ctx?.pluginId ? `${ctx.pluginId}-llm-call` : "legado-companion-llm-call",
    systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });
}