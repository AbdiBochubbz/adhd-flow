import { chibiFigure } from "./chibi.js";
import { daypart } from "./daypart.js";
import { studyActivity } from "./study.js";
import { draftFrom, previewCopy } from "./draft.js";
import { h, icon, svg } from "./dom.js";
import { presenceTarget } from "./presence.js";
import { CHIBIS, SEAT_COUNT } from "./room.js";
import { SUBJECTS, firstOpenStep, groupTasks, nextTask, urgencyOf } from "./model.js";
import { REMINDER_LABELS, slotsForTask } from "./reminders.js";
import { formatClock, formatDistance, formatDue, formatShortDay, formatTime, toDatetimeLocal } from "./time.js";
import { speechSupported } from "./voice.js";

const GROUP_COPY = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  later: "Later",
};

function reminderRows(reminders, dueAt, action, now) {
  const slots = slotsForTask({ dueAt, reminders });
  return ["dayBefore", "hourBefore", "atDue"].map((kind) => {
    const slot = slots.find((item) => item.kind === kind);
    let detail = "Off";
    if (reminders[kind] && slot) {
      detail = slot.at <= now ? "That time has already passed" : `${formatShortDay(slot.at)}, ${formatTime(slot.at)}`;
      if (slot.shifted) detail += " · moved out of the night";
    }
    return h(
      "button",
      {
        class: "toggle-row",
        "aria-pressed": reminders[kind] ? "true" : "false",
        dataset: { action, kind },
      },
      h("span", {}, h("strong", {}, REMINDER_LABELS[kind]), h("small", {}, detail)),
      h("span", { class: "switch", "aria-hidden": "true" }),
    );
  });
}

function subjectChips(selected, action) {
  return h(
    "div",
    { class: "chips", role: "group", "aria-label": "Subject" },
    SUBJECTS.map((subject) =>
      h(
        "button",
        {
          class: selected === subject ? "chip is-on" : "chip",
          "aria-pressed": selected === subject ? "true" : "false",
          dataset: { action, subject },
        },
        subject,
      ),
    ),
  );
}

function sheetFrame(title, body, labelledBy = "sheet-title") {
  return [
    h("button", { class: "sheet-back", "aria-label": "Close", dataset: { action: "close-sheet" } }),
    h(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": labelledBy },
      h("div", { class: "sheet-handle", "aria-hidden": "true" }),
      h(
        "div",
        { class: "sheet-head" },
        h("h2", { id: labelledBy }, title),
        h("button", { class: "icon-btn", "aria-label": "Close", dataset: { action: "close-sheet" } }, icon("close")),
      ),
      body,
    ),
  ];
}

function addSheet(state, now) {
  const draft = draftFrom(state.composer, now);
  const urgency = urgencyOf(draft.dueAt, now);
  return sheetFrame(
    "Add a task",
    h(
      "form",
      { id: "add-form" },
      h(
        "div",
        { class: "composer-wrap" },
        h("label", { class: "sr-only", for: "composer-text" }, "Task"),
        h("textarea", {
          id: "composer-text",
          class: "composer",
          rows: "2",
          placeholder: "Math homework due Friday at 5pm",
          value: state.composer.text,
        }),
        h(
          "button",
          {
            class: state.listening ? "mic-in is-listening" : "mic-in",
            "aria-label": state.listening ? "Stop listening" : "Speak a task",
            "aria-pressed": state.listening ? "true" : "false",
            dataset: { action: "voice" },
          },
          icon("mic"),
        ),
      ),
      state.voiceError ? h("p", { class: "voice-error" }, state.voiceError) : null,
      h(
        "p",
        { class: "fine" },
        state.native
          ? "Voice uses this phone’s speech recognizer. It may send the phrase to that service. Still keeps only the text, on this phone."
          : "Voice uses your browser’s speech service. In Chrome, that may send this phrase to Google. Still keeps only the text, on this phone.",
      ),
      h(
        "div",
        { class: "preview", "data-urgency": urgency, "data-preview": "true" },
        h("p", {}, previewCopy(draft)),
        draft.empty
          ? null
          : h("p", { class: "saved-as" }, `Saved as “${draft.title}”.`),
      ),
      state.composer.dueOverride != null
        ? h("button", { class: "btn-quiet", dataset: { action: "clear-due" } }, "Use the time from the sentence")
        : null,
      h(
        "div",
        { class: "chips" },
        ["today", "tomorrow", "week"].map((kind) =>
          h(
            "button",
            { class: "chip", dataset: { action: "quick-due", kind } },
            kind === "week" ? "Next week" : kind[0].toUpperCase() + kind.slice(1),
          ),
        ),
      ),
      h("label", { class: "field-label", for: "due-input" }, "Due"),
      h("input", {
        id: "due-input",
        class: "field",
        type: "datetime-local",
        value: toDatetimeLocal(draft.dueAt),
      }),
      h("p", { class: "field-label" }, "Reminders"),
      draft.allDay
        ? h("p", { class: "fine" }, "No clock time, so the late reminders stay off until you turn them on.")
        : null,
      reminderRows(draft.reminders, draft.dueAt, "composer-reminder", now.getTime()),
      h("p", { class: "field-label" }, "Subject"),
      subjectChips(draft.subject, "composer-subject"),
      state.error ? h("p", { class: "error" }, state.error) : null,
      h(
        "div",
        { class: "stack" },
        h("button", { class: "btn-primary", type: "submit" }, "Add task"),
      ),
    ),
  );
}

function taskSheet(state, now) {
  const task = state.edit;
  if (!task) return null;
  const urgency = urgencyOf(task.dueAt, now);
  return sheetFrame(
    "Task",
    h(
      "div",
      {},
      h("label", { class: "sr-only", for: "edit-title" }, "Title"),
      h("input", { id: "edit-title", class: "field", value: task.title, maxlength: "200" }),
      h(
        "p",
        { class: "help" },
        h("span", { class: `dot ${urgency}`, "aria-hidden": "true" }),
        " ",
        formatDue(task.dueAt, now),
        " · ",
        formatDistance(task.dueAt, now.getTime()),
      ),
      h("label", { class: "field-label", for: "edit-due" }, "Due"),
      h("input", {
        id: "edit-due",
        class: "field",
        type: "datetime-local",
        value: toDatetimeLocal(task.dueAt),
      }),
      task.deferredUntil && task.deferredUntil > now.getTime()
        ? h(
            "button",
            { class: "btn-quiet", dataset: { action: "undefer" } },
            `Hidden until ${formatTime(task.deferredUntil)}. Bring it back`,
          )
        : null,
      h("p", { class: "field-label" }, "Steps"),
      task.steps.map((step) =>
        h(
          "div",
          { class: "step-row" },
          h(
            "button",
            {
              class: "step-toggle",
              role: "checkbox",
              "aria-checked": step.done ? "true" : "false",
              "aria-label": step.done ? `Mark “${step.title}” not done` : `Mark “${step.title}” done`,
              dataset: { action: "toggle-step", id: step.id },
            },
            step.done ? icon("check") : null,
          ),
          h("input", {
            class: "field",
            value: step.title,
            maxlength: "160",
            "aria-label": "Step",
            dataset: { stepTitle: step.id },
          }),
          h(
            "button",
            { class: "icon-tiny", "aria-label": `Remove step ${step.title}`, dataset: { action: "remove-step", id: step.id } },
            icon("close"),
          ),
        ),
      ),
      h(
        "div",
        { class: "step-row" },
        h("span", {}),
        h("input", {
          id: "new-step",
          class: "field",
          placeholder: "Add a small step",
          value: task.newStep || "",
          maxlength: "160",
        }),
        h("button", { class: "icon-tiny", "aria-label": "Add step", dataset: { action: "add-step" } }, icon("plus")),
      ),
      h("p", { class: "field-label" }, "Reminders"),
      reminderRows(task.reminders, task.dueAt, "edit-reminder", now.getTime()),
      h("p", { class: "field-label" }, "Subject"),
      subjectChips(task.subject, "edit-subject"),
      h("label", { class: "field-label", for: "edit-notes" }, "Notes"),
      h("textarea", { id: "edit-notes", class: "field", rows: "3", maxlength: "2000", value: task.notes || "" }),
      h(
        "div",
        { class: "stack" },
        task.completedAt
          ? h("button", { class: "btn-ghost", dataset: { action: "reopen", id: task.id } }, "Mark not done")
          : h("button", { class: "btn-primary", dataset: { action: "complete", id: task.id } }, "Mark done"),
        task.confirmDelete
          ? h(
              "div",
              { class: "stack" },
              h("p", { class: "help" }, "Remove this task from the phone?"),
              h("button", { class: "btn-danger", dataset: { action: "delete-task", id: task.id } }, "Remove it"),
              h("button", { class: "btn-quiet", dataset: { action: "cancel-delete" } }, "Keep it"),
            )
          : h("button", { class: "btn-danger", dataset: { action: "ask-delete" } }, "Remove task"),
      ),
    ),
  );
}

function summarySheet(state, now) {
  const overdue = state.tasks.filter((task) => !task.completedAt && task.dueAt < now.getTime()).length;
  const today = state.tasks.filter((task) => !task.completedAt && urgencyOf(task.dueAt, now) === "today").length;
  const bits = [];
  if (overdue) bits.push(`${overdue} overdue`);
  if (today) bits.push(`${today} due today`);
  const items = state.tasks
    .filter((task) => !task.completedAt && task.dueAt <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0).getTime())
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, 6);
  return sheetFrame(
    "Good morning",
    h(
      "div",
      {},
      h("p", { class: "help" }, bits.length ? `You have ${bits.join(" and ")}.` : "Here is what is waiting."),
      h(
        "ol",
        { class: "summary-list" },
        items.map((task) =>
          h("li", {}, h("strong", {}, task.title), h("span", {}, formatDue(task.dueAt, now))),
        ),
      ),
      h(
        "div",
        { class: "stack" },
        h("button", { class: "btn-primary", dataset: { action: "summary-start" } }, "Start with the first one"),
        h("button", { class: "btn-quiet", dataset: { action: "close-sheet" } }, "I’ll look later"),
      ),
    ),
  );
}

function notifySheet(state) {
  const permission = state.notificationPermission;
  return sheetFrame(
    "Reminders",
    h(
      "div",
      { class: "prose" },
      h("p", {}, "Reminders work while Still is open. Some browsers can also ring at the exact time when the app is closed. Many can’t."),
      h("p", {}, "If the phone has fully closed Still, open it in the morning. Anything you missed will be waiting, and you’ll get today’s list."),
      h("p", {}, "Nothing about your tasks is sent to a reminder server, because there isn’t one."),
      permission === "denied"
        ? h("p", {}, "Notifications are blocked. In Chrome: site settings → Notifications → Allow. On the installed app: long-press the icon → App info → Notifications.")
        : null,
      h(
        "div",
        { class: "stack" },
        permission === "granted"
          ? h("button", { class: "btn-primary", dataset: { action: "close-sheet" } }, "They’re on")
          : permission === "unsupported"
            ? h("button", { class: "btn-primary", dataset: { action: "close-sheet" } }, "OK")
            : h("button", { class: "btn-primary", dataset: { action: "allow-notifications" } }, "Allow notifications"),
        permission === "granted" ? null : h("button", { class: "btn-quiet", dataset: { action: "close-sheet" } }, "I’ll open it myself"),
      ),
    ),
  );
}

function eraseSheet(forgot) {
  return sheetFrame(
    forgot ? "Forget the PIN?" : "Erase the vault?",
    h(
      "div",
      {},
      h(
        "p",
        { class: "help" },
        forgot
          ? "Erasing deletes the tasks on this phone. A backup file can restore them if you still know that PIN."
          : "This deletes the tasks on this phone. It cannot be undone.",
      ),
      h(
        "div",
        { class: "stack" },
        h("button", { class: "btn-danger", dataset: { action: "confirm-erase" } }, "Erase everything"),
        h("button", { class: "btn-ghost", dataset: { action: "close-sheet" } }, "Keep them"),
      ),
    ),
  );
}

function changePinSheet(state) {
  return sheetFrame(
    "Change PIN",
    h(
      "form",
      { id: "change-pin-form" },
      h("label", { class: "field-label", for: "new-pin" }, "New PIN or passphrase"),
      h("input", {
        id: "new-pin",
        class: "field",
        type: "password",
        autocomplete: "new-password",
        minlength: "4",
        maxlength: "128",
        value: state.changeA || "",
      }),
      h("label", { class: "field-label", for: "new-pin-2" }, "Repeat it"),
      h("input", {
        id: "new-pin-2",
        class: "field",
        type: "password",
        autocomplete: "new-password",
        minlength: "4",
        maxlength: "128",
        value: state.changeB || "",
      }),
      h("p", { class: "fine" }, "At least 4 characters. Still does not keep a copy of it."),
      state.error ? h("p", { class: "error" }, state.error) : null,
      h("div", { class: "stack" }, h("button", { class: "btn-primary", type: "submit" }, "Update PIN")),
    ),
  );
}

function importSheet(state) {
  return sheetFrame(
    "Open backup",
    h(
      "form",
      { id: "import-form" },
      h("p", { class: "help" }, "Enter the PIN that was in use when this backup was saved. It replaces the list on this phone."),
      h("label", { class: "sr-only", for: "import-pin" }, "Backup PIN"),
      h("input", {
        id: "import-pin",
        class: "field",
        type: "password",
        autocomplete: "current-password",
        minlength: "4",
        maxlength: "128",
        value: state.importPin || "",
      }),
      state.error ? h("p", { class: "error" }, state.error) : null,
      h("div", { class: "stack" }, h("button", { class: "btn-primary", type: "submit" }, "Restore")),
    ),
  );
}

function plaintextSheet() {
  return sheetFrame(
    "Readable copy",
    h(
      "div",
      {},
      h("p", { class: "help" }, "This file is not encrypted. Anyone who opens it can read your tasks."),
      h(
        "div",
        { class: "stack" },
        h("button", { class: "btn-primary", dataset: { action: "confirm-plaintext" } }, "Download it"),
        h("button", { class: "btn-quiet", dataset: { action: "close-sheet" } }, "Cancel"),
      ),
    ),
  );
}

function focusView(state, now) {
  const focus = nextTask(state.tasks, now.getTime());
  const done = state.tasks.filter((task) => task.completedAt).length;
  if (!focus) {
    const clear = done > 0 && state.tasks.every((task) => task.completedAt || (task.deferredUntil && task.deferredUntil > now.getTime()));
    return h(
      "section",
      { class: "empty" },
      h("p", { class: "view-kicker" }, "Do this next"),
      h("h2", {}, clear ? "You’re clear." : "Nothing is waiting."),
      h(
        "p",
        {},
        clear
          ? "Everything on the list is done. That can include resting."
          : "When a task shows up, it will stand here on its own — not a pile.",
      ),
    );
  }
  const step = firstOpenStep(focus);
  const urgency = urgencyOf(focus.dueAt, now);
  const hoursLeft = (focus.dueAt - now.getTime()) / 3_600_000;
  let nudge = "";
  if (urgency === "overdue") nudge = "This one slipped. A small piece still counts.";
  else if (hoursLeft < 2) nudge = "Due soon. The smallest step is enough.";
  const rest = state.tasks.filter(
    (task) => task.id !== focus.id && !task.completedAt && !(task.deferredUntil && task.deferredUntil > now.getTime()),
  );
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0, 0).getTime();
  const moreToday = rest.filter((task) => task.dueAt <= endToday).length;
  const hidden = state.tasks.filter((task) => !task.completedAt && task.deferredUntil && task.deferredUntil > now.getTime()).length;
  return h(
    "section",
    {},
    h("p", { class: "view-kicker" }, "Do this next"),
    h(
      "article",
      { class: "card", "data-urgency": urgency },
      h(
        "p",
        { class: "eyebrow" },
        focus.subject ? h("strong", {}, focus.subject) : null,
        h("span", {}, formatDistance(focus.dueAt, now.getTime())),
      ),
      step ? h("p", { class: "start-label" }, "Start here") : null,
      h("h2", {}, step ? step.title : focus.title),
      step ? h("p", { class: "context" }, focus.title) : null,
      nudge ? h("p", { class: "nudge" }, nudge) : null,
      h(
        "div",
        { class: "stack" },
        step
          ? h("button", { class: "btn-primary", dataset: { action: "complete-step", id: focus.id, step: step.id } }, "Done with this step")
          : h("button", { class: "btn-primary", dataset: { action: "complete", id: focus.id } }, "Mark done"),
        h(
          "div",
          { class: "row-actions" },
          h("button", { class: "btn-ghost", dataset: { action: "defer", id: focus.id } }, "Not now"),
          h("button", { class: "btn-ghost", dataset: { action: "open-task", id: focus.id } }, step ? "Steps" : "Break it down"),
        ),
        h(
          "button",
          { class: "btn-quiet", dataset: { action: "start-timer", id: focus.id } },
          `Start ${state.settings.pomodoroMin} minutes`,
        ),
      ),
    ),
    moreToday || rest.length || hidden
      ? h(
          "p",
          { class: "more-line" },
          moreToday
            ? h("button", { dataset: { action: "go-tasks" } }, `${moreToday} more today`)
            : rest.length
              ? h("button", { dataset: { action: "go-tasks" } }, `${rest.length} more waiting`)
              : null,
          hidden ? h("span", {}, `${hidden} hidden for now`) : null,
        )
      : null,
  );
}

function taskRow(task, now, { done = false } = {}) {
  const urgency = done ? "later" : urgencyOf(task.dueAt, now);
  const steps = task.steps || [];
  const finished = steps.filter((step) => step.done).length;
  const bits = [formatDue(task.dueAt, now)];
  if (task.subject) bits.unshift(task.subject);
  if (steps.length) bits.push(`${finished}/${steps.length}`);
  if (!done && task.deferredUntil && task.deferredUntil > now.getTime()) bits.push(`hidden until ${formatTime(task.deferredUntil)}`);
  return h(
    "div",
    { class: "task-row" },
    h(
      "button",
      {
        class: done ? "check-btn is-done" : "check-btn",
        "aria-label": done ? `Mark “${task.title}” not done` : `Mark “${task.title}” done`,
        dataset: { action: done ? "reopen" : "complete", id: task.id },
      },
      icon("check"),
    ),
    h(
      "button",
      { class: "task-open", dataset: { action: "open-task", id: task.id } },
      h("span", { class: `dot ${urgency}`, "aria-hidden": "true" }),
      h("span", { class: "task-copy" }, h("span", { class: "task-name" }, task.title), h("span", { class: "task-meta" }, bits.join(" · "))),
    ),
  );
}

function tasksView(state, now) {
  const groups = groupTasks(state.tasks, now);
  const open = ["overdue", "today", "tomorrow", "later"].some((key) => groups[key].length);
  if (!state.tasks.length) {
    return h(
      "section",
      { class: "empty" },
      h("h2", {}, "No tasks yet."),
      h("p", {}, "The big circle adds one. You can type a time in the same sentence."),
    );
  }
  return h(
    "section",
    {},
    ["overdue", "today", "tomorrow", "later"].map((key) =>
      groups[key].length
        ? h(
            "div",
            { class: "section", "data-urgency": key },
            h("h2", { class: "section-label" }, GROUP_COPY[key]),
            groups[key].map((task) => taskRow(task, now)),
          )
        : null,
    ),
    !open ? h("p", { class: "help" }, "Nothing open. The done ones are just below.") : null,
    groups.done.length
      ? h(
          "div",
          {},
          h(
            "button",
            { class: "done-toggle", "aria-expanded": state.showDone ? "true" : "false", dataset: { action: "toggle-done" } },
            state.showDone ? `Hide ${groups.done.length} done` : `Done · ${groups.done.length}`,
          ),
          state.showDone ? groups.done.map((task) => taskRow(task, now, { done: true })) : null,
        )
      : null,
  );
}

function timerView(state, now) {
  const total = state.timer.durationMs || 1;
  const left = state.timer.running ? Math.max(0, state.timer.endsAt - now.getTime()) : state.timer.remainingMs;
  const c = 2 * Math.PI * 86;
  const offset = c * (1 - Math.min(1, Math.max(0, left / total)));
  const task = state.tasks.find((item) => item.id === state.timer.taskId);
  const modeLabel = state.timer.mode === "break" ? "Break" : "Focus";
  return h(
    "section",
    { class: "timer-wrap" },
    h("p", { class: "view-kicker" }, modeLabel),
    h(
      "div",
      { class: "ring-wrap" },
      svg(
        "svg",
        { class: "ring", viewBox: "0 0 200 200", width: "200", height: "200", "aria-hidden": "true" },
        svg("circle", { class: "ring-track", cx: "100", cy: "100", r: "86" }),
        svg("circle", {
          class: "ring-value",
          cx: "100",
          cy: "100",
          r: "86",
          "data-timer-ring": "true",
          "stroke-dasharray": String(c),
          "stroke-dashoffset": String(offset),
          transform: "rotate(-90 100 100)",
        }),
      ),
      h("p", { class: "timer-readout", "data-timer-readout": "true" }, formatClock(left)),
    ),
    h(
      "div",
      { class: "timer-copy" },
      h("h2", {}, state.timer.running ? (state.timer.mode === "break" ? "Rest a minute." : "One thing.") : "Ready when you are."),
      task ? h("p", {}, task.title) : h("p", {}, "A short block, then you can stop."),
    ),
    h(
      "div",
      { class: "stack", style: false },
      h(
        "button",
        { class: "btn-primary", dataset: { action: state.timer.running ? "pause-timer" : "resume-timer" } },
        state.timer.running ? "Pause" : left === total || left === 0 ? "Start" : "Resume",
      ),
      h("button", { class: "btn-quiet", dataset: { action: "reset-timer" } }, "Reset"),
    ),
    h("p", { class: "field-label" }, "Focus length"),
    h(
      "div",
      { class: "segment", role: "group", "aria-label": "Focus length" },
      [15, 25, 50].map((minutes) =>
        h(
          "button",
          {
            class: state.settings.pomodoroMin === minutes ? "is-on" : "",
            "aria-pressed": state.settings.pomodoroMin === minutes ? "true" : "false",
            dataset: { action: "pomodoro", value: String(minutes) },
          },
          `${minutes} min`,
        ),
      ),
    ),
    h("p", { class: "field-label" }, "Break"),
    h(
      "div",
      { class: "segment", role: "group", "aria-label": "Break length" },
      [5, 10].map((minutes) =>
        h(
          "button",
          {
            class: state.settings.breakMin === minutes ? "is-on" : "",
            "aria-pressed": state.settings.breakMin === minutes ? "true" : "false",
            dataset: { action: "break-length", value: String(minutes) },
          },
          `${minutes} min`,
        ),
      ),
    ),
  );
}

function segment(label, action, current, options) {
  return h(
    "div",
    {},
    h("p", { class: "field-label" }, label),
    h(
      "div",
      { class: "segment", role: "group", "aria-label": label },
      options.map(([value, text]) =>
        h(
          "button",
          {
            class: current === value ? "is-on" : "",
            "aria-pressed": current === value ? "true" : "false",
            dataset: { action, value: String(value) },
          },
          text,
        ),
      ),
    ),
  );
}

function accountBlock(state) {
  const account = state.account || {};
  const signedIn = account.status === "signed-in";
  return h(
    "div",
    { class: "settings-block" },
    h("h2", {}, "Account"),
    h("p", { class: "help" }, account.detail || "Sign in with a confirmed email to sync. Nothing is uploaded before that."),
    !signedIn && !account.hold
      ? h(
          "div",
          { class: "stack" },
          h("label", { class: "field-label", for: "account-email" }, "Email"),
          h("input", {
            id: "account-email",
            class: "field",
            type: "email",
            autocomplete: "username",
            value: account.emailDraft || "",
            placeholder: "you@example.com",
          }),
          h("label", { class: "field-label", for: "account-password" }, "Password"),
          h("input", {
            id: "account-password",
            class: "field",
            type: "password",
            autocomplete: "current-password",
            value: account.passwordDraft || "",
          }),
          h(
            "button",
            { class: "btn-primary", dataset: { action: "account-login" }, disabled: account.busy },
            account.busy ? "Checking…" : "Sign in",
          ),
          h(
            "button",
            { class: "btn-ghost", dataset: { action: "account-register" }, disabled: account.busy },
            "Create account",
          ),
          h("p", { class: "fine" }, "Creating an account sends a confirmation email. The list is not uploaded until that email is confirmed. The password is for the account, not a device PIN."),
        )
      : null,
    signedIn
      ? h(
          "div",
          { class: "stack" },
          h("p", {}, account.email ? `Signed in as ${account.email}.` : "Signed in."),
          h("button", { class: "btn-quiet", dataset: { action: "account-logout" } }, "Sign out"),
          h("p", { class: "fine" }, "Signing out leaves the list on this device. It does not erase it."),
        )
      : null,
    account.hold
      ? h(
          "div",
          { class: "stack" },
          h("button", { class: "btn-primary", dataset: { action: "account-keep" } }, "Keep this device’s list"),
          h("button", { class: "btn-ghost", dataset: { action: "account-merge" } }, "Merge both lists"),
          h("button", { class: "btn-quiet", dataset: { action: "account-use-remote" } }, "Use the account list"),
        )
      : null,
  );
}

function settingsView(state) {
  const caps = state.caps || {};
  const permission = state.notificationPermission;
  const standalone = state.standalone;
  return h(
    "section",
    {},
    state.updateReady
      ? h(
          "div",
          { class: "update-banner" },
          h("p", {}, "An update is ready. Still will reload this page."),
          h("button", { class: "btn-ghost", dataset: { action: "apply-update" } }, "Update"),
        )
      : null,
    h(
      "div",
      { class: "settings-block" },
      h("h2", {}, "Look"),
      segment("Theme", "theme", state.settings.theme, [
        ["dark", "Dark"],
        ["light", "Light"],
        ["system", "Match phone"],
      ]),
      h("p", { class: "fine" }, "Still stays open. There is no PIN lock."),
    ),
    h(
      "div",
      { class: "settings-block" },
      h("h2", {}, "Morning list"),
      h("label", { class: "field-label", for: "morning-hour" }, "Show it after"),
      h(
        "select",
        { id: "morning-hour", class: "field" },
        [5, 6, 7, 8, 9, 10, 11].map((hour) =>
          h("option", { value: String(hour), selected: state.settings.morningHour === hour }, `${hour}:00`),
        ),
      ),
      h("p", { class: "fine" }, "The list appears when you open Still between that hour and noon, once a day."),
    ),
    h(
      "div",
      { class: "settings-block prose" },
      h("h2", {}, "Reminders"),
      h("p", {}, permissionLabel(permission)),
      permission === "granted"
        ? null
        : h("button", { class: "btn-ghost", dataset: { action: "allow-notifications" } }, "Allow notifications"),
      h(
        "button",
        {
          class: "toggle-row",
          "aria-pressed": state.settings.showTitlesInNotifications ? "true" : "false",
          dataset: { action: "toggle-titles" },
        },
        h(
          "span",
          {},
          h("strong", {}, "Show task names"),
          h(
            "small",
            {},
            state.native
              ? "Names then appear on the lock screen and the home-screen widget, outside the encrypted vault."
              : "Names then appear on the lock screen, outside the encrypted vault.",
          ),
        ),
        h("span", { class: "switch", "aria-hidden": "true" }),
      ),
      state.native
        ? h("p", {}, "This Android app asks for notifications the first time you save a task, then sets an alarm. They can ring when Still is closed if notifications are allowed. On Android 12 and newer, also allow Alarms & reminders. Some phones (Xiaomi, Oppo, Vivo, Huawei, and sometimes Samsung) still delay alarms until Still is set to Unrestricted battery and allowed to autostart.")
        : h("p", {}, "While Still is open, it checks the list and can notify you. That part is reliable."),
      state.native
        ? null
        : h(
            "p",
            {},
            caps.timestampTrigger
              ? "This browser offers scheduled notifications, so Still asks it to ring at the exact time even if you leave the app."
              : "This browser cannot schedule an exact alarm for a closed site. A reminder waits until you open Still.",
          ),
      state.native
        ? null
        : h(
            "p",
            {},
            caps.periodicSync
              ? "Periodic background sync exists here. Chrome still decides when it runs — often every 12 hours or less, and only for an installed app you actually use. It is not an alarm clock."
              : "Periodic background sync isn’t available. Still can’t ask the phone to wake a closed site on a timer.",
          ),
      state.native
        ? h("p", {}, "The home-screen widget can add a task. It shows the task name only when Show task names is on.")
        : h("p", {}, "A static app has no push server. Android will not reliably wake a website that is fully closed. The dependable habit is to open Still in the morning."),
      state.background?.periodic ? h("p", { class: "fine" }, "Background check: registered.") : null,
      state.swError ? h("p", { class: "fine" }, "The offline worker didn’t start. The list still saves on this phone.") : null,
    ),
    h(
      "div",
      { class: "settings-block" },
      h("h2", {}, "On this phone"),
      standalone
        ? h("p", { class: "help" }, "Still is installed.")
        : h(
            "div",
            { class: "install-note" },
            h("p", {}, "Install it from Chrome: menu → Add to Home screen. Or the button below, if the browser offers it."),
            h("p", { class: "fine" }, "Long-press the icon for Add task and Speak task. A real Android widget needs a native app — see the README."),
            state.installPrompt
              ? h("button", { class: "btn-ghost", dataset: { action: "install" } }, "Add to Home screen")
              : null,
          ),
    ),
    accountBlock(state),
    h(
      "div",
      { class: "settings-block" },
      h("h2", {}, "Vault"),
      h(
        "div",
        { class: "stack" },
        h("button", { class: "btn-ghost", dataset: { action: "export" } }, "Download encrypted backup"),
        h("button", { class: "btn-ghost", dataset: { action: "import" } }, "Restore a backup"),
        h("button", { class: "btn-ghost", dataset: { action: "plaintext" } }, "Download a readable copy"),
        state.legacyWaiting
          ? h("button", { class: "btn-ghost", dataset: { action: "migrate-retry" } }, "Open the older encrypted list")
          : null,
        state.hasPrevious
          ? h("button", { class: "btn-ghost", dataset: { action: "restore-previous" } }, "Restore the copy from before the last import")
          : null,
        h("button", { class: "btn-danger", dataset: { action: "erase" } }, "Erase everything"),
      ),
      h("input", { id: "import-file", class: "sr-only", type: "file", accept: "application/json,.json" }),
      h(
        "div",
        { class: "prose" },
        h("h2", {}, "Privacy"),
        h("p", {}, "The current list is stored on this device without a PIN. Someone who can copy this device’s storage can read it. An older list, if one is still here, stays encrypted and cannot be opened without its PIN."),
        h("p", {}, "An account password, if you add a server later, is separate. Email alone does not open the list, and this install is not connected to a hosted email service."),
      ),
    ),
  );
}

function permissionLabel(permission) {
  if (permission === "granted") return "Notifications are allowed.";
  if (permission === "denied") return "Notifications are blocked in the browser settings.";
  if (permission === "unsupported") return "This browser doesn’t offer notifications. The morning list still works when you open Still.";
  return "Notifications are off until you allow them.";
}

function pinPad(state) {
  const waiting = state.fails?.until > Date.now();
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];
  return h(
    "div",
    { class: "pin-block" },
    h(
      "div",
      {
        class: state.shake ? "pin-dots shake" : "pin-dots",
        "aria-label": `${state.pinBuffer.length} digits entered`,
      },
      Array.from({ length: Math.min(12, Math.max(4, state.pinBuffer.length)) }, (_, index) =>
        h("span", { class: index < state.pinBuffer.length ? "pin-dot is-on" : "pin-dot" }),
      ),
    ),
    h(
      "div",
      { class: "pin-pad", role: "group", "aria-label": "PIN" },
      keys.map((key) => {
        if (!key) return h("span", {});
        if (key === "back") {
          return h(
            "button",
            { class: "pin-key", "aria-label": "Delete digit", disabled: waiting || state.cryptoBusy, dataset: { action: "pin-back" } },
            "⌫",
          );
        }
        return h(
          "button",
          { class: "pin-key", disabled: waiting || state.cryptoBusy, dataset: { action: "digit", key } },
          key,
        );
      }),
    ),
    waiting ? h("p", { class: "error", "data-wait": "true" }, "Try again in a moment.") : null,
    state.weakPin && state.screen === "setup" && state.setupStep === "create"
      ? h("p", { class: "warn" }, "That PIN is easy to guess. You can keep it, or pick another.")
      : null,
    state.error ? h("p", { class: "error" }, state.error) : null,
    h(
      "div",
      { class: "stack" },
      h(
        "button",
        {
          class: "btn-primary",
          disabled: waiting || state.cryptoBusy || state.pinBuffer.length < 4,
          dataset: { action: "pin-submit" },
        },
              state.cryptoBusy ? "Checking the PIN…" : "Keep those tasks",
      ),
    ),
  );
}

function migrateScreen(state) {
  const returning = state.migrateFromSettings;
  return h(
    "section",
    { class: "gate" },
    h("h1", {}, "Still"),
    h(
      "p",
      { class: "lede" },
      state.vaultPartial
        ? "Part of an older encrypted list is on this device. It cannot be read, and it was not deleted."
        : "An older encrypted list is on this device. Its PIN is needed once. Without that PIN, those tasks cannot be read.",
    ),
    state.vaultPartial
      ? null
      : h("p", { class: "help" }, "A wrong PIN leaves the encrypted copy where it is. Still will not erase it."),
    state.vaultPartial
      ? h("button", { class: "btn-ghost", dataset: { action: "export-partial" } }, "Download the encrypted record")
      : state.passphraseMode
      ? h(
          "form",
          { id: "pass-form" },
          h("label", { class: "sr-only", for: "passphrase" }, "Passphrase"),
          h("input", {
            id: "passphrase",
            class: "field",
            type: "password",
            autocomplete: "current-password",
            minlength: "4",
            maxlength: "128",
            value: state.passphrase,
          }),
          state.error ? h("p", { class: "error" }, state.error) : null,
          h(
            "div",
            { class: "stack" },
            h(
              "button",
              { class: "btn-primary", type: "submit", disabled: state.cryptoBusy },
              state.cryptoBusy ? "Checking the PIN…" : "Keep those tasks",
            ),
          ),
        )
      : pinPad(state),
    state.vaultPartial
      ? null
      : h(
          "button",
          { class: "btn-quiet", dataset: { action: "toggle-passphrase" } },
          state.passphraseMode ? "Use a PIN pad" : "Use an old passphrase",
        ),
    h(
      "button",
      { class: "btn-quiet", dataset: { action: "migrate-skip" } },
      returning ? "Back to the current list" : "Continue with an empty list",
    ),
    h(
      "p",
      { class: "fine" },
      returning
        ? "Going back does not delete the encrypted copy."
        : "An empty list does not delete the encrypted copy. You can try the PIN later from Settings.",
    ),
  );
}

function currentSheet(state, now) {
  if (state.sheet === "add") return addSheet(state, now);
  if (state.sheet === "task") return taskSheet(state, now);
  if (state.sheet === "summary") return summarySheet(state, now);
  if (state.sheet === "notify") return notifySheet(state);
  if (state.sheet === "erase") return eraseSheet(state.eraseForgot);
  if (state.sheet === "change-pin") return changePinSheet(state);
  if (state.sheet === "import") return importSheet(state);
  if (state.sheet === "plaintext") return plaintextSheet();
  return null;
}

function activityProp(kind) {
  if (kind === "laptop") {
    return h(
      "span",
      { class: "prop prop-laptop", "aria-hidden": "true" },
      h("span", { class: "laptop-lid" }),
      h("span", { class: "laptop-base" }),
    );
  }
  if (kind === "phone") {
    return h("span", { class: "prop prop-phone", "aria-hidden": "true" });
  }
  if (kind === "books") {
    return h(
      "span",
      { class: "prop prop-books", "aria-hidden": "true" },
      h("span", {}),
      h("span", {}),
      h("span", { class: "page" }),
    );
  }
  return h(
    "span",
    { class: "prop prop-notebook", "aria-hidden": "true" },
    h("span", { class: "page" }),
    h("span", { class: "pen" }),
  );
}

function windowBank(curtain) {
  return h(
    "span",
    { class: curtain ? "window has-curtain" : "window" },
    h("span", { class: "panes" }, h("i"), h("i"), h("i"), h("i"), h("i"), h("i")),
  );
}

function hallway(room) {
  const floor = room.floor === "3" ? "3" : "1";
  const doors = room.rooms.length
    ? room.rooms.map((item) => ({ code: item.code, label: item.name, count: item.count, join: true }))
    : [{ code: "", label: "New", count: 0, join: false }];
  return h(
    "div",
    { class: "hallway", "data-floor": floor },
    h(
      "div",
      { class: "hall-ceiling", "aria-hidden": "true" },
      h("span", { class: "tube" }),
      h("span", { class: "tube" }),
      h("span", { class: "tube" }),
    ),
    h("p", { class: "hall-marker", "aria-hidden": "true" }, floor === "3" ? "3F" : "1F"),
    h("div", { class: "hall-wainscot", "aria-hidden": "true" }),
    h(
      "div",
      { class: "hall-windows", "aria-hidden": "true" },
      h("span"),
      h("span"),
      h("span"),
      h("span"),
    ),
    h(
      "div",
      { class: "hall-doors" },
      doors.map((door, index) =>
        h(
          "button",
          {
            class: "hall-door",
            dataset: door.join ? { action: "room-join", code: door.code } : { action: "room-mode", value: "create" },
            "aria-label": door.join ? `Enter ${door.label}` : "Create a classroom",
          },
          h("span", { class: "door-transom", "aria-hidden": "true" }),
          h("span", { class: "door-plaque", "aria-hidden": "true" }, `${floor}-${index + 1}`),
          h(
            "span",
            { class: "door-leaf" },
            h("span", { class: "door-pane", "aria-hidden": "true" }),
            h("span", { class: "door-pane pane-right", "aria-hidden": "true" }),
            h("span", { class: "door-label" }, door.label),
            h("span", { class: "door-count" }, door.join ? `${door.count} inside` : "Open"),
          ),
        ),
      ),
    ),
    h(
      "div",
      { class: "hall-lockers", "aria-hidden": "true" },
      Array.from({ length: 16 }, () => h("span")),
    ),
    h(
      "div",
      { class: "hall-floor", "aria-hidden": "true" },
      h("span", { class: "hall-line" }),
      h("span", { class: "hall-gloss" }),
    ),
    h(
      "div",
      { class: "hall-rays", "aria-hidden": "true" },
      h("span"),
      h("span"),
      h("span"),
      h("span"),
    ),
    h(
      "div",
      { class: "hall-floors", role: "group", "aria-label": "Floor" },
      ["1", "3"].map((id) =>
        h(
          "button",
          {
            class: floor === id ? "is-on" : "",
            "aria-pressed": floor === id ? "true" : "false",
            dataset: { action: "room-floor", value: id },
          },
          id === "1" ? "1F day" : "3F evening",
        ),
      ),
    ),
  );
}

function roomView(state) {
  const room = state.room;
  if (room.current) return classroom(state);
  return h(
    "div",
    {},
    hallway(room),
    h(
    "section",
    { class: "room-setup" },
    h("p", { class: "view-kicker" }, "Study room"),
    h("h2", { class: "room-title" }, "Sit with people, not with your list."),
    h("p", { class: "help" }, "Only your name, look, and seat are shared. Tasks stay on this phone."),
    h("label", { class: "field-label", for: "room-name" }, "Your name"),
    h("input", { id: "room-name", class: "field", maxlength: "24", value: room.displayName, placeholder: "What should the room call you?" }),
    h("p", { class: "field-label" }, "Your look"),
    h(
      "div",
      { class: "chibi-row", role: "listbox", "aria-label": "Look" },
      CHIBIS.map((look) =>
        h(
          "button",
          {
            class: room.chibi === look.id ? "chibi-pick is-on" : "chibi-pick",
            "aria-pressed": room.chibi === look.id ? "true" : "false",
            "aria-label": look.label,
            dataset: { action: "room-chibi", id: look.id },
          },
          chibiFigure(look.id),
          h("span", {}, look.label),
        ),
      ),
    ),
    h(
      "div",
      { class: "segment", role: "group", "aria-label": "How to join" },
      [
        ["public", "Public"],
        ["code", "Code"],
        ["create", "Create"],
      ].map(([id, label]) =>
        h(
          "button",
          {
            class: room.mode === id ? "is-on" : "",
            "aria-pressed": room.mode === id ? "true" : "false",
            dataset: { action: "room-mode", value: id },
          },
          label,
        ),
      ),
    ),
    room.mode === "public" ? publicRooms(room) : room.mode === "code" ? codeJoin(room) : createRoom(room),
    h("label", { class: "field-label", for: "room-server" }, "Room connection"),
    h("input", {
      id: "room-server",
      class: "field",
      value: room.serverUrl,
      placeholder: "Blank uses hosted rooms. local stays on this device.",
      spellcheck: "false",
      autocapitalize: "off",
    }),
    h(
      "button",
      { class: "btn-ghost", dataset: { action: "room-server" } },
      presenceTarget(room.serverUrl) === "local"
        ? "Keep rooms on this device"
        : presenceTarget(room.serverUrl) === "hosted"
          ? "Use hosted rooms"
          : "Use this server",
    ),
    h(
      "p",
      { class: "fine" },
      room.modeLabel === "hosted"
        ? "Public rooms, codes, and invite links reach other phones. Only a name, look, and seat are sent."
        : room.modeLabel === "server"
          ? "Public rooms, codes, and invite links are shared through that server. It never receives your tasks."
          : "These rooms stay on this device. Clear the connection field to use hosted rooms.",
    ),
    room.error ? h("p", { class: "error" }, room.error) : null,
    ),
  );
}

function publicRooms(room) {
  return h(
    "div",
    { class: "stack" },
    h(
      "button",
      { class: "btn-quiet", dataset: { action: "room-refresh" } },
      room.status === "connecting" ? "Looking…" : "Refresh public rooms",
    ),
    room.rooms.length
      ? room.rooms.map((item) =>
          h(
            "button",
            { class: "room-card", dataset: { action: "room-join", code: item.code } },
            h("strong", {}, item.name),
            h("span", {}, `${item.count} here · ${item.code}`),
          ),
        )
      : h("p", { class: "help" }, "No public rooms yet. Create one, or join with a code."),
  );
}

function codeJoin(room) {
  return h(
    "div",
    { class: "stack" },
    h("label", { class: "field-label", for: "room-code" }, "Room code"),
    h("input", { id: "room-code", class: "field", maxlength: "8", value: room.codeInput, placeholder: "AB23CD", autocapitalize: "characters" }),
    h("button", { class: "btn-primary", dataset: { action: "room-join" } }, "Join with code"),
  );
}

function createRoom(room) {
  return h(
    "div",
    { class: "stack" },
    h("label", { class: "field-label", for: "room-title" }, "Room name"),
    h("input", { id: "room-title", class: "field", maxlength: "40", value: room.roomName, placeholder: "Afternoon study" }),
    h(
      "button",
      {
        class: "toggle-row",
        "aria-pressed": room.isPublic ? "true" : "false",
        dataset: { action: "room-public" },
      },
      h("span", {}, h("strong", {}, "Public room"), h("small", {}, "Shows up in the public list. A private room is code and invite only.")),
      h("span", { class: "switch", "aria-hidden": "true" }),
    ),
    h("button", { class: "btn-primary", dataset: { action: "room-create" } }, "Create room"),
  );
}

function classroom(state) {
  const room = state.room;
  const current = room.current;
  const members = current.members || [];
  const now = new Date();
  const task = nextTask(state.tasks, now.getTime());
  return h(
    "section",
    { class: "classroom" },
    h(
      "div",
      { class: "class-ceiling", "aria-hidden": "true" },
      h("span", { class: "tube" }),
      h("span", { class: "tube" }),
      h("span", { class: "tube" }),
    ),
    h(
      "div",
      { class: "class-windows", "aria-hidden": "true" },
      windowBank(true),
      windowBank(false),
      windowBank(false),
    ),
    h(
      "div",
      { class: "class-front" },
      h(
        "div",
        { class: "class-board" },
        h("p", {}, current.name),
        h("p", { class: "board-note" }, "One thing, then the next."),
      ),
      h(
        "div",
        { class: "class-side", "aria-hidden": "true" },
        h("span", { class: "class-clock" }),
        h("span", { class: "class-notices" }),
      ),
    ),
    h("div", { class: "class-podium", "aria-hidden": "true" }),
    h(
      "div",
      { class: "floor" },
      h(
        "div",
        { class: "sun-stripes", "aria-hidden": "true" },
        h("span"),
        h("span"),
        h("span"),
        h("span"),
      ),
      h(
        "div",
        { class: "desk-grid" },
        Array.from({ length: SEAT_COUNT }, (_, seat) => {
          const member = members.find((item) => item.seat === seat);
          return h(
            "button",
            {
              class: member && member.id === room.you?.id ? "desk is-mine" : "desk",
              dataset: { action: "room-seat", seat: String(seat) },
              "aria-label": member ? `${member.displayName}, seat ${seat + 1}` : `Empty seat ${seat + 1}`,
            },
            h("span", { class: "desk-chair", "aria-hidden": "true" }),
            member ? null : h("span", { class: "desk-empty" }, "Sit"),
          );
        }),
      ),
      h(
        "div",
        { class: "desk-tops", "aria-hidden": "true" },
        Array.from({ length: SEAT_COUNT }, () => h("span", { class: "desk-top" })),
      ),
      members.map((member) => {
        const key = `${member.id}:${member.seat}`;
        const arriving = !room.walked[key];
        if (arriving) room.walked[key] = true;
        const col = member.seat % 3;
        const row = Math.floor(member.seat / 3);
        const activity = studyActivity(member.chibi);
        return h(
          "div",
          {
            class: arriving ? "walker is-walking" : "walker is-seated",
            style: `left:${(col * 100) / 3}%;top:${row * 104 + 18}px`,
            dataset: { member: member.id, activity, col: String(col), row: String(row) },
          },
          h("span", { class: "zzz", "aria-hidden": "true" }, "z"),
          chibiFigure(member.chibi),
          activityProp(activity),
          h("span", { class: "desk-name" }, member.displayName),
        );
      }),
    ),
    h(
      "div",
      { class: "room-task" },
      h("p", {}, "Your list stays on this phone"),
      task
        ? h(
            "div",
            { class: "room-task-row" },
            h("strong", {}, task.title),
            h("button", { class: "btn-primary", dataset: { action: "complete", id: task.id } }, "Mark done"),
          )
        : h("p", { class: "help" }, "Nothing is waiting on your private list."),
    ),
    h(
      "div",
      { class: "room-bar" },
      h("p", {}, h("strong", {}, current.code), " · ", room.invite),
      h(
        "button",
        { class: "btn-ghost", "aria-pressed": room.focusLatch ? "true" : "false", dataset: { action: "room-focus" } },
        room.focusLatch ? "Still focusing" : "I'm focusing",
      ),
      h("button", { class: "btn-ghost", dataset: { action: "room-copy" } }, "Copy invite link"),
      h("button", { class: "btn-quiet", dataset: { action: "room-leave" } }, "Leave the room"),
    ),
  );
}

export function renderScreen(state) {
  const now = new Date();
  const shell = { class: "frame", "data-daypart": daypart(now) };
  if (state.screen === "partial") {
    return h(
      "div",
      shell,
      h(
        "section",
        { class: "gate" },
        h("h1", {}, "Still"),
        h("p", { class: "lede" }, "Part of a vault is on this device. Still will not replace it with an empty list."),
        h("p", { class: "help" }, "Don’t uninstall or clear storage. You can download the record that is here. It stays encrypted, and it does not include the PIN."),
        h("button", { class: "btn-primary", dataset: { action: "export-partial" } }, "Download the vault record"),
      ),
    );
  }
  if (state.screen === "error") {
    return h(
      "div",
      shell,
      h(
        "section",
        { class: "gate" },
        h("h1", {}, "Still"),
        h("p", { class: "lede" }, state.bootError || "This browser can’t keep a private vault."),
      ),
    );
  }
  if (state.screen === "migrate") {
    return h(
      "div",
      shell,
      migrateScreen(state),
      currentSheet(state, now),
      toast(state),
      h("div", { id: "live", class: "sr-only", "aria-live": "polite" }, state.live || ""),
    );
  }

  const view =
    state.view === "tasks"
      ? tasksView(state, now)
      : state.view === "timer"
        ? timerView(state, now)
        : state.view === "settings"
          ? settingsView(state)
          : state.view === "room"
            ? roomView(state)
            : focusView(state, now);
  const showFab = state.view === "focus" || state.view === "tasks";
  const overdue = state.tasks.filter((task) => !task.completedAt && task.dueAt < now.getTime()).length;

  return h(
    "div",
    shell,
    h(
      "header",
      { class: "topbar" },
      h(
        "div",
        {},
        h("h1", { class: "brand" }, "Still"),
        h(
          "p",
          { class: "date-line" },
          now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
        ),
        state.online ? null : h("p", { class: "offline-pill" }, "Offline. Your list is still here."),
      ),
      null,
    ),
    h("main", { class: "main", inert: state.sheet ? "" : null }, view),
    showFab && !state.sheet
      ? h(
          "div",
          { class: "fabs" },
          h(
            "button",
            {
              class: state.listening ? "fab-mic is-listening" : "fab-mic",
              "aria-label": "Speak a task",
              dataset: { action: "voice" },
            },
            icon("mic"),
          ),
          h("button", { class: "fab", id: "add-task", "aria-label": "Add a task", dataset: { action: "add" } }, icon("plus")),
        )
      : null,
    h(
      "nav",
      { class: "nav", "aria-label": "Sections", inert: state.sheet ? "" : null },
      [
        ["focus", "Focus", "focus"],
        ["tasks", "Tasks", "list"],
        ["room", "Room", "room"],
        ["timer", "Timer", "timer"],
        ["settings", "Settings", "settings"],
      ].map(([id, label, glyph]) =>
        h(
          "button",
          {
            class: state.view === id ? "nav-btn is-on" : "nav-btn",
            "aria-current": state.view === id ? "page" : null,
            dataset: { action: "nav", view: id },
          },
          icon(glyph),
          label,
          id === "tasks" && overdue ? h("span", { class: "nav-count" }, String(overdue)) : null,
        ),
      ),
    ),
    currentSheet(state, now),
    state.celebrate
      ? h(
          "div",
          { class: "celebrate" },
          h(
            "div",
            { class: "celebrate-card" },
            h("div", { class: "celebrate-mark" }, icon("check")),
            h("p", {}, state.celebrate),
            state.undo ? h("button", { class: "btn-quiet", dataset: { action: "undo" } }, "Undo") : null,
          ),
        )
      : null,
    toast(state),
    h("div", { id: "live", class: "sr-only", "aria-live": "polite" }, state.live || ""),
  );
}

function toast(state) {
  if (!state.toast || state.celebrate) return null;
  return h(
    "div",
    { class: "toast", role: "status" },
    h("span", {}, state.toast),
    state.undo ? h("button", { dataset: { action: "undo" } }, "Undo") : null,
  );
}

export function timerOffset(state, now = Date.now()) {
  const total = state.timer.durationMs || 1;
  const left = state.timer.running ? Math.max(0, state.timer.endsAt - now) : state.timer.remainingMs;
  const c = 2 * Math.PI * 86;
  return { left, offset: c * (1 - Math.min(1, Math.max(0, left / total))) };
}
