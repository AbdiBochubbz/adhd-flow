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

## Install the Android app

The Android project in `android/` is a Capacitor shell around the same encrypted app. It installs like a normal app, schedules reminders while Still is closed, and has a home-screen widget.

### Sideload the debug APK

The debug APK is signed with the Android debug key. It is for your own phone, not the Play Store.

1. Build it (Android SDK and JDK 21):

```bash
npm install
npm run android:debug
```

The file is `android/app/build/outputs/apk/debug/app-debug.apk`.

2. Copy that APK to the phone.
3. Open it. If Android blocks the install, allow installs from that app (Files, Chrome, or Drive) under **Settings → Apps → Special app access → Install unknown apps**.
4. Open Still, choose a PIN, and allow notifications when asked. On Android 12 and newer, also allow **Alarms & reminders** (Settings → Apps → Still → Alarms & reminders) if a reminder does not fire while the app is closed. This build declares `USE_EXACT_ALARM`, so a sideloaded install is usually allowed to ring on time without that extra step. A future Play Store build may have to drop that permission and rely on the toggle instead.

Long-press the Still icon for **Add task** and **Speak task**.

### Home-screen widget

Touch and hold the home screen → Widgets → **Still**. It shows the next task and an **Add task** button.

The task name is shown only when **Show task names** is on. Otherwise the widget says “A task is waiting” plus the due time. That line is stored outside the encrypted vault so Android can draw it while Still is locked. Turn the switch off if the home screen should not show the name.

Add task opens the composer. The rest of the widget opens Still.

### Study room

The Room tab is a classroom: wooden desks, a board, and windows. You show a name, one of six original looks, and a seat. Tasks are not sent.

- **Public** rooms can be browsed.
- **Code** joins a room by its six-character code.
- **Create** makes a public room, or a private one that only the code and invite link can open.
- An invite link looks like `https://<your-site>/?room=AB23CD`. Inside the Android app it is `still://room?code=AB23CD`.

With the shared-server field left blank, those three ways to join work on this device only. To share a room with another phone:

```bash
npm run presence
```

That listens on `ws://127.0.0.1:47322`. Put a `wss://` address in the room screen when the server is reachable from the phone. The server stores names, looks, and seats, and nothing else.

### Signed release build

Create a keystore on your machine. Do not commit it or the passwords.

```bash
keytool -genkeypair -v -keystore android/still-release.keystore -alias still -keyalg RSA -keysize 2048 -validity 10000
```

Copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the two passwords. `storeFile` is relative to the `android/` folder. Then:

```bash
cd android
./gradlew assembleRelease
./gradlew bundleRelease
```

`assembleRelease` writes `android/app/build/outputs/apk/release/app-release.apk`. `bundleRelease` writes an `.aab` under `android/app/build/outputs/bundle/release/` for Play App Signing. If `keystore.properties` is missing, the release build is unsigned.

### The website, if you do not want the APK

1. Open the Pages URL in **Chrome**.
2. Tap the menu (⋮) → **Add to Home screen** or **Install app**.
3. Allow notifications when Still asks.

That installed site cannot draw a real home-screen widget, and Android will not reliably wake it after you swipe it away. Long-press the icon for the shortcut stand-ins **Add task** and **Speak task**.

## Reminders

Still schedules three kinds of reminder for a task, and you can turn each one off:

- **Day before.** Twenty-four hours before the due time. If that would fall between 9:30 pm and 7:00 am, it moves to 7:00 pm so it doesn’t arrive in the middle of the night.
- **1 hour before.** Exact.
- **At due time.** Exact.

If you don’t name a time, the task is due at the **end of that day** (11:59 pm). Those late pings stay off unless you turn them on. The add screen shows the actual clock time it will use.

What actually fires:

| Situation | What happens |
| --- | --- |
| The Android app is installed, notifications are allowed, and exact alarms are allowed | Still schedules the reminder on the phone. It can ring when the app is closed or the screen is off. Opening Still later still shows anything from the last 12 hours. |
| Still is open in the browser, or sitting in a recent Chrome tab | A timer in the page checks the list and posts a notification. This is the reliable path for the website. |
| The browser supports Notification Triggers (`TimestampTrigger`) | Still asks the phone to show the notification at that exact time, even if the site is closed. Support is uncommon. |
| Periodic Background Sync is allowed | Chrome may wake the service worker on a coarse interval. It is not an alarm clock. |
| The website is fully closed and the browser can’t schedule a time | The reminder waits until you open Still. |

There is no push server. The website cannot receive Web Push, and Android will not reliably wake a closed browser tab. The Android app does not need a server: the alarm is local. The morning list still appears when you open Still, once a day between the hour you pick (default 7:00) and noon.

Notifications are generic by default (“A task is due in about an hour.”). Task names stay inside the encrypted vault. **Show task names** in Settings puts the title on the lock screen and stores it in a separate reminder list the service worker can read. Leave it off if the lock screen isn’t a place you want the title.

Enable notifications: when you add your first task, or in Settings → Reminders → Allow notifications. If Chrome blocked them: lock icon in the address bar → Site settings → Notifications → Allow. For an installed app: long-press the icon → App info → Notifications.

## Privacy

- Tasks, steps, notes, and settings are encrypted with **AES-GCM**. The key is derived from your PIN or passphrase with **PBKDF2-SHA-256** (210,000 iterations) and is not extractable. A wrong PIN fails the encryption check. The PIN is not stored.
- Salt and ciphertext live in IndexedDB on this device. The service worker’s reminder list stores times, and titles only if you opted in.
- Auto-lock defaults to 5 minutes of inactivity, and also if you leave the app that long. Reloading the page drops the key, so you enter the PIN again. Choose 1 minute, 15 minutes, or off in Settings.
- After several wrong PINs the pad waits, so guessing by hand is slow. A copied browser profile can still be attacked offline; a long passphrase is stronger than `1234`.
- No analytics, no accounts, no third-party scripts. The production build sets a strict Content-Security-Policy (and the service worker repeats it as a header, including `frame-ancestors`, which a meta tag cannot enforce).
- **Voice is the exception.** In the browser, speech recognition is Chrome’s service and may send that phrase to Google. In the Android app, the phone’s speech recognizer is used, and that may also send the phrase to its speech service. Still stores only the text. The disclosure sits on the add screen. Type the task if you don’t want that.
- The Android home-screen widget stores one line outside the vault so it can draw while Still is locked. The task name is included only if **Show task names** is on.
- Encrypted backup: Settings → Download encrypted backup. The file is useless without the PIN that was set when you exported it. Restore replaces the list on this phone.
- Readable copy: explicitly labeled as not encrypted.
- Forgetting the PIN means the tasks cannot be read. Erase the vault and start over. Erase deletes the local database; it is not a remote wipe.

## Using it

The home screen shows **one** next task. Overdue comes first. **Not now** hides it from that spot for an hour without changing the due date. **Break it down** adds small steps; the focus card leads with the unfinished step, not the whole assignment.

Add with the big button, or say it: “math homework due Friday at 5pm”, “essay tomorrow”, “quiz in 2 hours”, “lab report by Wednesday”. If the sentence has no date, it’s due today at the end of the day. The parsed time is shown before you save, and you can change it. “at 5” with no am/pm is read as 5:00 pm for hours 1–7, and as morning for 8–11, because that’s the usual school reading. The preview is there so a wrong guess is obvious.

The timer is a simple focus block (15, 25, or 50 minutes) and a short break. It is accurate while Still is on screen. If Android freezes the tab, the timer catches up when you come back, and it can notify you if notifications are allowed.

## Develop

```bash
npm test             # date parser, reminder times, encryption, widget copy
npm run dev          # http://127.0.0.1:47321
npm run icons        # redraw the PNG icons
npm run build        # dist/ for GitHub Pages and the Android shell
npm run android:debug
```

The service worker is registered only in the production website, not inside the Android app. `public/sw.js` has `__CACHE__` and `__PRECACHE__` placeholders that the build fills in. `android/local.properties` points at your Android SDK and is not committed.
