# Still

Still is a private, calm school-task list. It is an installable Progressive Web App: one task in front of you, small steps, a due time on every task, and reminders that stay on the phone. New lists are stored on the device without a PIN. A list saved by an older version stays encrypted until its PIN is entered once.

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

## If a list looks missing

Still does not delete an older encrypted vault when a PIN is wrong, when decryption fails, or when a server cannot be reached. The current list is not PIN-encrypted. An older encrypted copy cannot be read without its PIN, and a wrong PIN does not erase it.

What can make the list look gone:

- The website, the Android app, and the Windows app do not share storage. The Android app’s database, if it was created, lives inside `app.still.tasks` at `https://localhost`. The website’s database lives on the site origin. Opening a different copy can show an empty list even when another copy still has tasks. That has not been checked on a phone.
- Debug APKs through 1.3 were signed by one Android debug key (SHA-256 `B6:B4:5D:71:FA:53:C4:18:65:80:EC:95:C7:25:A3:72:0A:E8:4E:0E:24:66:38:30:30:4D:49:1E:33:37:AB:A6`). That private key is not in this repository. Still 1.6 is a fresh install signed with a new key, so Android will not install it over 1.0–1.3. Uninstall the old app first. That removes the old app’s on-device list. The new app does not delete anything by itself.
- If the app was already removed, possible leftovers are an encrypted backup file, a readable export, or an Android backup of that same signed app. This project cannot see the phone.

If an older installed copy still opens, its PIN can export an encrypted backup. Restoring that file asks for the PIN once. A wrong PIN does not replace the list on the device.

## Account sync

The account is the Still Supabase project at `https://irooqmewtvsfoqscwncs.supabase.co`. Sign-up asks Supabase to email a confirmation link. The list is not uploaded until that address is confirmed. Email confirmation was left on.

The built-in Supabase mailer only delivers to members of the Supabase organization, about 2 messages an hour ([SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)). Other addresses need custom SMTP in Authentication → Emails. The allowed redirect is the website, `https://abdibochubbz.github.io/adhd-flow/**`. The Android app runs at `https://localhost` inside its WebView, and local preview uses `http://127.0.0.1:47321`. Both send the confirmation link to that website. Open the link in a browser, then sign in inside the app or the site. Do not add a localhost wildcard, and do not turn off email confirmation.

The database table `still_vaults` stores ciphertext only. Row level security allows each confirmed user to read and write their own row. Anonymous clients have no access, and there is no delete privilege. This has been checked with synthetic users that were rolled back. A full sign-up through a real inbox has not been run, so this is not yet a verified end-to-end sync.

Sign-out leaves the on-device list in place. A failed sign-in does not replace it. An empty account list does not wipe a device that already has tasks, and an empty device does not wipe an account that has tasks. Two devices on the same account merge by task. A different account is not given this device’s tasks unless you explicitly choose Merge or Use the account list.

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
4. Still 1.6 was a fresh install, not an update of 1.0–1.3. Still 1.7 (`app.still.tasks`, versionCode 17) installs over 1.6 because it uses that same signing key. It does not install over 1.0–1.3. A new install opens the task list with no PIN.
5. Allow notifications when asked. On Android 12 and newer, also allow **Alarms & reminders** (Settings → Apps → Still → Alarms & reminders) if a reminder does not fire while the app is closed. This build declares `USE_EXACT_ALARM`, so a sideloaded install is usually allowed to ring on time without that extra step. A future Play Store build may have to drop that permission and rely on the toggle instead.
6. To sync, open **Settings → Account**, create an account with an email you can read, confirm that email on the website, then sign in inside the app. Nothing is uploaded before the email is confirmed.

Long-press the Still icon for **Add task** and **Speak task**.

### Home-screen widget

Touch and hold the home screen → Widgets → **Still**. It shows the next task and an **Add task** button.

The task name is shown only when **Show task names** is on. Otherwise the widget says “A task is waiting” plus the due time. That line is stored outside the encrypted vault so Android can draw it while Still is locked. Turn the switch off if the home screen should not show the name.

Add task opens the composer. The rest of the widget opens Still.

### Study room

The Room tab opens on a hallway drawn as original art: polished boards, teal classroom doors, shoe lockers, and a floor marker. 1F is daylight. 3F is warm evening. The classroom is golden hour, with wood desks on teal frames and sunlight across the floor. Doors along the hall are classrooms. Pick one of six original looks. When you join, that chibi walks up the aisle and sits. At the desk they write, use a laptop, look at a phone, or read, depending on the look. After about a minute and a half with no taps they snooze, then wake and continue. A tap wakes them sooner. Your next private task sits under the desks. Tasks are not sent.

The task list and the add screen shift with the clock: morning, midday, evening, and night.

- **Public** rooms can be browsed.
- **Code** joins a room by its six-character code.
- **Create** makes a public room, or a private one that only the code and invite link can open.
- An invite link is `https://abdibochubbz.github.io/adhd-flow/?room=AB23CD` from the website and from the Android app. The Room tab also has a code field.

Hosted rooms are on by default. They use Supabase Realtime Presence on the existing Still project. No account is required, and no separate presence server is running. A public channel carries a display name, look, seat, and whether that person is focusing. Tasks are not included. A private room is omitted from the public list. Type `local` in the connection field to keep a room on this device only. `npm run presence` is still available if you want to run your own `wss://` server.

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

## Install on Windows

Still on a laptop is the same app: PIN, encrypted tasks, the hallway and classroom, and lighting that follows the clock. It is a portable program. There is no installer account and nothing is sent to a server.

1. Copy `Still.exe` onto the laptop.
2. Double-click it. Windows SmartScreen may say the publisher is unknown, because the file is not signed with a paid certificate. Choose **More info**, then **Run anyway**.
3. Still opens in its own window. The list is stored on that Windows user account, in the app’s local data, encrypted with the PIN you choose.

Reminders on the desktop fire while Still is open, including when the window is in the background. Closing the window quits the app, so a reminder cannot ring after you exit. Open Still when you want the morning list. The Android app is the one that can ring while it is fully closed.

On the phone, Still asks for notification permission the first time you save a task. Android 12 and newer also need **Alarms & reminders** (Settings → Apps → Still). If a reminder still does not appear after you leave the app, set the battery use to **Unrestricted** and allow autostart. Xiaomi, Oppo, Vivo, Huawei, and some Samsung phones block alarms until those two switches are on. Inexact alarms can also arrive a few minutes late while the phone is sleeping.

Build it yourself from PowerShell or WSL, after Node.js is installed:

```bash
npm install
npm run desktop:win
```

The portable program is written to `desktop-dist/`. On Windows the file name looks like `Still 1.0.0.exe`.

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
| The Windows app is open, even if the window is behind another program | The same on-screen timer can post a Windows notification. Quit Still and the timer stops until you open it again. |
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
