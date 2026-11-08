import { connectAccount, createSyncClient, openSyncKey, pushPlan, syncExisting } from "./account.js";
import { mergePayloads } from "./merge.js";
import { checkVerifier, decryptJson, deriveKey } from "./crypto.js";
import { commitVault, kvGet, kvSet, readVaultRecord } from "./db.js";
import { freshComposer, draftFrom, previewCopy } from "./draft.js";
import { DONE_PHRASES, createTask, defaultSettings, openCount, sanitizePayload } from "./model.js";
import {
  askNotificationPermission,
  flushDue,
  getCapabilities,
  permissionState,
  probeCapabilities,
  registerBackgroundWork,
  showTimerDone,
  stopForeground,
  syncSchedule,
  updateBadge,
} from "./notify.js";
import { clearWidget, isNative, nativeActionFromUrl, startNativeListening, watchNativeLinks } from "./native.js";
import { studyPhase } from "./study.js";
import { connectPresence } from "./presence.js";
import { inviteLink } from "./room.js";
import { dayKey, endOfDay, formatClock, fromDatetimeLocal } from "./time.js";
import { parseTask } from "./parse.js";
import {
  backupFromRecord,
  changeSecret,
  clearSyncSession,
  createVault,
  eraseVault,
  hasPreviousVault,
  keepPreviousVault,
  noteFailedAttempt,
  openVault,
  parseBackup,
  readFails,
  restorePreviousVault,
  saveVault,
  vaultRecordState,
} from "./vault.js";
import { renderScreen } from "./views.js";
import { speechSupported, startListening, voiceErrorCopy } from "./voice.js";

const app = document.querySelector("#app");

const state = {
  screen: "loading",
  bootError: "",
  hasVault: false,
  fails: { count: 0, until: 0 },
  setupStep: "create",
  pinBuffer: "",
  pinFirst: "",
  passphraseMode: false,
  passphrase: "",
  weakPin: false,
  error: "",
  shake: false,
  cryptoBusy: false,
  view: "focus",
  sheet: null,
  sheetReset: false,
  eraseForgot: false,
  composer: freshComposer(),
  edit: null,
  tasks: [],
  settings: defaultSettings(),
  key: null,
  toast: "",
  live: "",
  celebrate: "",
  undo: null,
  listening: false,
  voiceError: "",
  showDone: false,
  pendingAction: null,
  pendingTask: null,
  pendingText: "",
  pendingRoom: "",
  room: {
    serverUrl: "",
    status: "idle",
    error: "",
    mode: "public",
    modeLabel: "local",
    displayName: "",
    chibi: "pebbles",
    codeInput: "",
    roomName: "",
    isPublic: true,
    rooms: [],
    roomsJson: "",
    roomJson: "",
    walked: {},
    focusLatch: false,
    floor: "1",
    seatedAt: {},
    current: null,
    you: null,
    invite: "",
  },
  focusComposer: false,
  installPrompt: null,
  updateReady: false,
  swError: false,
  online: navigator.onLine,
  standalone: false,
  native: isNative(),
  notificationPermission: "default",
  caps: null,
  background: null,
  changeA: "",
  changeB: "",
  importPin: "",
  importBackup: null,
  tombstones: [],
  accountEmail: "",
  syncKeyB64: "",
  syncKey: null,
  hasPrevious: false,
  vaultPartial: false,
  account: {
    url: "",
    emailDraft: "",
    passwordDraft: "",
    email: "",
    status: "unconfigured",
    detail: "Sync is not connected. Tasks stay on this device.",
    busy: false,
    revision: 0,
    dirty: false,
    hold: null,
  },
  phraseIndex: 0,
  lastActivity: Date.now(),
  hiddenAt: 0,
  timer: {
    mode: "focus",
    running: false,
    endsAt: 0,
    remainingMs: 25 * 60 * 1000,
    durationMs: 25 * 60 * 1000,
    taskId: null,
  },
};

let saveChain = Promise.resolve();
let toastTimer = 0;
let celebrateToken = 0;
let stopVoice = null;
let saveTimer = 0;

function render() {
  const active = document.activeElement;
  const focusId = active?.id;
  const start = active?.selectionStart;
  const end = active?.selectionEnd;
  const mainTop = document.querySelector(".main")?.scrollTop || 0;
  const sheetTop = state.sheetReset ? 0 : document.querySelector(".sheet")?.scrollTop || 0;
  state.sheetReset = false;
  try {
    app.replaceChildren(renderScreen(state));
  } catch (error) {
    console.error(error?.name || "render");
    app.textContent = "Still hit a problem drawing this screen. Reload and enter your PIN.";
    return;
  }
  if (state.focusComposer) {
    state.focusComposer = false;
    document.getElementById("composer-text")?.focus({ preventScroll: true });
  } else if (focusId) {
    const next = document.getElementById(focusId);
    if (next) {
      next.focus({ preventScroll: true });
      if (typeof start === "number" && next.setSelectionRange) {
        try {
          next.setSelectionRange(start, end);
        } catch {
          /* some password fields refuse a selection */
        }
      }
    }
  }
  const mainEl = document.querySelector(".main");
  if (mainEl) mainEl.scrollTop = mainTop;
  const sheetEl = document.querySelector(".sheet");
  if (sheetEl) sheetEl.scrollTop = sheetTop;
  for (const node of document.querySelectorAll(".walker.is-walking")) startDeskWalk(node);
}

function startDeskWalk(node) {
  const floor = node.closest(".floor");
  if (!floor || node.dataset.walking === "1") return;
  node.dataset.walking = "1";
  const col = Number(node.dataset.col) || 0;
  const row = Number(node.dataset.row) || 0;
  const width = floor.clientWidth || 300;
  const height = Math.max(floor.clientHeight || 0, 360);
  const deskLeft = `${(col * 100) / 3}%`;
  const deskTop = `${row * 104 + 26}px`;
  const doorLeft = "34%";
  const doorTop = `${height - 72}px`;
  const aisleTop = `${row * 104 + 26}px`;
  const sit = () => {
    node.style.left = deskLeft;
    node.style.top = deskTop;
    node.classList.remove("is-walking");
    node.classList.add("is-seated");
  };
  try {
    const anim = node.animate(
      [
        { left: doorLeft, top: doorTop },
        { left: doorLeft, top: aisleTop, offset: 0.48 },
        { left: deskLeft, top: aisleTop, offset: 0.76 },
        { left: deskLeft, top: deskTop },
      ],
      { duration: 1800, easing: "ease-in-out", fill: "none" },
    );
    anim.onfinish = sit;
  } catch {
    sit();
  }
  setTimeout(sit, 2000);
}

function snapshot() {
  return {
    tasks: state.tasks.map((task) => ({
      ...task,
      reminders: { ...task.reminders },
      steps: (task.steps || []).map((step) => ({ ...step })),
    })),
    settings: { ...state.settings },
    tombstones: state.tombstones.map((item) => ({ ...item })),
    accountEmail: state.accountEmail || "",
    syncKeyB64: state.syncKeyB64 || "",
  };
}

let sealing = false;

function persist({ quiet = false } = {}) {
  if (sealing || !state.key) return saveChain;
  if (!quiet) state.account.dirty = true;
  const data = snapshot();
  const run = async () => {
    if (!state.key) return;
    await saveVault(state.key, data);
    await syncSchedule(data.tasks, data.settings, notificationHooks);
    await updateBadge(state.screen === "app" ? openCount(data.tasks) : 0);
    try {
      localStorage.setItem("still-theme", data.settings.theme);
    } catch {
      /* private mode can refuse storage that isn't IndexedDB */
    }
    if (!quiet) scheduleSync();
  };
  saveChain = saveChain.then(run, run);
  return saveChain;
}

function notificationHooks() {
  const now = new Date();
  const hour = now.getHours();
  const inMorning = hour >= (state.settings?.morningHour ?? 7) && hour < 12;
  const unseen = state.settings?.lastSummaryDay !== dayKey(now);
  return {
    visible: state.screen === "app" && document.visibilityState === "visible",
    suppressMorning: state.sheet === "summary" || (inMorning && unseen),
    onInApp(slot) {
      if (slot.kind === "morning") return;
      if (state.screen !== "app") showToast("A reminder is waiting once you unlock.");
      else showToast(slot.body);
    },
  };
}

function applyTheme(preference) {
  const choice = ["dark", "light", "system"].includes(preference) ? preference : "system";
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = choice === "system" ? (dark ? "dark" : "light") : choice;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === "dark" ? "#141210" : "#f6f1e8";
  try {
    localStorage.setItem("still-theme", choice);
  } catch {
    /* ignore */
  }
}

function showToast(message, undo = null) {
  state.toast = message;
  state.live = message;
  state.undo = undo;
  state.celebrate = "";
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast !== message) return;
    state.toast = "";
    state.undo = null;
    document.querySelector(".toast")?.remove();
  }, undo ? 4200 : 2800);
}

function celebrate(phrase, undo = null) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    showToast(phrase, undo);
    return;
  }
  state.celebrate = phrase;
  state.toast = "";
  state.undo = undo;
  state.live = phrase;
  render();
  const token = ++celebrateToken;
  setTimeout(() => {
    if (token !== celebrateToken || state.celebrate !== phrase) return;
    state.celebrate = "";
    state.undo = null;
    render();
  }, 2400);
}

function nextPhrase() {
  const phrase = DONE_PHRASES[state.phraseIndex % DONE_PHRASES.length];
  state.phraseIndex += 1;
  return phrase;
}

function refreshPermission() {
  state.notificationPermission = permissionState();
  state.caps = { ...getCapabilities(), ...(state.caps || {}) };
  state.standalone = state.native || window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function secretNow() {
  return state.passphraseMode ? state.passphrase : state.pinBuffer;
}

function weakSecret(secret) {
  return /^(\d)\1+$/.test(secret) || ["1234", "123456", "0000", "1111", "1212", "2580"].includes(secret);
}

function yieldPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 40));
  });
}

function haltVoice() {
  stopVoice?.();
  stopVoice = null;
  state.listening = false;
}

function beginVoice() {
  haltVoice();
  state.listening = true;
  state.voiceError = "";
  state.sheet = "add";
  const handlers = {
    onText(text) {
      state.composer.text = text;
      state.live = text;
      render();
    },
    onError(code) {
      if (code === "aborted") return;
      if (code === "unsupported" && state.native && speechSupported()) {
        stopVoice = startListening(handlers);
        return;
      }
      state.voiceError = voiceErrorCopy(code);
      state.listening = false;
      render();
    },
    onEnd() {
      state.listening = false;
      if (state.sheet === "add") render();
    },
  };
  if (state.native) stopVoice = startNativeListening(handlers);
  else if (!speechSupported()) {
    state.voiceError = voiceErrorCopy("unsupported");
    state.listening = false;
  } else stopVoice = startListening(handlers);
  render();
}

function openAdd({ voice = false, text = "" } = {}) {
  haltVoice();
  state.composer = freshComposer();
  if (text) state.composer.text = text;
  state.error = "";
  state.voiceError = "";
  state.sheet = "add";
  state.sheetReset = true;
  state.focusComposer = !voice;
  if (state.view === "settings" || state.view === "timer") state.view = "focus";
  if (voice) beginVoice();
  else render();
}

function commitEdit() {
  if (!state.edit) return;
  const index = state.tasks.findIndex((task) => task.id === state.edit.id);
  if (index < 0) return;
  const previous = state.tasks[index];
  const title = state.edit.title.trim() ? state.edit.title.trim() : previous.title;
  state.edit.title = title;
  state.edit.steps = state.edit.steps.filter((step) => step.title.trim());
  const { newStep, confirmDelete, ...task } = state.edit;
  state.tasks[index] = {
    ...task,
    title,
    updatedAt: Date.now(),
    reminders: { ...state.edit.reminders },
    steps: state.edit.steps.map((step) => ({ ...step })),
  };
}

function queueSave() {
  commitEdit();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(), 280);
}

function closeSheet() {
  if (state.sheet === "add") haltVoice();
  if (state.sheet === "task") {
    commitEdit();
    persist();
  }
  state.sheet = null;
  state.error = "";
  state.edit = null;
  render();
  document.getElementById("add-task")?.focus();
}

function openTask(id) {
  if (state.sheet === "task") commitEdit();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;
  state.edit = {
    ...task,
    reminders: { ...task.reminders },
    steps: task.steps.map((step) => ({ ...step })),
    newStep: "",
    confirmDelete: false,
  };
  state.sheet = "task";
  state.sheetReset = true;
  state.error = "";
  render();
}

function findTask(id) {
  return state.tasks.find((task) => task.id === id);
}

function completeTask(id) {
  const task = findTask(id);
  if (!task || task.completedAt) return;
  const previous = task.completedAt;
  const previousUpdated = task.updatedAt;
  task.completedAt = Date.now();
  task.updatedAt = task.completedAt;
  task.deferredUntil = null;
  state.sheet = null;
  state.edit = null;
  try { navigator.vibrate?.(10); } catch { /* optional */ }
  persist();
  celebrate(nextPhrase(), () => {
    const current = findTask(id);
    if (current) {
      current.completedAt = previous;
      current.updatedAt = previousUpdated;
    }
    persist();
  });
}

function toggleStep(taskId, stepId, quiet) {
  const task = findTask(taskId);
  const step = task?.steps.find((item) => item.id === stepId);
  if (!step) return;
  const was = step.done;
  step.done = !was;
  if (state.edit?.id === taskId) {
    const editStep = state.edit.steps.find((item) => item.id === stepId);
    if (editStep) editStep.done = step.done;
  }
  try { if (step.done) navigator.vibrate?.(8); } catch { /* optional */ }
  persist();
  const allDone = task.steps.length > 0 && task.steps.every((item) => item.done);
  if (quiet) render();
  else {
    showToast(step.done ? (allDone ? "All steps are done." : "Step done.") : "Step marked not done.", () => {
      const current = findTask(taskId)?.steps.find((item) => item.id === stepId);
      if (current) current.done = was;
      persist();
    });
  }
}

function deferTask(id) {
  const task = findTask(id);
  if (!task) return;
  const previous = task.deferredUntil;
  task.deferredUntil = Date.now() + 60 * 60 * 1000;
  persist();
  showToast("Hidden for an hour.", () => {
    const current = findTask(id);
    if (current) current.deferredUntil = previous;
    persist();
  });
}

async function submitComposer() {
  const draft = draftFrom(state.composer);
  if (draft.empty) {
    state.error = "Add a few words for the task.";
    render();
    return;
  }
  haltVoice();
  const task = createTask({
    title: draft.title,
    dueAt: draft.dueAt,
    allDay: draft.allDay,
    subject: draft.subject,
    reminders: draft.reminders,
  });
  state.tasks.push(task);
  const copy = previewCopy(draft);
  state.composer = freshComposer();
  state.error = "";
  state.sheet = null;
  const ask = !state.settings.askedNotify && permissionState() === "default";
  if (ask) state.settings.askedNotify = true;
  await persist();
  refreshPermission();
  if (ask) {
    state.sheet = "notify";
    state.sheetReset = true;
    render();
    return;
  }
  showToast(`Added. ${copy}`);
}

function shouldShowSummary() {
  if (state.screen !== "app" || state.sheet) return false;
  const now = new Date();
  const hour = now.getHours();
  if (hour < state.settings.morningHour || hour >= 12) return false;
  if (state.settings.lastSummaryDay === dayKey(now)) return false;
  const end = endOfDay(now).getTime();
  return state.tasks.some((task) => !task.completedAt && task.dueAt <= end);
}

function maybeSummary() {
  if (!shouldShowSummary()) return;
  state.settings.lastSummaryDay = dayKey(new Date());
  state.sheet = "summary";
  state.sheetReset = true;
  persist();
  render();
}

function applyPending() {
  const action = state.pendingAction;
  const taskId = state.pendingTask;
  const text = state.pendingText;
  const roomCode = state.pendingRoom;
  state.pendingAction = null;
  state.pendingTask = null;
  state.pendingText = "";
  state.pendingRoom = "";
  if (action === "speak") {
    openAdd({ voice: true, text });
    return true;
  }
  if (action === "add") {
    openAdd({ text });
    return true;
  }
  if (taskId) {
    openTask(taskId);
    return true;
  }
  if (roomCode) {
    openRoomCode(roomCode);
    return true;
  }
  return false;
}

async function enterApp(key, data) {
  state.key = key;
  state.tasks = data.tasks;
  state.settings = data.settings;
  state.tombstones = data.tombstones || [];
  state.accountEmail = data.accountEmail || "";
  state.syncKeyB64 = data.syncKeyB64 || "";
  state.syncKey = null;
  if (state.syncKeyB64) {
    try {
      state.syncKey = await openSyncKey(state.syncKeyB64);
    } catch {
      state.syncKey = null;
    }
  }
  state.hasVault = true;
  state.screen = "app";
  state.pinBuffer = "";
  state.passphrase = "";
  state.pinFirst = "";
  state.error = "";
  state.fails = { count: 0, until: 0 };
  state.lastActivity = Date.now();
  state.timer.mode = "focus";
  state.timer.running = false;
  state.timer.durationMs = data.settings.pomodoroMin * 60 * 1000;
  state.timer.remainingMs = state.timer.durationMs;
  applyTheme(data.settings.theme);
  refreshPermission();
  const opened = applyPending();
  if (!opened) maybeSummary();
  render();
  await syncSchedule(state.tasks, state.settings, notificationHooks);
  runSync({ force: true });
  state.background = await registerBackgroundWork();
  state.caps = await probeCapabilities();
  refreshPermission();
  await updateBadge(openCount(state.tasks));
  render();
}

async function pinSubmit() {
  if (state.cryptoBusy) return;
  if (state.fails?.until > Date.now()) return;
  const secret = secretNow();
  if (secret.length < 4) {
    state.error = "Use at least 4 characters.";
    state.shake = true;
    render();
    return;
  }
  if (state.screen === "setup" && state.setupStep === "create") {
    state.pinFirst = secret;
    state.setupStep = "confirm";
    state.pinBuffer = "";
    state.passphrase = "";
    state.error = "";
    state.weakPin = false;
    render();
    return;
  }
  if (state.screen === "setup" && secret !== state.pinFirst) {
    state.error = "Those didn’t match. Enter it again.";
    state.shake = true;
    state.pinBuffer = "";
    state.passphrase = "";
    render();
    return;
  }
  state.cryptoBusy = true;
  state.error = "";
  render();
  await yieldPaint();
  try {
    if (state.screen === "setup") {
      const settings = defaultSettings();
      const stored = localStorage.getItem("still-theme");
      if (stored === "dark" || stored === "light" || stored === "system") settings.theme = stored;
      const key = await createVault(secret, { tasks: [], settings });
      state.pinFirst = "";
      await enterApp(key, { tasks: [], settings });
    } else {
      const opened = await openVault(secret);
      await enterApp(opened.key, opened.data);
    }
  } catch (error) {
    state.cryptoBusy = false;
    state.pinBuffer = "";
    state.passphrase = "";
    if (error?.code === "bad-pin") {
      state.fails = await noteFailedAttempt();
      state.error = "That PIN didn’t open the vault.";
      state.shake = true;
    } else if (error?.code === "vault-exists") {
      state.hasVault = true;
      state.screen = "lock";
      state.error = "A list is already on this device, so a new PIN was not saved over it.";
    } else {
      state.error = "The vault couldn’t be opened. Nothing was erased.";
    }
    render();
    return;
  }
  state.cryptoBusy = false;
}

async function lock() {
  haltVoice();
  if (state.timer.running) {
    state.timer.remainingMs = Math.max(0, state.timer.endsAt - Date.now());
    state.timer.running = false;
  }
  clearTimeout(saveTimer);
  if (state.sheet === "task") commitEdit();
  try {
    await persist();
  } catch {
    /* lock anyway */
  }
  sealing = true;
  state.key = null;
  state.syncKey = null;
  state.syncKeyB64 = "";
  state.account.passwordDraft = "";
  const held = state.account.hold;
  state.account.hold = null;
  if (held?.session?.token && held.session.url) {
    createSyncClient(held.session.url).logout(held.session.token).catch(() => {});
  }
  state.tasks = [];
  state.tombstones = [];
  state.settings = defaultSettings();
  state.screen = state.hasVault ? "lock" : "setup";
  state.sheet = null;
  state.edit = null;
  state.composer = freshComposer();
  state.toast = "";
  state.celebrate = "";
  state.undo = null;
  state.error = "";
  state.pinBuffer = "";
  state.passphrase = "";
  state.cryptoBusy = false;
  updateBadge(0);
  applyTheme(localStorage.getItem("still-theme") || "system");
  sealing = false;
  render();
}

async function eraseEverything() {
  haltVoice();
  stopForeground();
  clearTimeout(saveTimer);
  sealing = true;
  try {
    await saveChain;
  } catch {
    /* the vault is about to be removed */
  }
  await eraseVault();
  clearWidget();
  state.key = null;
  state.tasks = [];
  state.hasVault = false;
  state.screen = "setup";
  state.setupStep = "create";
  state.sheet = null;
  state.edit = null;
  state.pinBuffer = "";
  state.pinFirst = "";
  state.passphrase = "";
  state.fails = { count: 0, until: 0 };
  state.error = "";
  sealing = false;
  updateBadge(0);
  render();
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function exportEncrypted() {
  await persist();
  const record = await readVaultRecord();
  if (!record?.vault) {
    showToast("Nothing to export yet.");
    return;
  }
  download(`still-backup-${dayKey(new Date())}.json`, JSON.stringify(backupFromRecord(record), null, 2));
  showToast("Encrypted backup downloaded.");
}

function exportPlain() {
  download(
    `still-tasks-${dayKey(new Date())}.json`,
    JSON.stringify(
      {
        format: "still-plaintext",
        warning: "This file is not encrypted. Anyone who opens it can read your tasks.",
        exportedAt: new Date().toISOString(),
        tasks: state.tasks,
        settings: state.settings,
      },
      null,
      2,
    ),
  );
  state.sheet = null;
  showToast("Readable copy downloaded. It is not encrypted.");
}

async function beginImport(file) {
  if (file.size > 2_000_000) {
    showToast("That file is too large.");
    return;
  }
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    showToast("That file isn’t a Still backup.");
    return;
  }
  const parsed = parseBackup(json);
  if (!parsed) {
    showToast("That file isn’t a Still backup.");
    return;
  }
  state.importBackup = parsed;
  state.importPin = "";
  state.error = "";
  state.sheet = "import";
  state.sheetReset = true;
  render();
}

async function restoreImport() {
  const parsed = state.importBackup;
  const secret = state.importPin;
  if (!parsed) return;
  if (secret.length < 4) {
    state.error = "Enter the backup PIN.";
    render();
    return;
  }
  state.cryptoBusy = true;
  render();
  await yieldPaint();
  try {
    const key = await deriveKey(secret, parsed.salt, parsed.iterations);
    const ok = await checkVerifier(key, parsed.verifier);
    if (!ok) {
      state.error = "That PIN doesn’t open this backup.";
      state.cryptoBusy = false;
      render();
      return;
    }
    const data = sanitizePayload(await decryptJson(key, parsed.vault));
    await keepPreviousVault();
    state.hasPrevious = true;
    await commitVault({
      salt: parsed.salt,
      iterations: parsed.iterations,
      verifier: parsed.verifier,
      vault: parsed.vault,
    });
    state.importBackup = null;
    state.importPin = "";
    state.cryptoBusy = false;
    state.sheet = null;
    await enterApp(key, data);
    showToast("Backup restored on this phone.");
  } catch {
    state.cryptoBusy = false;
    state.error = "That backup couldn’t be restored.";
    render();
  }
}

async function updatePin() {
  const first = state.changeA;
  const second = state.changeB;
  if (first.length < 4) {
    state.error = "Use at least 4 characters.";
    render();
    return;
  }
  if (first !== second) {
    state.error = "Those didn’t match.";
    render();
    return;
  }
  state.cryptoBusy = true;
  render();
  await yieldPaint();
  try {
    state.key = await changeSecret(first, { tasks: state.tasks, settings: state.settings });
    state.changeA = "";
    state.changeB = "";
    state.cryptoBusy = false;
    state.sheet = null;
    showToast("PIN updated.");
  } catch {
    state.cryptoBusy = false;
    state.error = "Couldn’t update the PIN.";
    render();
  }
}

function startFocusTimer(taskId) {
  state.timer.mode = "focus";
  state.timer.taskId = taskId || null;
  state.timer.durationMs = state.settings.pomodoroMin * 60 * 1000;
  state.timer.remainingMs = state.timer.durationMs;
  state.timer.endsAt = Date.now() + state.timer.durationMs;
  state.timer.running = true;
  state.view = "timer";
  state.sheet = null;
  publishRoomFocus();
  render();
}

function resumeTimer() {
  if (state.timer.remainingMs <= 0) {
    const minutes = state.timer.mode === "break" ? state.settings.breakMin : state.settings.pomodoroMin;
    state.timer.durationMs = minutes * 60 * 1000;
    state.timer.remainingMs = state.timer.durationMs;
  }
  state.timer.endsAt = Date.now() + state.timer.remainingMs;
  state.timer.running = true;
  publishRoomFocus();
  render();
}

function pauseTimer() {
  if (!state.timer.running) return;
  state.timer.remainingMs = Math.max(0, state.timer.endsAt - Date.now());
  state.timer.running = false;
  publishRoomFocus();
  render();
}

function resetTimer() {
  state.timer.running = false;
  state.timer.mode = "focus";
  state.timer.taskId = null;
  state.timer.durationMs = state.settings.pomodoroMin * 60 * 1000;
  state.timer.remainingMs = state.timer.durationMs;
  publishRoomFocus();
  render();
}

function finishTimer() {
  if (!state.timer.running && state.timer.remainingMs > 0) return;
  const wasBreak = state.timer.mode === "break";
  state.timer.running = false;
  state.timer.remainingMs = 0;
  try { navigator.vibrate?.(12); } catch { /* optional */ }
  if (wasBreak) {
    state.timer.mode = "focus";
    state.timer.durationMs = state.settings.pomodoroMin * 60 * 1000;
    state.timer.remainingMs = state.timer.durationMs;
    showTimerDone("Break’s over.");
    showToast("Break’s over. The next step can be small.");
  } else {
    state.timer.mode = "break";
    state.timer.durationMs = state.settings.breakMin * 60 * 1000;
    state.timer.remainingMs = state.timer.durationMs;
    showTimerDone("Focus time is up. Stop if you want to.");
    showToast("Time’s up. Stop if you want to.");
  }
}

function addStep() {
  if (!state.edit) return;
  const title = (state.edit.newStep || "").trim();
  if (!title) return;
  state.edit.steps.push({ id: crypto.randomUUID(), title, done: false });
  state.edit.newStep = "";
  commitEdit();
  persist();
  render();
}

function setQuickDue(kind) {
  const parsed = state.composer.text.trim() ? parseTask(state.composer.text) : null;
  const base = new Date();
  if (kind === "tomorrow") base.setDate(base.getDate() + 1);
  if (kind === "week") base.setDate(base.getDate() + 7);
  if (parsed?.explicitTime) {
    const previous = new Date(parsed.dueAt);
    base.setHours(previous.getHours(), previous.getMinutes(), 0, 0);
    state.composer.allDayOverride = false;
  } else {
    base.setHours(23, 59, 0, 0);
    state.composer.allDayOverride = true;
  }
  state.composer.dueOverride = base.getTime();
  render();
}

async function allowNotifications() {
  const result = await askNotificationPermission();
  state.notificationPermission = result;
  if (result === "granted") {
    state.background = await registerBackgroundWork();
    state.caps = await probeCapabilities();
    await syncSchedule(state.tasks, state.settings, notificationHooks);
    if (state.sheet === "notify") state.sheet = null;
    showToast("Reminders are on.");
    return;
  }
  render();
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  state.lastActivity = Date.now();
  const action = button.dataset.action;
  if (action === "digit") {
    if (state.cryptoBusy || state.fails?.until > Date.now()) return;
    if (state.pinBuffer.length >= 12) return;
    state.pinBuffer += button.dataset.key;
    state.weakPin = weakSecret(state.pinBuffer);
    state.error = "";
    render();
    return;
  }
  if (action === "pin-back") {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    state.weakPin = weakSecret(state.pinBuffer);
    render();
    return;
  }
  if (action === "pin-submit") {
    pinSubmit();
    return;
  }
  if (action === "toggle-passphrase") {
    state.passphraseMode = !state.passphraseMode;
    state.error = "";
    render();
    return;
  }
  if (action === "setup-restart") {
    state.setupStep = "create";
    state.pinFirst = "";
    state.pinBuffer = "";
    state.passphrase = "";
    state.error = "";
    render();
    return;
  }
  if (action === "forgot" || action === "erase") {
    state.eraseForgot = action === "forgot";
    state.sheet = "erase";
    state.sheetReset = true;
    render();
    return;
  }
  if (action === "confirm-erase") {
    eraseEverything();
    return;
  }
  if (action === "close-sheet") {
    closeSheet();
    return;
  }
  if (action === "nav") {
    state.view = button.dataset.view;
    refreshPermission();
    if (state.view === "room") ensurePresence();
    render();
    return;
  }
  if (action === "room-floor") {
    state.room.floor = button.dataset.value === "3" ? "3" : "1";
    render();
    return;
  }
  if (action === "room-mode") {
    state.room.mode = button.dataset.value;
    render();
    return;
  }
  if (action === "room-chibi") {
    state.room.chibi = button.dataset.id;
    rememberRoomProfile();
    render();
    return;
  }
  if (action === "room-public") {
    state.room.isPublic = !state.room.isPublic;
    render();
    return;
  }
  if (action === "room-refresh") {
    ensurePresence().list();
    return;
  }
  if (action === "room-create") {
    rememberRoomProfile();
    const result = ensurePresence().create({
      name: state.room.roomName,
      public: state.room.isPublic,
      displayName: state.room.displayName,
      chibi: state.room.chibi,
      seat: 0,
      focusing: Boolean(state.room.focusLatch),
    });
    if (result?.ok === false) {
      state.room.error = result.error;
      render();
    }
    return;
  }
  if (action === "room-join") {
    joinRoom(button.dataset.code || state.room.codeInput);
    return;
  }
  if (action === "room-seat") {
    const result = ensurePresence().move(Number(button.dataset.seat));
    if (result?.ok === false) {
      state.room.error = result.error;
      render();
    }
    return;
  }
  if (action === "room-focus") {
    state.room.focusLatch = !state.room.focusLatch;
    publishRoomFocus();
    render();
    return;
  }
  if (action === "room-leave") {
    ensurePresence().leave();
    state.room.current = null;
    state.room.you = null;
    state.room.invite = "";
    state.room.roomJson = "";
    state.room.walked = {};
    state.room.focusLatch = false;
    ensurePresence().list();
    render();
    return;
  }
  if (action === "room-copy") {
    const link = state.room.invite;
    navigator.clipboard?.writeText(link).then(() => showToast("Invite link copied.")).catch(() => showToast(link));
    return;
  }
  if (action === "room-server") {
    try {
      localStorage.setItem("still-room-server", state.room.serverUrl.trim());
    } catch {
      /* ignore */
    }
    presenceHandle?.close();
    presenceHandle = null;
    state.room.current = null;
    state.room.you = null;
    ensurePresence();
    render();
    return;
  }
  if (action === "go-tasks") {
    state.view = "tasks";
    render();
    return;
  }
  if (action === "add") {
    openAdd();
    return;
  }
  if (action === "voice") {
    if (state.listening) {
      haltVoice();
      render();
      return;
    }
    if (state.sheet === "add") beginVoice();
    else openAdd({ voice: true });
    return;
  }
  if (action === "quick-due") {
    setQuickDue(button.dataset.kind);
    return;
  }
  if (action === "clear-due") {
    state.composer.dueOverride = null;
    state.composer.allDayOverride = null;
    render();
    return;
  }
  if (action === "composer-reminder") {
    const draft = draftFrom(state.composer);
    state.composer.reminders = { ...draft.reminders, [button.dataset.kind]: !draft.reminders[button.dataset.kind] };
    render();
    return;
  }
  if (action === "composer-subject") {
    const draft = draftFrom(state.composer);
    state.composer.subjectOverride = draft.subject === button.dataset.subject ? "" : button.dataset.subject;
    render();
    return;
  }
  if (action === "open-task") {
    openTask(button.dataset.id);
    return;
  }
  if (action === "complete") {
    completeTask(button.dataset.id);
    return;
  }
  if (action === "reopen") {
    const task = findTask(button.dataset.id);
    if (!task) return;
    task.completedAt = null;
    if (state.edit?.id === task.id) state.edit.completedAt = null;
    persist();
    showToast("Back on the list.");
    return;
  }
  if (action === "complete-step") {
    toggleStep(button.dataset.id, button.dataset.step);
    return;
  }
  if (action === "toggle-step") {
    toggleStep(state.edit?.id, button.dataset.id, true);
    return;
  }
  if (action === "defer") {
    deferTask(button.dataset.id);
    return;
  }
  if (action === "start-timer") {
    startFocusTimer(button.dataset.id);
    return;
  }
  if (action === "add-step") {
    addStep();
    return;
  }
  if (action === "remove-step") {
    if (!state.edit) return;
    state.edit.steps = state.edit.steps.filter((step) => step.id !== button.dataset.id);
    commitEdit();
    persist();
    render();
    return;
  }
  if (action === "edit-reminder") {
    if (!state.edit) return;
    const kind = button.dataset.kind;
    state.edit.reminders = { ...state.edit.reminders, [kind]: !state.edit.reminders[kind] };
    commitEdit();
    persist();
    render();
    return;
  }
  if (action === "edit-subject") {
    if (!state.edit) return;
    state.edit.subject = state.edit.subject === button.dataset.subject ? "" : button.dataset.subject;
    commitEdit();
    persist();
    render();
    return;
  }
  if (action === "undefer") {
    if (!state.edit) return;
    state.edit.deferredUntil = null;
    commitEdit();
    persist();
    render();
    return;
  }
  if (action === "ask-delete") {
    if (!state.edit) return;
    state.edit.confirmDelete = true;
    render();
    return;
  }
  if (action === "cancel-delete") {
    if (!state.edit) return;
    state.edit.confirmDelete = false;
    render();
    return;
  }
  if (action === "delete-task") {
    const id = button.dataset.id;
    const removed = findTask(id);
    const tomb = { id, at: Date.now() };
    state.tasks = state.tasks.filter((task) => task.id !== id);
    state.tombstones.push(tomb);
    state.sheet = null;
    state.edit = null;
    persist();
    showToast("Removed.", () => {
      state.tombstones = state.tombstones.filter((item) => item !== tomb);
      if (removed) state.tasks.push(removed);
      persist();
    });
    return;
  }
  if (action === "toggle-done") {
    state.showDone = !state.showDone;
    render();
    return;
  }
  if (action === "undo") {
    const undo = state.undo;
    state.undo = null;
    state.celebrate = "";
    state.toast = "";
    celebrateToken += 1;
    if (typeof undo === "function") undo();
    render();
    return;
  }
  if (action === "pause-timer") {
    pauseTimer();
    return;
  }
  if (action === "resume-timer") {
    resumeTimer();
    return;
  }
  if (action === "reset-timer") {
    resetTimer();
    return;
  }
  if (action === "pomodoro") {
    state.settings.pomodoroMin = Number(button.dataset.value);
    state.settings.settingsUpdatedAt = Date.now();
    if (!state.timer.running && state.timer.mode === "focus") {
      state.timer.durationMs = state.settings.pomodoroMin * 60 * 1000;
      state.timer.remainingMs = state.timer.durationMs;
    }
    persist();
    render();
    return;
  }
  if (action === "break-length") {
    state.settings.breakMin = Number(button.dataset.value);
    state.settings.settingsUpdatedAt = Date.now();
    if (!state.timer.running && state.timer.mode === "break") {
      state.timer.durationMs = state.settings.breakMin * 60 * 1000;
      state.timer.remainingMs = state.timer.durationMs;
    }
    persist();
    render();
    return;
  }
  if (action === "theme") {
    state.settings.theme = button.dataset.value;
    state.settings.settingsUpdatedAt = Date.now();
    applyTheme(state.settings.theme);
    persist();
    render();
    return;
  }
  if (action === "autolock") {
    state.settings.autoLockMin = Number(button.dataset.value);
    state.settings.settingsUpdatedAt = Date.now();
    persist();
    render();
    return;
  }
  if (action === "toggle-titles") {
    state.settings.showTitlesInNotifications = !state.settings.showTitlesInNotifications;
    state.settings.settingsUpdatedAt = Date.now();
    persist();
    render();
    return;
  }
  if (action === "allow-notifications") {
    allowNotifications();
    return;
  }
  if (action === "lock") {
    lock();
    return;
  }
  if (action === "account-save-url") {
    saveAccountUrl();
    return;
  }
  if (action === "account-register" || action === "account-login") {
    submitAccount(action === "account-register" ? "register" : "login");
    return;
  }
  if (action === "account-logout") {
    signOutAccount();
    return;
  }
  if (action === "account-keep") {
    keepPhoneList();
    return;
  }
  if (action === "account-use-remote") {
    useAccountList();
    return;
  }
  if (action === "account-merge") {
    mergeAccountList();
    return;
  }
  if (action === "restore-previous") {
    restoreEarlierCopy();
    return;
  }
  if (action === "export-partial") {
    exportPartial();
    return;
  }
  if (action === "export") {
    exportEncrypted();
    return;
  }
  if (action === "import") {
    document.getElementById("import-file")?.click();
    return;
  }
  if (action === "plaintext") {
    state.sheet = "plaintext";
    state.sheetReset = true;
    render();
    return;
  }
  if (action === "confirm-plaintext") {
    exportPlain();
    return;
  }
  if (action === "change-pin") {
    state.changeA = "";
    state.changeB = "";
    state.error = "";
    state.sheet = "change-pin";
    state.sheetReset = true;
    render();
    return;
  }
  if (action === "summary-start") {
    state.sheet = null;
    state.view = "focus";
    render();
    return;
  }
  if (action === "install") {
    state.installPrompt?.prompt();
    state.installPrompt?.userChoice.then(() => {
      state.installPrompt = null;
      render();
    });
    return;
  }
  if (action === "apply-update") {
    navigator.serviceWorker?.getRegistration().then((registration) => {
      registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    });
    let reloading = false;
    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
    setTimeout(() => location.reload(), 1200);
  }
}

function onInput(event) {
  const target = event.target;
  state.lastActivity = Date.now();
  if (target.id === "composer-text") {
    state.composer.text = target.value;
    state.error = "";
    render();
    return;
  }
  if (target.id === "passphrase") {
    state.passphrase = target.value;
    state.error = "";
    return;
  }
  if (target.id === "edit-title" && state.edit) {
    state.edit.title = target.value;
    queueSave();
    return;
  }
  if (target.id === "edit-notes" && state.edit) {
    state.edit.notes = target.value;
    queueSave();
    return;
  }
  if (target.id === "new-step" && state.edit) {
    state.edit.newStep = target.value;
    return;
  }
  if (target.dataset.stepTitle && state.edit) {
    const step = state.edit.steps.find((item) => item.id === target.dataset.stepTitle);
    if (step) step.title = target.value;
    return;
  }
  if (target.id === "new-pin") state.changeA = target.value;
  if (target.id === "new-pin-2") state.changeB = target.value;
  if (target.id === "import-pin") state.importPin = target.value;
  if (target.id === "room-name") state.room.displayName = target.value;
  if (target.id === "room-title") state.room.roomName = target.value;
  if (target.id === "room-code") state.room.codeInput = target.value;
  if (target.id === "room-server") state.room.serverUrl = target.value;
}

function onChange(event) {
  const target = event.target;
  if (target.id === "due-input") {
    const ts = fromDatetimeLocal(target.value);
    if (ts) {
      state.composer.dueOverride = ts;
      const date = new Date(ts);
      state.composer.allDayOverride = date.getHours() === 23 && date.getMinutes() === 59;
      render();
    }
    return;
  }
  if (target.id === "edit-due" && state.edit) {
    const ts = fromDatetimeLocal(target.value);
    if (!ts) return;
    state.edit.dueAt = ts;
    const date = new Date(ts);
    state.edit.allDay = date.getHours() === 23 && date.getMinutes() === 59;
    state.edit.deferredUntil = null;
    commitEdit();
    persist();
    render();
    return;
  }
  if (target.id === "morning-hour") {
    state.settings.morningHour = Number(target.value);
    state.settings.settingsUpdatedAt = Date.now();
    persist();
    return;
  }
  if (target.id === "account-url") state.account.url = target.value;
  if (target.id === "account-email") state.account.emailDraft = target.value;
  if (target.id === "account-password") state.account.passwordDraft = target.value;
  if (target.id === "import-file") {
    const file = target.files?.[0];
    target.value = "";
    if (file) beginImport(file);
    return;
  }
  if (target.dataset.stepTitle) {
    commitEdit();
    persist();
  }
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === "add-form") submitComposer();
  if (form.id === "pass-form") pinSubmit();
  if (form.id === "change-pin-form") updatePin();
  if (form.id === "import-form") restoreImport();
}

function onKey(event) {
  state.lastActivity = Date.now();
  if (event.key === "Escape" && state.sheet) {
    closeSheet();
    return;
  }
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if ((state.screen === "lock" || state.screen === "setup") && !state.passphraseMode && !typing) {
    if (/^[0-9]$/.test(event.key)) {
      if (state.pinBuffer.length < 12 && !state.cryptoBusy) {
        state.pinBuffer += event.key;
        state.weakPin = weakSecret(state.pinBuffer);
        state.error = "";
        render();
      }
      return;
    }
    if (event.key === "Backspace") {
      state.pinBuffer = state.pinBuffer.slice(0, -1);
      render();
      return;
    }
    if (event.key === "Enter") pinSubmit();
  }
  if (event.key === "Enter" && event.target?.id === "composer-text" && !event.shiftKey) {
    event.preventDefault();
    submitComposer();
  }
  if (event.key === "Enter" && event.target?.id === "new-step") {
    event.preventDefault();
    addStep();
  }
  if (state.screen === "app" && !typing && !state.sheet && event.key.toLowerCase() === "n" && !event.metaKey && !event.ctrlKey) {
    openAdd();
  }
}

function tick() {
  if (state.timer.running) {
    const left = state.timer.endsAt - Date.now();
    if (left <= 0) finishTimer();
    else {
      state.timer.remainingMs = left;
      const readout = document.querySelector("[data-timer-readout]");
      if (readout) readout.textContent = formatClock(left);
      const ring = document.querySelector("[data-timer-ring]");
      if (ring && state.timer.durationMs) {
        const length = 2 * Math.PI * 86;
        ring.setAttribute("stroke-dashoffset", String(length * (1 - left / state.timer.durationMs)));
      }
    }
  }
  const wait = document.querySelector("[data-wait]");
  if (state.fails?.until > Date.now()) {
    if (wait) wait.textContent = `Try again in ${Math.ceil((state.fails.until - Date.now()) / 1000)}s.`;
  } else if (wait) {
    state.fails = { ...state.fails, until: 0 };
    render();
  }
}

function watchLock() {
  if (state.screen !== "app" || state.cryptoBusy) return;
  const minutes = state.settings.autoLockMin;
  if (!minutes) return;
  if (Date.now() - state.lastActivity >= minutes * 60 * 1000) lock();
}

let presenceHandle = null;

function hydrateRoom() {
  try {
    state.room.displayName = localStorage.getItem("still-display-name") || "";
    state.room.chibi = localStorage.getItem("still-chibi") || "pebbles";
    state.room.serverUrl = localStorage.getItem("still-room-server") || "";
  } catch {
    /* private mode can refuse storage that isn't IndexedDB */
  }
}

function rememberRoomProfile() {
  try {
    localStorage.setItem("still-display-name", state.room.displayName.trim());
    localStorage.setItem("still-chibi", state.room.chibi);
  } catch {
    /* ignore */
  }
}

function publishRoomFocus() {
  if (!state.room.current || !presenceHandle?.pose) return;
  presenceHandle.pose(Boolean(state.timer.running || state.room.focusLatch));
}

function ensurePresence() {
  const url = state.room.serverUrl.trim();
  const key = url || "local";
  if (presenceHandle && presenceHandle.key === key) return presenceHandle;
  presenceHandle?.close();
  presenceHandle = connectPresence(key, {
    onStatus(status, error) {
      const errorText = error || "";
      const changed = state.room.status !== status || state.room.error !== errorText;
      state.room.status = status;
      state.room.modeLabel = presenceHandle?.mode || "local";
      state.room.error = errorText;
      if (changed && state.view === "room" && state.screen === "app") render();
    },
    onRooms(rooms) {
      const next = JSON.stringify(rooms);
      state.room.rooms = rooms;
      if (next === state.room.roomsJson) return;
      state.room.roomsJson = next;
      if (state.view === "room" && state.screen === "app" && !state.room.current) render();
    },
    onRoom(room, you) {
      const next = room ? JSON.stringify(room.members) : "";
      const seated = { ...state.room.seatedAt };
      const youId = you?.id;
      const previousSeat = state.room.current?.members?.find((member) => member.id === youId)?.seat;
      const nextSeat = room?.members?.find((member) => member.id === youId)?.seat;
      if (youId && previousSeat !== nextSeat) {
        for (const key of Object.keys(state.room.walked)) {
          if (key.startsWith(`${youId}:`)) delete state.room.walked[key];
        }
      }
      for (const member of room?.members || []) {
        if (!seated[member.id]) seated[member.id] = Date.now();
      }
      state.room.seatedAt = seated;
      state.room.current = room;
      state.room.you = you;
      state.room.invite = room ? inviteLink(room.code, location.href) : "";
      if (next === state.room.roomJson && room) return;
      state.room.roomJson = next;
      if (state.view === "room" && state.screen === "app") render();
    },
  });
  state.room.modeLabel = presenceHandle.mode;
  return presenceHandle;
}

function joinRoom(code) {
  rememberRoomProfile();
  const result = ensurePresence().join({
    code,
    displayName: state.room.displayName,
    chibi: state.room.chibi,
    seat: 0,
    focusing: Boolean(state.room.focusLatch),
  });
  if (result?.ok === false) {
    state.room.error = result.error;
    render();
  }
}

function openRoomCode(code) {
  state.view = "room";
  state.room.mode = "code";
  state.room.codeInput = code;
  ensurePresence();
  if (state.room.displayName.trim()) {
    const result = ensurePresence().join({
      code,
      displayName: state.room.displayName,
      chibi: state.room.chibi,
      seat: 0,
    });
    if (result?.ok === false) state.room.error = result.error;
  }
  render();
}

function readLaunch() {
  const params = new URLSearchParams(location.search);
  state.pendingAction = params.get("action");
  state.pendingTask = params.get("task");
  state.pendingText = (params.get("text") || params.get("title") || "").trim();
  state.pendingRoom = params.get("room") || "";
  if (!state.pendingAction && state.pendingText) state.pendingAction = "add";
  if ([...params.keys()].length) history.replaceState({}, "", location.pathname);
}

function applyNativeUrl(url) {
  const parsed = nativeActionFromUrl(url);
  if (!parsed) return;
  if (parsed.action) state.pendingAction = parsed.action;
  if (parsed.task) state.pendingTask = parsed.task;
  if (parsed.room) state.pendingRoom = parsed.room;
  if (state.screen === "app") applyPending();
}

function registerServiceWorker() {
  if (state.native || navigator.userAgent.includes("Electron") || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const swUrl = new URL("sw.js", document.baseURI).href;
  const scope = new URL("./", document.baseURI).href;
  navigator.serviceWorker.register(swUrl, { scope }).then((registration) => {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          state.updateReady = true;
          if (state.screen === "app" && state.view === "settings") render();
        }
      });
    });
  }).catch(() => {
    state.swError = true;
  });
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "OPEN_TASK") return;
    if (state.screen === "app" && event.data.taskId) openTask(event.data.taskId);
    else if (event.data.taskId) state.pendingTask = event.data.taskId;
  });
}

let syncTimer = null;

function scheduleSync() {
  if (!state.account.dirty || !state.syncKey || state.account.hold || state.screen !== "app") return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    runSync();
  }, 800);
}

async function runSync({ force = false } = {}) {
  if (sealing || !state.key || !state.syncKey || state.account.hold) return;
  if (!force && !state.account.dirty) return;
  const session = await kvGet("sync-session");
  if (!session?.token || !session.url) return;
  state.account.busy = true;
  try {
    const outcome = await syncExisting({
      client: createSyncClient(session.url),
      token: session.token,
      syncKey: state.syncKey,
      local: snapshot(),
      baseRevision: session.revision || 0,
      dirty: state.account.dirty,
    });
    if (outcome.changed === false) {
      state.account.status = "signed-in";
      state.account.detail = outcome.message;
      state.account.email = session.email || state.account.email;
      state.account.revision = outcome.revision;
      if (state.view === "settings") render();
      return;
    }
    await applySynced(outcome, session);
  } catch {
    state.account.status = "offline";
    state.account.detail = "Saved on this device. The account list was not applied, and nothing there was replaced.";
    if (state.view === "settings") render();
  } finally {
    state.account.busy = false;
  }
}

async function applySynced(outcome, session) {
  const next = outcome.payload || snapshot();
  session.revision = outcome.revision;
  state.account.revision = outcome.revision;
  state.account.email = session.email;
  state.account.status = "signed-in";
  state.account.detail = outcome.message;
  state.account.hold = null;
  await kvSet("sync-session", { ...session, revision: outcome.revision });
  state.tasks = next.tasks || [];
  state.settings = next.settings || state.settings;
  state.tombstones = next.tombstones || [];
  state.accountEmail = next.accountEmail || session.email;
  if (next.syncKeyB64) state.syncKeyB64 = next.syncKeyB64;
  state.account.dirty = false;
  applyTheme(state.settings.theme);
  await persist({ quiet: true });
  render();
}

async function submitAccount(mode) {
  if (state.account.busy) return;
  const url = state.account.url.trim();
  if (!url) {
    state.account.detail = "Sync is not connected. Add the account server address first. Nothing was sent.";
    render();
    return;
  }
  state.account.busy = true;
  state.account.detail = "Checking the account…";
  render();
  const password = state.account.passwordDraft;
  state.account.passwordDraft = "";
  const local = snapshot();
  const result = await connectAccount({
    url,
    email: state.account.emailDraft,
    password,
    mode,
    local,
  });
  state.account.busy = false;
  if (!result.ok) {
    state.account.detail = result.message;
    render();
    return;
  }
  if (result.held) {
    state.account.hold = result;
    state.account.status = "held";
    state.account.detail = result.message;
    render();
    return;
  }
  state.syncKeyB64 = result.syncKeyB64;
  state.syncKey = await openSyncKey(result.syncKeyB64);
  await applySynced({ payload: result.payload, revision: result.session.revision, message: result.message }, result.session);
  showToast(result.message);
}

async function saveAccountUrl() {
  const url = state.account.url.trim();
  state.account.url = url;
  try {
    localStorage.setItem("still-sync-url", url);
  } catch {
    /* the address can still be used for this visit */
  }
  await signOutAccount({ keepDetail: true });
  if (!url) {
    state.account.status = "unconfigured";
    state.account.detail = "Sync is not connected. No account server is set, so tasks stay on this device.";
  } else {
    state.account.status = "signed-out";
    state.account.detail = "Server address saved. Sign in when you are ready. Nothing has been uploaded.";
  }
  render();
}

async function signOutAccount({ keepDetail = false } = {}) {
  const session = await kvGet("sync-session").catch(() => null);
  const held = state.account.hold?.session;
  for (const item of [session, held]) {
    if (!item?.token || !item.url) continue;
    try {
      await createSyncClient(item.url).logout(item.token);
    } catch {
      /* signing out locally still drops the token */
    }
  }
  await clearSyncSession().catch(() => {});
  state.syncKey = null;
  state.account.hold = null;
  state.account.email = "";
  state.account.busy = false;
  state.account.revision = 0;
  if (!keepDetail) {
    state.account.status = state.account.url ? "signed-out" : "unconfigured";
    state.account.detail = "Signed out. The list is still on this device.";
    render();
  }
}

async function keepPhoneList() {
  await signOutAccount();
  state.account.detail = "Kept this device’s list. That account was not changed.";
  render();
}

async function useAccountList() {
  const held = state.account.hold;
  const remote = held?.remote;
  if (!held || !remote?.tasks?.length) {
    state.account.detail = "The account list is empty, so this device was not replaced.";
    render();
    return;
  }
  await keepPreviousVault();
  state.hasPrevious = true;
  state.syncKeyB64 = held.syncKeyB64;
  state.syncKey = await openSyncKey(held.syncKeyB64);
  const payload = {
    ...remote,
    accountEmail: held.session.email,
    syncKeyB64: held.syncKeyB64,
  };
  await applySynced(
    { payload, revision: held.remoteRevision || held.session.revision || 0, message: "Using the account list. The previous copy is still on this device." },
    held.session,
  );
}

async function mergeAccountList() {
  const held = state.account.hold;
  if (!held?.session) return;
  state.syncKeyB64 = held.syncKeyB64;
  state.syncKey = await openSyncKey(held.syncKeyB64);
  const local = { ...snapshot(), accountEmail: held.session.email, syncKeyB64: held.syncKeyB64 };
  const merged = mergePayloads(local, held.remote || { tasks: [], tombstones: [], settings: local.settings });
  try {
    const outcome = await pushPlan({
      client: createSyncClient(held.session.url),
      token: held.session.token,
      syncKey: state.syncKey,
      syncKeyB64: held.syncKeyB64,
      local: { ...merged, accountEmail: held.session.email, syncKeyB64: held.syncKeyB64 },
      remote: held.remote,
      baseRevision: 0,
      remoteRevision: held.remoteRevision || 0,
      dirty: true,
      wrapped: null,
    });
    await applySynced(outcome, held.session);
  } catch {
    state.account.detail = "Could not merge. This device was not replaced, and the account was left as it was.";
    state.account.hold = held;
    render();
  }
}

async function restoreEarlierCopy() {
  sealing = true;
  clearTimeout(saveTimer);
  state.key = null;
  state.syncKey = null;
  const ok = await restorePreviousVault();
  sealing = false;
  if (!ok) {
    showToast("There is no earlier copy on this device.");
    return;
  }
  state.tasks = [];
  state.tombstones = [];
  state.hasVault = true;
  state.screen = "lock";
  state.sheet = null;
  showToast("Restored the earlier copy. Unlock it with the PIN from that copy.");
  render();
}

async function exportPartial() {
  const record = await readVaultRecord();
  download(
    `still-partial-${dayKey(new Date())}.json`,
    JSON.stringify(
      {
        format: "still-partial",
        warning: "This is the raw vault record from this device. It does not include the PIN.",
        exportedAt: new Date().toISOString(),
        record: backupFromRecord({
          ...record,
          iterations: record.iterations || 210000,
          salt: record.salt || new Uint8Array(),
          verifier: record.verifier || { iv: new Uint8Array(), ct: new Uint8Array() },
          vault: record.vault || { iv: new Uint8Array(), ct: new Uint8Array() },
        }),
      },
      null,
      2,
    ),
  );
  showToast("Downloaded the vault record that is on this device. Nothing was deleted.");
}

async function loadAccountSession() {
  try {
    state.account.url = localStorage.getItem("still-sync-url") || "";
  } catch {
    state.account.url = "";
  }
  let session = null;
  try {
    session = await kvGet("sync-session");
  } catch {
    session = null;
  }
  if (!state.account.url) {
    state.account.status = "unconfigured";
    state.account.detail = "Sync is not connected. No account server is set, so tasks stay on this device.";
    return;
  }
  if (session?.token && session.url === state.account.url) {
    state.account.status = "signed-in";
    state.account.email = session.email || "";
    state.account.revision = session.revision || 0;
    state.account.detail = "Signed in. The list syncs after you unlock.";
    return;
  }
  state.account.status = "signed-out";
  state.account.detail = "A server address is saved. You are signed out, so tasks stay on this device.";
}

async function boot() {
  readLaunch();
  hydrateRoom();
  if (state.native) watchNativeLinks(applyNativeUrl);
  applyTheme(localStorage.getItem("still-theme") || "system");
  state.online = navigator.onLine;
  refreshPermission();
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    state.screen = "error";
    state.bootError = "This browser can’t keep an encrypted vault, so Still won’t store tasks here.";
    render();
    return;
  }
  try {
    const record = await readVaultRecord();
    const kind = vaultRecordState(record);
    state.hasVault = kind === "ready";
    state.vaultPartial = kind === "partial";
    state.hasPrevious = await hasPreviousVault();
    state.fails = await readFails();
    await loadAccountSession();
    state.screen = state.vaultPartial ? "partial" : state.hasVault ? "lock" : "setup";
  } catch {
    state.screen = "error";
    state.bootError = "On-device storage is blocked, so Still can’t keep a private vault here.";
  }
  render();
  registerServiceWorker();
  setInterval(refreshRoomPoses, 1000);
}

function refreshRoomPoses() {
  if (state.screen !== "app") return;
  const now = Date.now();
  for (const node of document.querySelectorAll(".walker[data-member]")) {
    if (node.classList.contains("is-walking")) continue;
    const phase = studyPhase(state.room.seatedAt[node.dataset.member], state.lastActivity, now);
    node.classList.toggle("is-snoozing", phase === "snooze");
    node.classList.toggle("is-seated", phase !== "snooze");
  }
}

app.addEventListener("click", onClick);
app.addEventListener("input", onInput);
app.addEventListener("change", onChange);
app.addEventListener("submit", onSubmit);
document.addEventListener("keydown", onKey);
document.addEventListener("pointerdown", () => {
  state.lastActivity = Date.now();
}, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    state.hiddenAt = Date.now();
    return;
  }
  if (state.screen !== "app") return;
  const minutes = state.settings.autoLockMin;
  if (minutes && state.hiddenAt && Date.now() - state.hiddenAt >= minutes * 60 * 1000) {
    lock();
    return;
  }
  if (state.timer.running && state.timer.endsAt <= Date.now()) finishTimer();
  if (!state.sheet) maybeSummary();
  flushDue(notificationHooks);
});
window.addEventListener("online", () => {
  state.online = true;
  if (state.screen === "app") {
    render();
    scheduleSync();
  }
});
window.addEventListener("offline", () => {
  state.online = false;
  if (state.screen === "app") render();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  if (state.screen === "app" && state.view === "settings") render();
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  const preference = state.screen === "app" ? state.settings.theme : localStorage.getItem("still-theme") || "system";
  applyTheme(preference);
});
setInterval(tick, 250);
setInterval(watchLock, 5000);
boot();
