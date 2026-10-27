import { endOfDay, startOfDay } from "./time.js";

const MONTHS = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sept: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

const WEEKDAYS = [
  ["sunday", 0],
  ["monday", 1],
  ["tuesday", 2],
  ["wednesday", 3],
  ["thursday", 4],
  ["friday", 5],
  ["saturday", 6],
  ["sun", 0],
  ["mon", 1],
  ["tue", 2],
  ["tues", 2],
  ["wed", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["fri", 5],
  ["sat", 6],
];

const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const WEEKDAY_ALT = [...WEEKDAYS]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name]) => name)
  .join("|");

const SUBJECT_RULES = [
  [/\b(math|algebra|geometry|calculus|trigonometry|statistics|stats)\b/i, "Math"],
  [/\b(english|essay|literature|grammar|reading)\b/i, "English"],
  [/\b(science|biology|chemistry|chem|physics|lab)\b/i, "Science"],
  [/\b(history|geography|civics|social studies)\b/i, "History"],
  [/\b(spanish|french|german|latin|vocab|vocabulary|language)\b/i, "Language"],
  [/\b(art|music|band|choir|drama)\b/i, "Art"],
];

function weekdayIndex(name) {
  const found = WEEKDAYS.find(([label]) => label === name.toLowerCase());
  return found ? found[1] : null;
}

function consume(state, re) {
  const match = re.exec(state.text);
  if (!match) return null;
  state.text = `${state.text.slice(0, match.index)} ${state.text.slice(match.index + match[0].length)}`
    .replace(/\s+/g, " ")
    .trim();
  return match;
}

function validYMD(year, month, day) {
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
  return date;
}

function resolveYear(now, year, month, day) {
  const resolved = year ?? now.getFullYear();
  let date = validYMD(resolved, month, day);
  if (!date) return null;
  if (year == null && startOfDay(date).getTime() < startOfDay(now).getTime()) {
    date = validYMD(resolved + 1, month, day);
  }
  return date ? startOfDay(date) : null;
}

function parseAmpmHour(hour, minute, ampm) {
  let h = Number(hour);
  const m = minute == null || minute === "" ? 0 : Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || m > 59 || h < 0) return null;
  if (ampm) {
    const flag = ampm.replace(/\./g, "").toLowerCase();
    if (h > 12) return null;
    if (h === 12) h = flag.startsWith("p") ? 12 : 0;
    else if (flag.startsWith("p")) h += 12;
  } else if (h >= 13 && h <= 23) {
    // 24-hour clock
  } else if (h === 12 || h === 0) {
    h = h === 0 ? 0 : 12;
  } else if (h >= 1 && h <= 7) {
    // School tasks said as "at 5" almost always mean the afternoon.
    h += 12;
  } else if (h >= 8 && h <= 11) {
    // "at 8" stays morning. The preview shows the choice so it can be fixed.
  } else {
    return null;
  }
  if (h > 23) return null;
  return { h, m };
}

function cleanTitle(text) {
  let title = text.replace(/\s+/g, " ").trim();
  title = title.replace(
    /^(please\s+)?(remind me to|remember to|i need to|i have to|don't forget to|dont forget to)\s+/i,
    "",
  );
  const edge = /^(?:due|by|before|on|at|for)\b[\s,:-]*/i;
  const trail = /[\s,:-]*\b(?:due|by|before|on|at|for)\s*$/i;
  let previous;
  do {
    previous = title;
    title = title.replace(edge, "").replace(trail, "").replace(/\s+/g, " ").trim();
  } while (title !== previous);
  title = title.replace(/\bdue\b/gi, " ");
  title = title.replace(/\s+,/g, "").replace(/^,+|,+$/g, "");
  title = title.replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, "");
  title = title.replace(/\s+/g, " ").trim();
  if (!title) return "";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function guessSubject(title) {
  for (const [rule, subject] of SUBJECT_RULES) {
    if (rule.test(title)) return subject;
  }
  return "";
}

const PARTS = {
  morning: { h: 9, m: 0 },
  afternoon: { h: 15, m: 0 },
  evening: { h: 18, m: 0 },
  night: { h: 21, m: 0 },
  tonight: { h: 21, m: 0 },
  noon: { h: 12, m: 0 },
  midnight: { h: 23, m: 59 },
};

/**
 * Pull a title and a due timestamp out of a sentence.
 * If the sentence has no date, the due time is today at 23:59.
 * "at 5" without am/pm is read as 5:00 pm for hours 1–7, and as morning for 8–11.
 * The caller should show the resolved time so a wrong guess can be edited.
 */
export function parseTask(input, now = new Date()) {
  if (typeof input !== "string") return null;
  const state = { text: input.trim().replace(/\s+/g, " ") };
  if (!state.text) return null;

  let date = null;
  let time = null;
  let relative = null;
  let explicitDate = false;
  let explicitTime = false;
  let allDay = true;

  const relativeMatch =
    consume(state, /\b(?:in|after)\s+half\s+an\s+hour\b/i) ||
    consume(state, /\b(?:in|after)\s+(?:an|a|\d+)\s+(hours?|hrs?|minutes?|mins?|days?|weeks?)\b/i);
  if (relativeMatch) {
    explicitDate = true;
    explicitTime = true;
    allDay = false;
    const phrase = relativeMatch[0].toLowerCase();
    if (phrase.includes("half")) {
      relative = 30 * 60_000;
    } else {
      const amount = /(?:an|a)/i.test(phrase) && !/\d/.test(phrase) ? 1 : Number(phrase.match(/\d+/)[0]);
      if (phrase.includes("week")) {
        const day = endOfDay(now);
        day.setDate(day.getDate() + amount * 7);
        relative = day.getTime() - now.getTime();
        allDay = true;
        explicitTime = false;
      } else if (phrase.includes("day")) {
        const day = endOfDay(now);
        day.setDate(day.getDate() + amount);
        relative = day.getTime() - now.getTime();
        allDay = true;
        explicitTime = false;
      } else if (phrase.includes("hour") || phrase.includes("hr")) {
        relative = amount * 3_600_000;
      } else {
        relative = amount * 60_000;
      }
    }
  }

  if (!relative) {
    const iso = consume(state, /\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (iso) {
      date = resolveYear(now, Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (date) explicitDate = true;
    }
  }

  if (!relative && !date) {
    const monthFirst = consume(
      state,
      new RegExp(`\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?\\b`, "i"),
    );
    const dayFirst = !monthFirst
      ? consume(
          state,
          new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_ALT})(?:\\s+(\\d{4}))?\\b`, "i"),
        )
      : null;
    if (monthFirst) {
      const month = MONTHS[monthFirst[1].toLowerCase()];
      const day = Number(monthFirst[2]);
      const year = monthFirst[3] ? Number(monthFirst[3]) : null;
      date = resolveYear(now, year, month, day);
      if (date) explicitDate = true;
    } else if (dayFirst) {
      const day = Number(dayFirst[1]);
      const month = MONTHS[dayFirst[2].toLowerCase()];
      const year = dayFirst[3] ? Number(dayFirst[3]) : null;
      date = resolveYear(now, year, month, day);
      if (date) explicitDate = true;
    }
  }

  if (!relative && !date) {
    const slash = consume(state, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (slash) {
      let month = Number(slash[1]);
      let day = Number(slash[2]);
      if (month > 12 && day <= 12) {
        [month, day] = [day, month];
      }
      let year = slash[3] ? Number(slash[3]) : null;
      if (year != null && year < 100) year += 2000;
      date = resolveYear(now, year, month - 1, day);
      if (date) explicitDate = true;
    }
  }

  if (!relative && !date) {
    if (consume(state, /\bnext\s+week\b/i)) {
      const monday = startOfDay(now);
      const delta = (8 - monday.getDay()) % 7 || 7;
      monday.setDate(monday.getDate() + delta);
      date = monday;
      explicitDate = true;
    } else if (consume(state, /\b(?:this\s+)?weekend\b/i)) {
      const saturday = startOfDay(now);
      const delta = (6 - saturday.getDay() + 7) % 7;
      saturday.setDate(saturday.getDate() + delta);
      if (delta === 0 && endOfDay(saturday).getTime() <= now.getTime()) saturday.setDate(saturday.getDate() + 7);
      date = saturday;
      explicitDate = true;
    }
  }

  const compound =
    !relative && !date
      ? consume(
          state,
          /\b(tomorrow|today)\s+(morning|afternoon|evening|night)\b|\b(tonight|this\s+morning|this\s+afternoon|this\s+evening)\b/i,
        )
      : null;
  if (compound) {
    const phrase = compound[0].toLowerCase();
    if (phrase.startsWith("tomorrow")) {
      date = startOfDay(now);
      date.setDate(date.getDate() + 1);
      explicitDate = true;
    } else {
      date = startOfDay(now);
      explicitDate = true;
    }
    if (phrase.includes("morning")) time = { ...PARTS.morning };
    else if (phrase.includes("afternoon")) time = { ...PARTS.afternoon };
    else if (phrase.includes("evening")) time = { ...PARTS.evening };
    else time = { ...PARTS.night };
    explicitTime = true;
    allDay = false;
  }

  if (!relative && !date) {
    const named = consume(state, /\b(today|tomorrow|tmrw|tmr)\b/i);
    if (named) {
      date = startOfDay(now);
      if (named[1].toLowerCase() !== "today") date.setDate(date.getDate() + 1);
      explicitDate = true;
    }
  }

  if (!relative && !explicitDate) {
    const weekday = consume(state, new RegExp(`\\b(?:(next|this)\\s+)?(${WEEKDAY_ALT})\\b`, "i"));
    if (weekday) {
      const index = weekdayIndex(weekday[2]);
      const nextWord = (weekday[1] || "").toLowerCase() === "next";
      let delta = (index - now.getDay() + 7) % 7;
      if (nextWord && delta === 0) delta = 7;
      const day = startOfDay(now);
      day.setDate(day.getDate() + delta);
      date = day;
      explicitDate = true;
    }
  }

  if (!relative) {
    const ampm = consume(state, /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
    const atNumber = !ampm ? consume(state, /\bat\s+(\d{1,2})(?::(\d{2}))?\b/i) : null;
    const colon = !ampm && !atNumber ? consume(state, /\b(\d{1,2}):(\d{2})\b/) : null;
    const found = ampm || atNumber || colon;
    if (found) {
      const parsed = parseAmpmHour(found[1], found[2], ampm ? found[3] : null);
      if (parsed) {
        time = parsed;
        explicitTime = true;
        allDay = false;
      }
    } else if (!time) {
      const part = consume(
        state,
        /\b(tonight|noon|midnight|morning|afternoon|evening|night|eod|end\s+of\s+(?:the\s+)?day)\b/i,
      );
      if (part) {
        const word = part[1].toLowerCase();
        if (word === "eod" || word.startsWith("end of")) {
          explicitDate = explicitDate || true;
          if (!date) date = startOfDay(now);
          allDay = true;
          time = null;
          explicitTime = false;
        } else if (word === "tonight") {
          if (!date) date = startOfDay(now);
          explicitDate = true;
          const hour = now.getHours() >= 21 ? 23 : 21;
          const minute = now.getHours() >= 21 ? 59 : 0;
          time = { h: hour, m: minute };
          explicitTime = true;
          allDay = false;
        } else {
          const key = word === "night" ? "night" : word;
          time = { ...PARTS[key] };
          explicitTime = true;
          allDay = word === "midnight";
          if (word === "midnight") {
            explicitTime = false;
            allDay = true;
            time = null;
            if (!date) {
              date = startOfDay(now);
              explicitDate = true;
            }
          }
        }
      }
    }
  }

  let due;
  if (relative != null) {
    due = new Date(now.getTime() + relative);
    due.setSeconds(0, 0);
  } else {
    due = date ? new Date(date) : startOfDay(now);
    if (time && !(allDay && time.h === 23 && time.m === 59)) {
      due.setHours(time.h, time.m, 0, 0);
      if (!explicitDate && due.getTime() <= now.getTime()) due.setDate(due.getDate() + 1);
      allDay = false;
    } else {
      due = endOfDay(due);
      allDay = true;
    }
  }

  const title = cleanTitle(state.text) || "School task";
  return {
    title,
    dueAt: due.getTime(),
    allDay,
    explicitDate,
    explicitTime,
    inferred: !explicitDate && !explicitTime && relative == null,
    subject: guessSubject(title),
  };
}
