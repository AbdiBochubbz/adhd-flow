/** Task and settings merge. Never lets an empty list replace one that has tasks. */

export function taskStamp(task) {
  const times = [task?.updatedAt, task?.completedAt, task?.createdAt].filter((value) => typeof value === "number" && Number.isFinite(value));
  return times.length ? Math.max(...times) : 0;
}

function pickSettings(local, remote) {
  const left = local || {};
  const right = remote || {};
  const leftAt = typeof left.settingsUpdatedAt === "number" ? left.settingsUpdatedAt : null;
  const rightAt = typeof right.settingsUpdatedAt === "number" ? right.settingsUpdatedAt : null;
  if (leftAt != null && rightAt != null) return leftAt >= rightAt ? left : right;
  if (rightAt != null && leftAt == null) return right;
  return left;
}

export function mergePayloads(local, remote) {
  const tombs = new Map();
  for (const item of [...(remote?.tombstones || []), ...(local?.tombstones || [])]) {
    if (!item?.id || typeof item.at !== "number") continue;
    tombs.set(item.id, Math.max(tombs.get(item.id) || 0, item.at));
  }
  const byId = new Map();
  const consider = (task) => {
    if (!task?.id) return;
    const stamp = taskStamp(task);
    if ((tombs.get(task.id) || 0) > stamp) return;
    const existing = byId.get(task.id);
    if (!existing || taskStamp(existing) < stamp) byId.set(task.id, task);
  };
  for (const task of remote?.tasks || []) consider(task);
  for (const task of local?.tasks || []) consider(task);
  for (const [id, task] of byId) {
    if ((tombs.get(id) || 0) <= taskStamp(task)) tombs.delete(id);
  }
  return {
    tasks: [...byId.values()],
    tombstones: [...tombs.entries()].map(([id, at]) => ({ id, at })),
    settings: pickSettings(local?.settings, remote?.settings),
    accountEmail: local?.accountEmail || remote?.accountEmail || "",
    syncKeyB64: local?.syncKeyB64 || remote?.syncKeyB64 || "",
  };
}

/**
 * Decide what to do with two decrypted lists.
 * `remote === null` means the account has no list yet.
 * A decrypted empty list is not the same as a list we could not read.
 */
export function planSync({ local, remote, baseRevision = 0, remoteRevision = 0, dirty = false }) {
  const localTasks = local?.tasks || [];
  const remoteTasks = remote?.tasks || [];
  if (remote == null) {
    return { action: "push", payload: local, baseRevision: 0, reason: "new-remote" };
  }
  if (!dirty && remoteRevision === baseRevision) {
    return { action: "none", payload: local, reason: "current" };
  }
  if (remoteTasks.length === 0 && localTasks.length > 0) {
    return { action: "push", payload: local, baseRevision: remoteRevision, reason: "keep-local" };
  }
  const localDeletes = (local?.tombstones || []).length > 0;
  if (localTasks.length === 0 && remoteTasks.length > 0 && !localDeletes) {
    return { action: "adopt", payload: remote, revision: remoteRevision, reason: "keep-remote" };
  }
  return {
    action: "push",
    payload: mergePayloads(local, remote),
    baseRevision: remoteRevision,
    reason: "merged",
  };
}
