import {
  DOC_REMINDER_HOUR,
  DOC_REMINDER_OFFSET_DAYS,
  type DocReminderOffset,
} from './types';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse the value of a `date` doc property (`YYYY-MM-DD`) as a local date.
 * Returns `null` for anything else, including impossible dates like 2025-02-31.
 */
export function parseDatePropertyValue(
  value: unknown
): { year: number; month: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = [+match[1], +match[2], +match[3]];
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * The moment (device local time) a reminder should fire.
 */
export function getReminderTime(
  value: unknown,
  offset: DocReminderOffset
): Date | null {
  const parsed = parseDatePropertyValue(value);
  if (!parsed) return null;
  // `Date` normalizes a negative day, and keeps the wall-clock hour across DST.
  return new Date(
    parsed.year,
    parsed.month - 1,
    parsed.day - DOC_REMINDER_OFFSET_DAYS[offset],
    DOC_REMINDER_HOUR,
    0,
    0,
    0
  );
}

export interface ReminderSource {
  docId: string;
  /** id of the doc property, or of the column for a database cell */
  propertyId: string;
  /** set when the reminder is for a cell of a database block */
  databaseBlockId?: string;
  rowId?: string;
  /** title of the database row */
  rowTitle?: string;
  offset: DocReminderOffset;
  /** current value of the date property or cell, as `YYYY-MM-DD` */
  dateValue: unknown;
  docTitle: string;
  propertyName: string;
  trashed: boolean;
}

/**
 * Format a timestamp stored in a database date cell as the local date
 * `YYYY-MM-DD`, the same shape as the value of a date doc property.
 */
export function formatCellDate(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number, length = 2) => String(n).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface PlannedReminder extends ReminderSource {
  id: number;
  at: Date;
}

/**
 * Stable 31-bit id, local notifications need a 32-bit signed integer id.
 */
export function getNotificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}

/**
 * Pick the reminders that still have to fire, the earliest first.
 *
 * iOS keeps at most 64 pending local notifications per app, so the caller
 * should pass a small `limit`.
 */
export function planReminders(options: {
  workspaceId: string;
  sources: ReminderSource[];
  now: Date;
  limit: number;
}): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  const usedIds = new Set<number>();
  for (const source of options.sources) {
    if (source.trashed) continue;
    const at = getReminderTime(source.dateValue, source.offset);
    if (!at || at.getTime() <= options.now.getTime()) continue;
    const id = getNotificationId(
      [
        options.workspaceId,
        source.docId,
        source.propertyId,
        // keeps the id of doc property reminders as it was
        ...(source.databaseBlockId
          ? [source.databaseBlockId, source.rowId]
          : []),
      ].join(':')
    );
    if (usedIds.has(id)) continue; // extremely unlikely hash collision
    usedIds.add(id);
    planned.push({ ...source, id, at });
  }
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  return planned.slice(0, options.limit);
}

export interface PendingNotificationLike {
  id: number;
  signature?: string;
}

/**
 * Compare what the OS already has scheduled with what we want.
 * A notification whose content or time changed is cancelled and scheduled again.
 */
export function diffNotifications<T extends { id: number; signature: string }>(
  pending: PendingNotificationLike[],
  desired: T[]
): { cancel: number[]; schedule: T[] } {
  const pendingById = new Map(pending.map(p => [p.id, p]));
  const desiredIds = new Set(desired.map(d => d.id));
  const cancel = pending
    .filter(p => {
      if (!desiredIds.has(p.id)) return true;
      const wanted = desired.find(d => d.id === p.id);
      return wanted?.signature !== p.signature;
    })
    .map(p => p.id);
  const schedule = desired.filter(
    d => pendingById.get(d.id)?.signature !== d.signature
  );
  return { cancel, schedule };
}
