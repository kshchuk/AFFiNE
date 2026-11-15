import { describe, expect, test } from 'vitest';

import {
  diffNotifications,
  getNotificationId,
  getReminderTime,
  parseDatePropertyValue,
  planReminders,
  type ReminderSource,
} from './utils';

const source = (patch: Partial<ReminderSource> = {}): ReminderSource => ({
  docId: 'doc-1',
  propertyId: 'due',
  offset: 'on-day',
  dateValue: '2030-05-10',
  docTitle: 'Title',
  propertyName: 'Due',
  trashed: false,
  ...patch,
});

describe('parseDatePropertyValue', () => {
  test('parses YYYY-MM-DD', () => {
    expect(parseDatePropertyValue('2030-05-10')).toEqual({
      year: 2030,
      month: 5,
      day: 10,
    });
  });

  test.each([
    undefined,
    null,
    '',
    20300510,
    '2030-5-10',
    '2030-05-10T09:00',
    '2030-02-31',
    '2030-13-01',
  ])('rejects %s', value => {
    expect(parseDatePropertyValue(value)).toBeNull();
  });
});

describe('getReminderTime', () => {
  test('fires at 9:00 local time on the day', () => {
    expect(getReminderTime('2030-05-10', 'on-day')).toEqual(
      new Date(2030, 4, 10, 9)
    );
  });

  test('subtracts whole days, across month and year boundaries', () => {
    expect(getReminderTime('2030-05-10', '1-day')).toEqual(
      new Date(2030, 4, 9, 9)
    );
    expect(getReminderTime('2030-03-01', '2-days')).toEqual(
      new Date(2030, 1, 27, 9)
    );
    expect(getReminderTime('2030-01-03', '1-week')).toEqual(
      new Date(2029, 11, 27, 9)
    );
  });

  test('returns null without a valid date', () => {
    expect(getReminderTime('', 'on-day')).toBeNull();
  });
});

describe('getNotificationId', () => {
  test('is a stable positive 32-bit integer', () => {
    const id = getNotificationId('ws:doc:prop');
    expect(id).toBe(getNotificationId('ws:doc:prop'));
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
    expect(id).not.toBe(getNotificationId('ws:doc:prop2'));
  });
});

describe('planReminders', () => {
  const now = new Date(2030, 4, 1, 12);

  test('keeps upcoming reminders, earliest first', () => {
    const planned = planReminders({
      workspaceId: 'ws',
      now,
      limit: 10,
      sources: [
        source({ docId: 'late', dateValue: '2030-06-01' }),
        source({ docId: 'soon', dateValue: '2030-05-02' }),
      ],
    });
    expect(planned.map(p => p.docId)).toEqual(['soon', 'late']);
    expect(planned[0].at).toEqual(new Date(2030, 4, 2, 9));
  });

  test('skips past, trashed and undated reminders', () => {
    const planned = planReminders({
      workspaceId: 'ws',
      now,
      limit: 10,
      sources: [
        source({ docId: 'past', dateValue: '2030-04-30' }),
        // today at 9:00 is already gone at 12:00
        source({ docId: 'today', dateValue: '2030-05-01' }),
        source({ docId: 'trashed', trashed: true }),
        source({ docId: 'empty', dateValue: undefined }),
        source({ docId: 'ok' }),
      ],
    });
    expect(planned.map(p => p.docId)).toEqual(['ok']);
  });

  test('an earlier offset can move a reminder into the past', () => {
    const planned = planReminders({
      workspaceId: 'ws',
      now,
      limit: 10,
      sources: [source({ dateValue: '2030-05-05', offset: '1-week' })],
    });
    expect(planned).toEqual([]);
  });

  test('applies the limit after sorting', () => {
    const planned = planReminders({
      workspaceId: 'ws',
      now,
      limit: 1,
      sources: [
        source({ docId: 'b', dateValue: '2030-07-01' }),
        source({ docId: 'a', dateValue: '2030-06-01' }),
      ],
    });
    expect(planned.map(p => p.docId)).toEqual(['a']);
  });

  test('uses different ids for different workspaces, docs and properties', () => {
    const ids = [
      ...planReminders({
        workspaceId: 'ws-1',
        now,
        limit: 10,
        sources: [source(), source({ propertyId: 'other' })],
      }),
      ...planReminders({
        workspaceId: 'ws-2',
        now,
        limit: 10,
        sources: [source()],
      }),
    ].map(p => p.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('diffNotifications', () => {
  const want = (id: number, signature: string) => ({ id, signature });

  test('schedules what is missing and cancels what is gone', () => {
    expect(
      diffNotifications([{ id: 1, signature: 'a' }], [want(2, 'b')])
    ).toEqual({ cancel: [1], schedule: [want(2, 'b')] });
  });

  test('leaves unchanged notifications alone', () => {
    expect(
      diffNotifications([{ id: 1, signature: 'a' }], [want(1, 'a')])
    ).toEqual({ cancel: [], schedule: [] });
  });

  test('reschedules a notification whose content changed', () => {
    expect(
      diffNotifications([{ id: 1, signature: 'a' }], [want(1, 'b')])
    ).toEqual({ cancel: [1], schedule: [want(1, 'b')] });
  });

  test('reschedules a pending notification without a signature', () => {
    expect(diffNotifications([{ id: 1 }], [want(1, 'a')])).toEqual({
      cancel: [1],
      schedule: [want(1, 'a')],
    });
  });
});
