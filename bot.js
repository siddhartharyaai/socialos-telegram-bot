const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SKILL_KEY = process.env.SOCIAL_OS_SKILL_KEY;
const API_URL = "https://jxjligipqkroonakwbld.supabase.co/functions/v1/skill-api";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const userState = {};

function getState(chatId) {
  return userState[chatId] || { mode: "idle", lastPost: null, niches: [], selectedNiche: null };
}

function setState(chatId, state) {
  userState[chatId] = { ...getState(chatId), ...state };
}

async function callAPI(action, params = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Skill-Key": SKILL_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

// ── FETCH AND CACHE NICHES ───────────────────────────────────────────
async function getNiches(chatId) {
  const state = getState(chatId);
  if (state.niches && state.niches.length > 0) return state.niches;
  const data = await callAPI("get_niches");
  const niches = data.niches || [];
  setState(chatId, { niches });
  return niches;
}

// ── SHOW NICHE PICKER ────────────────────────────────────────────────
async function showNichePicker(chatId, pendingText, pendingMode) {
  const niches = await getNiches(chatId);

  if (!niches.length) {
    // No niches set up — just generate without one
    setState(chatId, { mode: "idle" });
    await generatePost(chatId, pendingText, null);
    return;
  }

  if (niches.length === 1) {
    // Only one niche — use it automatically
    setState(chatId, { mode: "idle", selectedNiche: niches[0] });
    await generatePost(chatId, pendingText, niches[0].id);
    return;
  }

  // Multiple niches — show inline keyboard
  setState(chatId, { mode: "awaiting_niche", pendingText, pendingMode });

  const buttons = niches.map(n => ([{
    text: n.name,
    callback_data: `niche:${n.id}:${n.slug}`
  }]));

  // Add "No niche" option
  buttons.push([{ text: "No specific niche", callback_data: "niche:none:none" }]);

  bot.sendMessage(chatId, "Which niche is this post for?", {
    reply_markup: { inline_keyboard: buttons }
  });
}

// ── GENERATE POST ────────────────────────────────────────────────────
async function generatePost(chatId, rawText, nicheId) {
  bot.sendMessage(chatId, "Generating your post...");
  try {
    const params = { raw_text: rawText, length: "optimal" };
    if (nicheId && nicheId !== "none") params.niche_id = nicheId;

    const data = await callAPI("generate", params);
    if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);

    const post = data.post;
    setState(chatId, { lastPost: post, mode: "idle" });
    bot.sendMessage(chatId, post);

    setTimeout(() => {
      bot.sendMessage(chatId,
        `Voice DNA applied: ${data.voice_dna_applied ? "Yes ✅" : "Not set up yet"}\n\n/refine — edit this post\n/generate — write another\n/niche — change default niche`,
        { parse_mode: "Markdown" }
      );
    }, 600);
  } catch (e) {
    bot.sendMessage(chatId, "Generation failed. Try again in a moment.");
  }
}

// ── NICHE CALLBACK ───────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith("niche:")) {
    const parts = data.split(":");
    const nicheId = parts[1];
    const nicheSlug = parts[2];

    bot.answerCallbackQuery(query.id);
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: chatId,
      message_id: query.message.message_id
    });

    const state = getState(chatId);
    const selectedNiche = nicheId !== "none"
      ? (state.niches || []).find(n => n.id === nicheId) || { id: nicheId, slug: nicheSlug }
      : null;

    if (selectedNiche) {
      bot.sendMessage(chatId, `Niche: ${selectedNiche.name || nicheSlug} ✓`);
    }

    setState(chatId, { mode: "idle", selectedNiche });
    await generatePost(chatId, state.pendingText, nicheId !== "none" ? nicheId : null);
  }

  if (data.startsWith("set_default_niche:")) {
    const nicheId = data.split(":")[1];
    bot.answerCallbackQuery(query.id);
    const state = getState(chatId);
    const niche = (state.niches || []).find(n => n.id === nicheId);
    setState(chatId, { defaultNicheId: nicheId, defaultNicheName: niche?.name });
    bot.editMessageText(
      `Default niche set to: ${niche?.name || nicheId}\n\nAll future posts will use this niche unless you change it with /niche.`,
      { chat_id: chatId, message_id: query.message.message_id }
    );
  }
});

// ── NICHE COMMAND ────────────────────────────────────────────────────
bot.onText(/\/niche/, async (msg) => {
  const chatId = msg.chat.id;
  const niches = await getNiches(chatId);

  if (!niches.length) {
    return bot.sendMessage(chatId, "You have no niches set up. Go to socialos.in/settings to create content niches.");
  }

  const state = getState(chatId);
  const currentDefault = state.defaultNicheName || "None set";

  const buttons = niches.map(n => ([{
    text: (state.defaultNicheId === n.id ? "✓ " : "") + n.name,
    callback_data: `set_default_niche:${n.id}`
  }]));
  buttons.push([{ text: "No default (always ask me)", callback_data: "set_default_niche:none" }]);

  bot.sendMessage(chatId,
    `*Current default niche:* ${currentDefault}\n\nPick a new default, or choose "always ask me" to pick per post:`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
  );
});

// ── START ────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `Welcome to Social OS. 👋\n\nSend me any raw thought and I'll turn it into a LinkedIn post using your Voice DNA.\n\nFirst time? Run /niche to set your default content niche.\n\nType /help to see all commands.`,
    { parse_mode: "Markdown" }
  );
});

// ── HELP ─────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `
*Social OS Bot* — Your LinkedIn content pipeline.

*Commands:*
/generate — Generate a post (asks niche if multiple set up)
/refine — Refine the last post
/capture — Save a thought to your Vault
/vault — See your recent captures
/niche — Set your default niche
/status — Check your plan and usage
/help — Show this message

*Quick way:* Just send any raw thought — I'll generate a post and ask which niche if needed.

_Powered by Social OS — socialos.in_
  `, { parse_mode: "Markdown" });
});

// ── STATUS ───────────────────────────────────────────────────────────
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Checking your account...");
  try {
    const data = await callAPI("get_status");
    if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
    const used = data.usage?.generations?.used ?? 0;
    const limit = data.usage?.generations?.unlimited ? "Unlimited" : data.usage?.generations?.limit;
    const remaining = data.usage?.generations?.unlimited ? "Unlimited" : data.usage?.generations?.remaining;
    const state = getState(chatId);
    bot.sendMessage(chatId,
      `*Your Social OS Status*\n\nPlan: ${data.tier}\nPosts used: ${used}\nLimit: ${limit}\nRemaining: ${remaining}\nDefault niche: ${state.defaultNicheName || "Not set — use /niche"}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    bot.sendMessage(chatId, "Could not reach Social OS. Try again.");
  }
});

// ── VAULT ────────────────────────────────────────────────────────────
bot.onText(/\/vault/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Fetching your Vault...");
  try {
    const data = await callAPI("get_vault", { limit: 5 });
    if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
    if (!data.captures?.length) return bot.sendMessage(chatId, "Your Vault is empty. Send me thoughts to capture them.");
    const list = data.captures.map((c, i) =>
      `${i + 1}. ${c.raw_text.substring(0, 80)}${c.raw_text.length > 80 ? "..." : ""} ${c.shaped ? "✅" : "⭕"}`
    ).join("\n\n");
    bot.sendMessage(chatId, `*Recent Vault captures:*\n\n${list}\n\n✅ = shaped  ⭕ = unshaped`, { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(chatId, "Could not reach Social OS. Try again.");
  }
});

// ── CAPTURE ──────────────────────────────────────────────────────────
bot.onText(/\/capture/, (msg) => {
  const chatId = msg.chat.id;
  setState(chatId, { mode: "capture" });
  bot.sendMessage(chatId, "Send me the thought to save to your Vault.");
});

// ── GENERATE COMMAND ─────────────────────────────────────────────────
bot.onText(/\/generate/, (msg) => {
  const chatId = msg.chat.id;
  setState(chatId, { mode: "generate" });
  bot.sendMessage(chatId, "Send me your raw thought.");
});

// ── REFINE ───────────────────────────────────────────────────────────
bot.onText(/\/refine/, (msg) => {
  const chatId = msg.chat.id;
  const state = getState(chatId);
  if (!state.lastPost) return bot.sendMessage(chatId, "No post to refine yet. Generate one first.");
  setState(chatId, { mode: "refine" });
  bot.sendMessage(chatId,
    `What do you want to change?\n\nExamples:\n• punchier hook\n• make it shorter\n• more casual\n• stronger ending\n• add a CTA`,
    { parse_mode: "Markdown" }
  );
});

// ── MAIN MESSAGE HANDLER ─────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const state = getState(chatId);

  // CAPTURE MODE
  if (state.mode === "capture") {
    setState(chatId, { mode: "idle" });
    bot.sendMessage(chatId, "Saving to your Vault...");
    try {
      const data = await callAPI("capture", { raw_text: text });
      if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
      bot.sendMessage(chatId, `Saved to Vault ✅\n\nSend /generate when you want to shape it into a post.`);
    } catch (e) {
      bot.sendMessage(chatId, "Could not save. Try again.");
    }
    return;
  }

  // REFINE MODE
  if (state.mode === "refine") {
    setState(chatId, { mode: "idle" });
    bot.sendMessage(chatId, "Refining...");
    try {
      const data = await callAPI("refine", { post: state.lastPost, command: text });
      if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
      const refined = data.post || data.content;
      setState(chatId, { lastPost: refined });
      bot.sendMessage(chatId, refined);
      setTimeout(() => {
        bot.sendMessage(chatId, `/refine — refine again\n/generate — write another`, { parse_mode: "Markdown" });
      }, 500);
    } catch (e) {
      bot.sendMessage(chatId, "Refine failed. Try again.");
    }
    return;
  }

  // GENERATE — use default niche if set, otherwise ask
  if (state.defaultNicheId) {
    await generatePost(chatId, text, state.defaultNicheId === "none" ? null : state.defaultNicheId);
  } else {
    await showNichePicker(chatId, text, "generate");
  }
});

console.log("Social OS Telegram bot running...");
