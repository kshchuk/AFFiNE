import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type {
  LocalNotificationProvider,
  PendingLocalNotification,
} from '../providers/local-notification';
import type { DocReminder } from '../types';
import { DocReminderSyncService } from './doc-reminder-sync';

const NOW = new Date(2030, 4, 1, 12);

function setup() {
  const reminders$ = new LiveData<DocReminder[]>([]);
  const dateValue$ = new LiveData<string | undefined>('2030-05-10');
  const title$ = new LiveData('Launch plan');
  const trash$ = new LiveData(false);
  const record = {
    title$,
    trash$,
    customProperty$: () => dateValue$,
  };
  const docsMap$ = new LiveData(new Map([['doc-1', record]]));
  const properties$ = new LiveData([
    { id: 'due', type: 'date', name: 'Release date' },
    { id: 'text', type: 'text', name: 'Notes' },
  ]);

  let pending: PendingLocalNotification[] = [];
  const provider = {
    checkPermission: vi.fn(),
    requestPermission: vi.fn(),
    getPending: vi.fn(async () => pending),
    schedule: vi.fn(async requests => {
      pending = [
        ...pending.filter(p => !requests.some((r: any) => r.id === p.id)),
        ...requests.map((r: any) => ({ id: r.id, extra: r.extra })),
      ];
    }),
    cancel: vi.fn(async (ids: number[]) => {
      pending = pending.filter(p => !ids.includes(p.id));
    }),
  } satisfies LocalNotificationProvider;

  const framework = new Framework();
  framework.service(
    DocReminderSyncService,
    () =>
      new DocReminderSyncService(
        { workspace: { id: 'ws' } } as any,
        { watchReminders: () => reminders$ } as any,
        { list: { docsMap$ } } as any,
        { properties$ } as any,
        provider
      )
  );
  const service = framework.provider().get(DocReminderSyncService);
  service.onWorkspaceInitialized({} as any);

  const flush = async () => {
    await vi.advanceTimersByTimeAsync(1000);
  };
  return {
    service,
    provider,
    reminders$,
    dateValue$,
    trash$,
    flush,
    getPending: () => pending,
  };
}

describe('DocReminderSyncService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('schedules a reminder for a date property', async () => {
    const t = setup();
    t.reminders$.next([{ docId: 'doc-1', propertyId: 'due', offset: '1-day' }]);
    await t.flush();

    expect(t.provider.schedule).toHaveBeenCalledTimes(1);
    const [[requests]] = t.provider.schedule.mock.calls;
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      title: 'Launch plan',
      body: 'Release date is tomorrow',
      at: new Date(2030, 4, 9, 9),
      extra: { kind: 'doc-reminder', workspaceId: 'ws', docId: 'doc-1' },
    });
  });

  test('does not schedule again when nothing changed', async () => {
    const t = setup();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    expect(t.provider.schedule).toHaveBeenCalledTimes(1);
    expect(t.provider.cancel).not.toHaveBeenCalled();
  });

  test('reschedules when the date changes', async () => {
    const t = setup();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    t.dateValue$.next('2030-05-20');
    await t.flush();

    expect(t.provider.cancel).toHaveBeenCalledTimes(1);
    expect(t.provider.schedule).toHaveBeenCalledTimes(2);
    expect(t.provider.schedule.mock.calls[1][0][0].at).toEqual(
      new Date(2030, 4, 20, 9)
    );
    expect(t.getPending()).toHaveLength(1);
  });

  test('cancels the notification when the reminder is removed', async () => {
    const t = setup();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    t.reminders$.next([]);
    await t.flush();
    expect(t.getPending()).toHaveLength(0);
  });

  test('cancels the notification when the doc is trashed or the date cleared', async () => {
    const t = setup();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    t.trash$.next(true);
    await t.flush();
    expect(t.getPending()).toHaveLength(0);

    t.trash$.next(false);
    await t.flush();
    expect(t.getPending()).toHaveLength(1);

    t.dateValue$.next(undefined);
    await t.flush();
    expect(t.getPending()).toHaveLength(0);
  });

  test('ignores reminders of properties that are not dates', async () => {
    const t = setup();
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'text', offset: 'on-day' },
    ]);
    await t.flush();
    expect(t.provider.schedule).not.toHaveBeenCalled();
  });

  test('leaves notifications of other workspaces alone', async () => {
    const t = setup();
    t.provider.getPending.mockResolvedValue([
      { id: 99, extra: { kind: 'doc-reminder', workspaceId: 'other' } },
      { id: 98, extra: null },
    ]);
    t.reminders$.next([
      { docId: 'doc-1', propertyId: 'due', offset: 'on-day' },
    ]);
    await t.flush();
    expect(t.provider.cancel).not.toHaveBeenCalled();
  });
});
