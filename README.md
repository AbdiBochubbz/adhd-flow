# Still

Still is a private, calm school-task list. It is an installable Progressive Web App: one task in front of you, small steps, a due time on every task, and reminders that stay on the phone. There is no account and no server. The list is encrypted in IndexedDB and never leaves the device.

## Run it locally

```bash
npm install
npm test
npm run dev
```

Open http://127.0.0.1:47321. The dev server is for working on the app. Install, offline use, and the strict Content-Security-Policy are in the production build:

```bash
npm run build
npm run preview
```

That preview is the same set of files GitHub Pages serves.

## Deploy to GitHub Pages

The site is a static `dist/` folder. Relative URLs (`./`) work both at `https://<user>.github.io/<repo>/` and at a user-site root.

1. Push this repository to GitHub.
2. In the repo, open **Settings → Pages → Build and deployment**.
3. Set **Source** to **GitHub Actions**.
4. The workflow in `.github/workflows/pages.yml` runs the tests, builds `dist/`, and deploys it on every push to `main`.

The first run needs the Pages environment to exist. If the Action asks for permission, approve the `github-pages` environment. When it finishes, the site URL is on the workflow run and under Settings → Pages.

GitHub Pages serves the site over HTTPS, which phones require for install, notifications, and the microphone.

## Install on Android

1. Open the Pages URL in **Chrome**.
2. Tap the menu (⋮) → **Add to Home screen** or **Install app**. If the browser offers an install prompt, Still also shows **Add to Home screen** in Settings.
3. Open Still from the new icon. It runs full screen and works offline after that first online visit.
4. Allow notifications when Still asks, or later in Settings.

iPhone: Safari → Share → **Add to Home Screen**. iOS is stricter about background notifications than Chrome on Android; the morning list still appears when you open the app.

### Home-screen shortcuts

Long-press the Still icon. Chrome shows two shortcuts from the manifest:

- **Add task** opens the composer.
- **Speak task** opens the composer and starts the microphone when the browser still treats that as a tap. If it doesn’t, one more tap on the mic starts listening.

You can also share a line of text to Still from another app. The shared sentence is filled in as a new task and parsed on the phone.

### A real Android widget

A website cannot draw a true Android home-screen widget. The shortcuts above are the web stand-in.

If you later want a real widget:

- **Trusted Web Activity.** Wrap the Pages URL with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap). Add a small native widget whose only job is to open `https://<your-pages-url>/?action=add` or `?action=speak`.
- **Capacitor.** Point a Capacitor Android project at the `dist/` folder and add an App Widget that launches the same URLs.

Either path is a native shell around this same static app. Still itself stays a website with no backend.

## Reminders, and what a static app cannot do

Still schedules three kinds of reminder for a task, and you can turn each one off:

- **Day before.** Twenty-four hours before the due time. If that would fall between 9:30 pm and 7:00 am, it moves to 7:00 pm so it doesn’t arrive in the middle of the night.
- **1 hour before.** Exact.
- **At due time.** Exact.

If you don’t name a time, the task is due at the **end of that day** (11:59 pm). Those late pings stay off unless you turn them on. The add screen shows the actual clock time it will use.

What actually fires:

| Situation | What happens |
| --- | --- |
| Still is open, or sitting in a recent Chrome tab | A timer in the page checks the list and posts a notification. This is the reliable path. |
| The browser supports [Notification Triggers](https://developer.mozilla.org/en-US/docs/Web/API/Notification_Triggers) (`TimestampTrigger`) | Still asks the phone to show the notification at that exact time, even if the app is closed. Support is uncommon; Settings tells you if this browser has it. |
| Periodic Background Sync is allowed | Chrome may wake the service worker on a coarse interval (often 12 hours or longer, and only for an installed app you use). It is not an alarm clock. |
| The app is fully closed and the browser can’t schedule a time | The reminder waits. The next time you open Still, it shows anything you missed in the last 12 hours, and the morning list if it’s still morning. |

There is no push server, on purpose. A static site cannot receive Web Push. Android will not reliably wake a closed browser tab. **Open Still in the morning.** That daily list is the dependable one: overdue items and anything due today, once a day between the hour you pick (default 7:00) and noon.

Notifications are generic by default (“A task is due in about an hour.”). Task names stay inside the encrypted vault. **Show task names** in Settings puts the title on the lock screen and stores it in a separate reminder list the service worker can read. Leave it off if the lock screen isn’t a place you want the title.

Enable notifications: when you add your first task, or in Settings → Reminders → Allow notifications. If Chrome blocked them: lock icon in the address bar → Site settings → Notifications → Allow. For an installed app: long-press the icon → App info → Notifications.

## Privacy

- Tasks, steps, notes, and settings are encrypted with **AES-GCM**. The key is derived from your PIN or passphrase with **PBKDF2-SHA-256** (210,000 iterations) and is not extractable. A wrong PIN fails the encryption check. The PIN is not stored.
- Salt and ciphertext live in IndexedDB on this device. The service worker’s reminder list stores times, and titles only if you opted in.
- Auto-lock defaults to 5 minutes of inactivity, and also if you leave the app that long. Reloading the page drops the key, so you enter the PIN again. Choose 1 minute, 15 minutes, or off in Settings.
- After several wrong PINs the pad waits, so guessing by hand is slow. A copied browser profile can still be attacked offline; a long passphrase is stronger than `1234`.
- No analytics, no accounts, no third-party scripts. The production build sets a strict Content-Security-Policy (and the service worker repeats it as a header, including `frame-ancestors`, which a meta tag cannot enforce).
- **Voice is the exception.** Speech recognition is the browser’s own service. In Chrome that usually sends the audio of that phrase to Google and returns text. Still stores only the text, on the phone. The disclosure sits on the add screen. Type the task if you don’t want that.
- Encrypted backup: Settings → Download encrypted backup. The file is useless without the PIN that was set when you exported it. Restore replaces the list on this phone.
- Readable copy: explicitly labeled as not encrypted.
- Forgetting the PIN means the tasks cannot be read. Erase the vault and start over. Erase deletes the local database; it is not a remote wipe.

## Using it

The home screen shows **one** next task. Overdue comes first. **Not now** hides it from that spot for an hour without changing the due date. **Break it down** adds small steps; the focus card leads with the unfinished step, not the whole assignment.

Add with the big button, or say it: “math homework due Friday at 5pm”, “essay tomorrow”, “quiz in 2 hours”, “lab report by Wednesday”. If the sentence has no date, it’s due today at the end of the day. The parsed time is shown before you save, and you can change it. “at 5” with no am/pm is read as 5:00 pm for hours 1–7, and as morning for 8–11, because that’s the usual school reading. The preview is there so a wrong guess is obvious.

The timer is a simple focus block (15, 25, or 50 minutes) and a short break. It is accurate while Still is on screen. If Android freezes the tab, the timer catches up when you come back, and it can notify you if notifications are allowed.

## Develop

```bash
npm test          # date parser, reminder times, encryption
npm run dev       # http://127.0.0.1:47321
npm run icons     # redraw the PNG icons
npm run build     # dist/ for GitHub Pages
```

The service worker is registered only in the production build, because the dev server’s live reload does not belong in the app cache. `public/sw.js` has `__CACHE__` and `__PRECACHE__` placeholders that the build fills in.
