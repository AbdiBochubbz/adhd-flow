import assert from "node:assert/strict";
import test from "node:test";
import { parseTask } from "../src/parse.js";
import { endOfDay } from "../src/time.js";

const now = new Date(2026, 9, 27, 15, 0, 0, 0);

test("the fixture date is a Tuesday afternoon", () => {
  assert.equal(now.getDay(), 2);
});

test("parses a weekday and a clock time out of a sentence", () => {
  const task = parseTask("math homework due Friday at 5pm", now);
  assert.equal(task.title, "Math homework");
  assert.equal(task.subject, "Math");
  assert.equal(task.allDay, false);
  assert.equal(task.dueAt, new Date(2026, 9, 30, 17, 0, 0, 0).getTime());
});

test("tomorrow with no clock time is the end of that day", () => {
  const task = parseTask("essay tomorrow", now);
  assert.equal(task.title, "Essay");
  assert.equal(task.subject, "English");
  assert.equal(task.allDay, true);
  assert.equal(task.dueAt, new Date(2026, 9, 28, 23, 59, 0, 0).getTime());
});

test("no date defaults to today, end of day", () => {
  const task = parseTask("read chapter 4", now);
  assert.equal(task.title, "Read chapter 4");
  assert.equal(task.inferred, true);
  assert.equal(task.dueAt, endOfDay(now).getTime());
});

test("next Monday at 9am is the coming Monday morning", () => {
  const task = parseTask("history quiz next Monday 9am", now);
  assert.equal(task.title, "History quiz");
  assert.equal(task.subject, "History");
  assert.equal(task.dueAt, new Date(2026, 10, 2, 9, 0, 0, 0).getTime());
});

test("in 3 days lands at the end of that day", () => {
  const task = parseTask("project due in 3 days", now);
  assert.equal(task.title, "Project");
  assert.equal(task.allDay, true);
  const expected = endOfDay(now);
  expected.setDate(expected.getDate() + 3);
  assert.equal(task.dueAt, expected.getTime());
});

test("bare 'at 4' in the afternoon means 4pm today", () => {
  const task = parseTask("spanish vocab at 4", now);
  assert.equal(task.title, "Spanish vocab");
  assert.equal(task.subject, "Language");
  assert.equal(task.dueAt, new Date(2026, 9, 27, 16, 0, 0, 0).getTime());
});

test("a bare afternoon hour rolls to tomorrow once it has passed", () => {
  const later = new Date(2026, 9, 27, 17, 0, 0, 0);
  const task = parseTask("spanish vocab at 4", later);
  assert.equal(task.dueAt, new Date(2026, 9, 28, 16, 0, 0, 0).getTime());
});

test("weekday names and month names both resolve", () => {
  const lab = parseTask("lab report by Wednesday", now);
  assert.equal(lab.title, "Lab report");
  assert.equal(lab.subject, "Science");
  assert.equal(lab.dueAt, new Date(2026, 9, 28, 23, 59, 0, 0).getTime());

  const fair = parseTask("science fair October 30", now);
  assert.equal(fair.title, "Science fair");
  assert.equal(fair.dueAt, new Date(2026, 9, 30, 23, 59, 0, 0).getTime());

  const book = parseTask("book report due Oct 30 at 3:30 pm", now);
  assert.equal(book.title, "Book report");
  assert.equal(book.dueAt, new Date(2026, 9, 30, 15, 30, 0, 0).getTime());
});

test("relative hours, tonight, and tomorrow morning", () => {
  const soon = parseTask("test in 2 hours", now);
  assert.equal(soon.title, "Test");
  assert.equal(soon.dueAt, new Date(2026, 9, 27, 17, 0, 0, 0).getTime());

  const tonight = parseTask("read chapter 4 by tonight", now);
  assert.equal(tonight.title, "Read chapter 4");
  assert.equal(tonight.dueAt, new Date(2026, 9, 27, 21, 0, 0, 0).getTime());

  const morning = parseTask("essay tomorrow morning", now);
  assert.equal(morning.title, "Essay");
  assert.equal(morning.dueAt, new Date(2026, 9, 28, 9, 0, 0, 0).getTime());
});

test("an explicit date does not roll forward after the clock time has passed", () => {
  const fridayEvening = new Date(2026, 9, 30, 18, 0, 0, 0);
  const task = parseTask("Friday at 5pm", fridayEvening);
  assert.equal(task.dueAt, new Date(2026, 9, 30, 17, 0, 0, 0).getTime());
});

test("on Friday, next Friday is a week out", () => {
  const friday = new Date(2026, 9, 30, 10, 0, 0, 0);
  const task = parseTask("next Friday at 5pm", friday);
  assert.equal(task.dueAt, new Date(2026, 10, 6, 17, 0, 0, 0).getTime());
});

test("empty input is not a task", () => {
  assert.equal(parseTask("   ", now), null);
  assert.equal(parseTask("", now), null);
});

test("a sentence that is only a date still gets a title", () => {
  const task = parseTask("due Friday", now);
  assert.equal(task.title, "School task");
  assert.equal(task.dueAt, new Date(2026, 9, 30, 23, 59, 0, 0).getTime());
});
