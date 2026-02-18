const TelegramBot = require("node-telegram-bot-api");
const fetch = require("node-fetch");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SKILL_KEY = process.env.SOCIAL_OS_SKILL_KEY;
const API_URL = "https://jxjligipqkroonakwbld.supabase.co/functions/v1/skill-api";

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Store user state (what mode they're in)
const userState = {};

function getState(chatId) {
  return userState[chatId] || { mode: "idle", lastPost: null };
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

// ── HELP MESSAGE ────────────────────────────────────────────────────
const HELP_TEXT = `
*Social OS Bot* — Your LinkedIn content pipeline.

*Commands:*
/generate — Turn your next message into a LinkedIn post
/refine — Refine the last generated post
/capture — Save a thought to your Vault
/vault — See your recent captures
/status — Check your plan and usage
/help — Show this message

*Quick way:* Just send me any raw thought and I'll generate a post from it directly.

_Powered by Social OS — socialos.in_
`;

// ── START ────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    `Welcome to Social OS. 👋\n\nSend me any raw thought — a market observation, a lesson from today, anything — and I'll turn it into a LinkedIn post using your Voice DNA.\n\nType /help to see all commands.`,
    { parse_mode: "Markdown" }
  );
});

// ── HELP ─────────────────────────────────────────────────────────────
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, HELP_TEXT, { parse_mode: "Markdown" });
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
    bot.sendMessage(chatId,
      `*Your Social OS Status*\n\nPlan: ${data.tier}\nPosts used: ${used}\nLimit: ${limit}\nRemaining: ${remaining}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    bot.sendMessage(chatId, "Could not reach Social OS. Try again in a moment.");
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
    bot.sendMessage(chatId, `*Recent Vault captures:*\n\n${list}\n\n✅ = shaped into post  ⭕ = unshaped`, { parse_mode: "Markdown" });
  } catch (e) {
    bot.sendMessage(chatId, "Could not reach Social OS. Try again in a moment.");
  }
});

// ── CAPTURE MODE ─────────────────────────────────────────────────────
bot.onText(/\/capture/, (msg) => {
  const chatId = msg.chat.id;
  setState(chatId, { mode: "capture" });
  bot.sendMessage(chatId, "What thought do you want to capture? Send it now and I'll save it to your Vault.");
});

// ── GENERATE MODE ────────────────────────────────────────────────────
bot.onText(/\/generate/, (msg) => {
  const chatId = msg.chat.id;
  setState(chatId, { mode: "generate" });
  bot.sendMessage(chatId, "Send me your raw thought and I'll turn it into a LinkedIn post.");
});

// ── REFINE ───────────────────────────────────────────────────────────
bot.onText(/\/refine/, (msg) => {
  const chatId = msg.chat.id;
  const state = getState(chatId);
  if (!state.lastPost) {
    return bot.sendMessage(chatId, "No post to refine yet. Generate one first.");
  }
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
      bot.sendMessage(chatId,
        `Saved to Vault. ✅\n\nSend /generate when you want to turn it into a post.`
      );
    } catch (e) {
      bot.sendMessage(chatId, "Could not save. Try again.");
    }
    return;
  }

  // REFINE MODE
  if (state.mode === "refine") {
    setState(chatId, { mode: "idle" });
    bot.sendMessage(chatId, "Refining your post...");
    try {
      const data = await callAPI("refine", { post: state.lastPost, command: text });
      if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
      const refined = data.post || data.content;
      setState(chatId, { lastPost: refined });
      bot.sendMessage(chatId, refined);
      setTimeout(() => {
        bot.sendMessage(chatId,
          `Done. Want more changes?\n\n/refine — refine again\n/capture — save original to Vault`,
          { parse_mode: "Markdown" }
        );
      }, 500);
    } catch (e) {
      bot.sendMessage(chatId, "Refine failed. Try again.");
    }
    return;
  }

  // GENERATE (default — any text triggers generation)
  setState(chatId, { mode: "idle" });
  bot.sendMessage(chatId, "Generating your post...");
  try {
    const data = await callAPI("generate", { raw_text: text, length: "optimal" });
    if (data.error) return bot.sendMessage(chatId, `Error: ${data.error}`);
    const post = data.post;
    setState(chatId, { lastPost: post });
    bot.sendMessage(chatId, post);
    setTimeout(() => {
      bot.sendMessage(chatId,
        `Voice DNA applied: ${data.voice_dna_applied ? "Yes ✅" : "Not set up yet"}\n\n/refine — edit this post\n/generate — write another`,
        { parse_mode: "Markdown" }
      );
    }, 600);
  } catch (e) {
    bot.sendMessage(chatId, "Generation failed. Try again in a moment.");
  }
});

console.log("Social OS Telegram bot is running...");
