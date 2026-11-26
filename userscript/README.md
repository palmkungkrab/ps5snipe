# Laptop browser watcher

A small Tampermonkey script. It watches **Powerbuy, Banana IT and JIB** from real Chrome tabs on the laptop.
Real Chrome gets past the checks that block the Python watcher. When a PS5 console comes into stock,
it pings your Discord with an `@mention`.

Your secrets are **not** in this repo (it is public). You paste them once into the script's box.
They are saved in the browser only.

## 1. Set up Healthchecks.io

Healthchecks tells you when a tab stops checking in.

1. Make a free account at [healthchecks.io](https://healthchecks.io).
2. Make three checks. Use exactly these names: `powerbuy`, `banana-it`, `jib`.
3. For each check, set **Period** to 5 minutes and **Grace** to 5 minutes.
4. Open **Settings → Ping key** and copy the project's **ping key**. Do not copy a full check URL.
   The script pings `https://hc-ping.com/<ping key>/<name>` by itself.
5. Add the **Discord** integration (Healthchecks asks Discord for permission).
   Every message in your channel buzzes your phone, so the built-in alert is enough.

## 2. Install the script on the laptop

1. In Chrome, install the **Tampermonkey** extension.
2. Open `chrome://extensions`, click Tampermonkey **Details**, and turn on **Allow User Scripts**.
   Chrome 138 and newer need this. ([Tampermonkey FAQ](https://www.tampermonkey.net/faq.php?q=Q209))
3. Open this link: <https://raw.githubusercontent.com/palmkungkrab/ps5snipe/main/userscript/ps5watch.user.js>
   Tampermonkey offers to install the script. Click **Install**.

## 3. Open the three watcher bookmarks

Make one Chrome bookmark for each link below. Keep the `#ps5watch` at the end.
That ending is what tells the script "this tab is a watcher".

| Store | Bookmark link |
|---|---|
| Powerbuy | `https://www.powerbuy.co.th/th/search/ps5#ps5watch` |
| Banana IT | `https://www.bnn.in.th/th/p?q=playstation%205#ps5watch` |
| JIB | `https://www.jib.co.th/web/product/product_search/0?str_search=playstation%205#ps5watch` |

Open each bookmark in its own tab. Leave the three tabs open.

## 4. Paste the settings (once)

A box shows in the corner of the tab. Fill in:

1. **Discord webhook link.** It is `DISCORD_WEBHOOK_URL` in the project's local `.env` file.
2. **Your Discord user ID.** It is `DISCORD_USER_ID` in the same `.env` file.
3. **Healthchecks ping key.** From step 1.

Click **Save**, then click **Test ping**. A message that says **💻 laptop** should arrive in Discord.
All three store tabs share these settings, so you paste them only once.

## 5. Set up Chrome

1. **Settings → Performance → Always keep these sites active.** Add `powerbuy.co.th`, `bnn.in.th`
   and `jib.co.th`. ([Chrome help](https://support.google.com/chrome/answer/12929150))
2. **Settings → On startup → Continue where you left off.**
3. Make sure Chrome starts when you sign in to Windows.
   Then after a reboot and a sign-in, the watcher tabs come back by themselves.
4. Keep the laptop plugged in. Closing the lid is fine (the Windows power settings are already set).

## What to expect

- Chrome slows hidden tabs to about one wake-up a minute.
  So each tab checks every 1 to 2 minutes. This is normal.
  ([Chrome blog](https://developer.chrome.com/blog/timer-throttling-in-chrome-88))
- **Only a tab opened from its bookmark (ending `#ps5watch`) watches.**
  Other tabs of the same store never check or reload. They only show a small pill.
- If you click around inside a watcher tab, it stops watching and shows the pill.
  To start again, open the bookmark again.
- **Do not use Chrome's "Duplicate tab" on a watcher tab.** The copy keeps the same tab identity,
  so you get two watchers. Open the bookmark instead.

## Pings

Every ping says where it came from: **💻 laptop** or **☁️ GitHub**.
JIB is watched by both on purpose, so a JIB restock pings you twice.

## What the messages mean

**"Needs you"**
The tab reloaded once and is still stuck, so that store is not being watched. The message says why.
- **"asking whether you're human"**:
  1. Open that tab.
  2. Pass the check.
  3. Watching restarts by itself. A "watching again" message follows.
- **"NOT being watched: …"** (for example `HTTP 404`, `not the normal search page` or
  `Powerbuy product fields changed`): open that tab. If it looks normal, reload it once.
  If the message keeps coming back, the store changed its page and the script needs an update.

**A red Healthchecks check**
That tab stopped checking in. Common causes:
- Chrome is closed.
- The laptop is asleep.
- The Wi-Fi is down.
- The tab is frozen.
- The tab went to another page.

Fix it: check the laptop and Wi-Fi, then open the store's bookmark again.

## Updating

Tampermonkey gets new versions from the `main` branch by itself. It only updates when the
`@version` number at the top of `ps5watch.user.js` goes up.
