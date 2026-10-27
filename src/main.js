import { checkVerifier, decryptJson, deriveKey } from "./crypto.js";
import { commitVault, readVaultRecord } from "./db.js";
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
import { dayKey, endOfDay, formatClock, fromDatetimeLocal } from "./time.js";
import { parseTask } from "./parse.js";
import {
  backupFromRecord,
  changeSecret,
  createVault,
  eraseVault,
  noteFailedAttempt,
  openVault,
  parseBackup,
  readFails,
  saveVault,
  vaultExists,
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
  focusComposer: false,
  installPrompt: null,
  updateReady: false,
  swError: false,
  online: navigator.onLine,
  standalone: false,
  notificationPermission: "default",
  caps: null,
  background: null,
  changeA: "",
  changeB: "",
  importPin: "",
  importBackup: null,
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
}

function snapshot() {
  return {
    tasks: state.tasks.map((task) => ({
      ...task,
      reminders: { ...task.reminders },
      steps: (task.steps || []).map((step) => ({ ...step })),
    })),
    settings: { ...state.settings },
  };
}

let sealing = false;

function persist() {
  if (sealing || !state.key) return saveChain;
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
  state.standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
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
  if (!speechSupported()) {
    state.voiceError = voiceErrorCopy("unsupported");
    state.sheet = "add";
    state.listening = false;
    render();
    return;
  }
  haltVoice();
  state.listening = true;
  state.voiceError = "";
  state.sheet = "add";
  stopVoice = startListening({
    onText(text) {
      state.composer.text = text;
      state.live = text;
      render();
    },
    onError(code) {
      if (code === "aborted") return;
      state.voiceError = voiceErrorCopy(code);
      state.listening = false;
      render();
    },
    onEnd() {
      state.listening = false;
      if (state.sheet === "add") render();
    },
  });
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
  task.completedAt = Date.now();
  task.deferredUntil = null;
  state.sheet = null;
  state.edit = null;
  try { navigator.vibrate?.(10); } catch { /* optional */ }
  persist();
  celebrate(nextPhrase(), () => {
    const current = findTask(id);
    if (current) current.completedAt = previous;
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
  state.pendingAction = null;
  state.pendingTask = null;
  state.pendingText = "";
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
  return false;
}

async function enterApp(key, data) {
  state.key = key;
  state.tasks = data.tasks;
  state.settings = data.settings;
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
    } else {
      state.error = "The vault couldn’t be opened.";
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
  state.tasks = [];
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
  render();
}

function pauseTimer() {
  if (!state.timer.running) return;
  state.timer.remainingMs = Math.max(0, state.timer.endsAt - Date.now());
  state.timer.running = false;
  render();
}

function resetTimer() {
  state.timer.running = false;
  state.timer.mode = "focus";
  state.timer.taskId = null;
  state.timer.durationMs = state.settings.pomodoroMin * 60 * 1000;
  state.timer.remainingMs = state.timer.durationMs;
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
    state.tasks = state.tasks.filter((task) => task.id !== id);
    state.sheet = null;
    state.edit = null;
    persist();
    showToast("Removed.", () => {
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
    applyTheme(state.settings.theme);
    persist();
    render();
    return;
  }
  if (action === "autolock") {
    state.settings.autoLockMin = Number(button.dataset.value);
    persist();
    render();
    return;
  }
  if (action === "toggle-titles") {
    state.settings.showTitlesInNotifications = !state.settings.showTitlesInNotifications;
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
    persist();
    return;
  }
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

function readLaunch() {
  const params = new URLSearchParams(location.search);
  state.pendingAction = params.get("action");
  state.pendingTask = params.get("task");
  state.pendingText = (params.get("text") || params.get("title") || "").trim();
  if (!state.pendingAction && state.pendingText) state.pendingAction = "add";
  if ([...params.keys()].length) history.replaceState({}, "", location.pathname);
}

function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
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

async function boot() {
  readLaunch();
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
    state.hasVault = await vaultExists();
    state.fails = await readFails();
    state.screen = state.hasVault ? "lock" : "setup";
  } catch {
    state.screen = "error";
    state.bootError = "On-device storage is blocked, so Still can’t keep a private vault here.";
  }
  render();
  registerServiceWorker();
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
  if (state.screen === "app") render();
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
