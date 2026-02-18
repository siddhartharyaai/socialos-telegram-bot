# Social OS Telegram Bot

Connects your Social OS account to Telegram.

## Deploy to Railway

1. Push this folder to a GitHub repo
2. Go to railway.app → New Project → Deploy from GitHub
3. Select the repo
4. Add environment variables:
   - TELEGRAM_BOT_TOKEN = your token from @BotFather
   - SOCIAL_OS_SKILL_KEY = your sos_ key from Social OS settings
5. Deploy

## Bot Commands

- /start — Welcome message
- /generate — Generate a LinkedIn post from next message
- /refine — Refine the last post
- /capture — Save a thought to Vault
- /vault — See recent Vault captures
- /status — Check plan and usage
- /help — Show all commands

Any message without a command automatically generates a post.
