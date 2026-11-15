import { Framework, LiveData } from '@toeverything/infra';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import type {
  LocalNotificationProvider,
  PendingLocalNotification,
} from '../providers/local-notification';
import type { DatabaseCellReminder, DocReminder } from '../types';
import { DocReminderSyncService } from './doc-reminder-sync';

const NOW = new Date(2030, 4, 1, 12);

function setup(initial: { docsReady?: boolean; loading?: boolean } = {}) {
  const reminders$ = new LiveData<DocReminder[]>([]);
  const dateValue$ = new LiveData<string | undefined>('2030-05-10');
  const title$ = new LiveData('Launch plan');
  const trash$ = new LiveData(false);
  const record = {
    title$,
    trash$,
    meta$: new LiveData({}),
    customProperty$: () => dateValue$,
  };
  const docsMap$ = new LiveData(new Map([['doc-1', record]]));
  const docsReady$ = new LiveData(initial.docsReady ?? true);
  const loading$ = new LiveData(initial.loading ?? false);
  const cellReminders$ = new LiveData<DatabaseCellReminder[]>([]);

  // a doc with a database block, opened in the background to read its cells
  const yDoc = new YDoc();
  const database = {
    props: {
      columns: [{ id: 'due-col', type: 'date', name: 'Due Date' }],
      cells: {
        'row-1': { 'due-col': { value: new Date(2030, 4, 10).getTime() } },
      } as Record<string, Record<string, { value?: unknown }>>,
    },
    children: [
      { id: 'row-1', text: { toString: () => 'Write report' } },
    ] as Array<{ id: string; text: { toString: () => string } }>,
  };
  let docLoaded: () => void = () => {};
  const docLoading = new Promise<void>(resolve => (docLoaded = resolve));
  const loadDocImmediately = { value: true };
  const release = vi.fn();
  const docsService = {
    list: {
      docsMap$,
      isReady$: docsReady$,
      doc$: () => ({ value: record }),
    },
    open: vi.fn(() => ({
      doc: {
        blockSuiteDoc: {
          ready: true,
          load: () => {},
          getBlock: (id: string) =>
            id === 'db-1'
              ? { flavour: 'affine:database', model: database }
              : undefined,
        },
        yDoc,
        addPriorityLoad: () => () => {},
        waitForSyncReady: () =>
          loadDocImmediately.value ? Promise.resolve() : docLoading,
      },
      release,
    })),
  };
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
        {
          watchReminders: () => reminders$,
          watchCellReminders: () => cellReminders$,
          watchLoading: () => loading$,
        } as any,
        docsService as any,
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
    cellReminders$,
    docsReady$,
    loading$,
    database,
    yDoc,
    docsService,
    release,
    loadDocImmediately,
    docLoaded: () => docLoaded(),
    dateValue$,
    trash$,
    flush,
    getPending: () => pending,
    setPending: (value: PendingLocalNotification[]) => {
      pending = value;
    },
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

  describe('database cells', () => {
    const cellReminder: DatabaseCellReminder = {
      docId: 'doc-2',
      databaseBlockId: 'db-1',
      rowId: 'row-1',
      columnId: 'due-col',
      offset: '1-day',
    };

    test('schedules a reminder with the title of the row', async () => {
      const t = setup();
      t.cellReminders$.next([cellReminder]);
      await t.flush();

      expect(t.provider.schedule).toHaveBeenCalledTimes(1);
      expect(t.provider.schedule.mock.calls[0][0][0]).toMatchObject({
        title: 'Write report',
        body: 'Due Date is tomorrow',
        at: new Date(2030, 4, 9, 9),
        extra: {
          kind: 'doc-reminder',
          workspaceId: 'ws',
          docId: 'doc-2',
          propertyId: 'due-col',
          databaseBlockId: 'db-1',
          rowId: 'row-1',
        },
      });
    });

    test('reschedules when the cell value changes', async () => {
      const t = setup();
      t.cellReminders$.next([cellReminder]);
      await t.flush();

      t.database.props.cells['row-1']['due-col'].value = new Date(
        2030,
        4,
        20
      ).getTime();
      t.yDoc.transact(() => {});
      await t.flush();

      expect(t.provider.cancel).toHaveBeenCalledTimes(1);
      expect(t.provider.schedule).toHaveBeenCalledTimes(2);
      expect(t.provider.schedule.mock.calls[1][0][0].at).toEqual(
        new Date(2030, 4, 19, 9)
      );
      expect(t.getPending()).toHaveLength(1);
    });

    test('follows the title of the row', async () => {
      const t = setup();
      t.cellReminders$.next([cellReminder]);
      await t.flush();

      t.database.children[0].text = { toString: () => 'Write the report' };
      t.yDoc.transact(() => {});
      await t.flush();

      expect(t.provider.schedule.mock.calls[1][0][0].title).toBe(
        'Write the report'
      );
    });

    test.each([
      [
        'the row is deleted',
        (t: ReturnType<typeof setup>) => {
          t.database.children.length = 0;
        },
      ],
      [
        'the column is deleted',
        (t: ReturnType<typeof setup>) => {
          t.database.props.columns.length = 0;
        },
      ],
      [
        'the date is cleared',
        (t: ReturnType<typeof setup>) => {
          t.database.props.cells['row-1']['due-col'].value = undefined;
        },
      ],
    ])('cancels the notification when %s', async (_name, change) => {
      const t = setup();
      t.cellReminders$.next([cellReminder]);
      await t.flush();
      expect(t.getPending()).toHaveLength(1);

      change(t);
      t.yDoc.transact(() => {});
      await t.flush();
      expect(t.getPending()).toHaveLength(0);
    });

    test('cancels the notification when the reminder is removed and releases the doc', async () => {
      const t = setup();
      t.cellReminders$.next([cellReminder]);
      await t.flush();
      t.cellReminders$.next([]);
      await t.flush();

      expect(t.getPending()).toHaveLength(0);
      expect(t.release).toHaveBeenCalledTimes(1);
    });

    test('leaves the notifications of a doc that is still loading alone', async () => {
      const t = setup();
      t.loadDocImmediately.value = false;
      t.setPending([
        {
          id: 5,
          extra: {
            kind: 'doc-reminder',
            workspaceId: 'ws',
            docId: 'doc-2',
            signature: 'old',
          },
        },
      ]);
      t.cellReminders$.next([cellReminder]);
      await t.flush();
      // a doc property reminder elsewhere still gets planned
      expect(t.provider.cancel).not.toHaveBeenCalled();
      expect(t.provider.schedule).not.toHaveBeenCalled();

      t.loadDocImmediately.value = true;
      t.docLoaded();
      await t.flush();
      expect(t.provider.schedule).toHaveBeenCalledTimes(1);
      expect(t.provider.cancel).toHaveBeenCalledWith([5]);
    });

    test('keeps working when the doc is gone', async () => {
      const t = setup();
      t.docsService.list.doc$ = () => ({ value: undefined }) as any;
      t.cellReminders$.next([cellReminder]);
      await t.flush();
      expect(t.docsService.open).not.toHaveBeenCalled();
      expect(t.provider.schedule).not.toHaveBeenCalled();
    });
  });

  describe('before everything is loaded', () => {
    test('does not cancel anything while the doc list is loading', async () => {
      const t = setup({ docsReady: false });
      t.setPending([
        {
          id: 5,
          extra: { kind: 'doc-reminder', workspaceId: 'ws', docId: 'doc-1' },
        },
      ]);
      await t.flush();
      expect(t.provider.getPending).not.toHaveBeenCalled();

      t.docsReady$.next(true);
      await t.flush();
      expect(t.provider.cancel).toHaveBeenCalledWith([5]);
    });

    test('waits for the reminders to load', async () => {
      const t = setup({ loading: true });
      await t.flush();
      expect(t.provider.getPending).not.toHaveBeenCalled();
    });
  });
});
