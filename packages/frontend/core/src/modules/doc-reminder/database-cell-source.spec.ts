import { LiveData } from '@toeverything/infra';
import { ReplaySubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

import {
  readDatabaseCellSource,
  watchDatabaseCellSources,
} from './database-cell-source';
import type { DatabaseCellReminder } from './types';

const reminder: DatabaseCellReminder = {
  docId: 'doc',
  databaseBlockId: 'db',
  rowId: 'row',
  columnId: 'due',
  offset: 'on-day',
};

function createDatabase() {
  return {
    props: {
      columns: [
        { id: 'due', type: 'date', name: 'Due Date' },
        { id: 'status', type: 'select', name: 'Status' },
      ],
      cells: {
        row: { due: { value: new Date(2030, 4, 10).getTime() } },
      } as Record<string, Record<string, { value?: unknown }>>,
    },
    children: [{ id: 'row', text: { toString: () => 'Write report' } }],
  };
}

const docWith = (database: unknown, flavour = 'affine:database') => ({
  getBlock: (id: string) => (id === 'db' ? { flavour, model: database } : null),
});

describe('readDatabaseCellSource', () => {
  test('reads the date, the title of the row and the name of the column', () => {
    expect(readDatabaseCellSource(docWith(createDatabase()), reminder)).toEqual(
      {
        propertyName: 'Due Date',
        rowTitle: 'Write report',
        dateValue: '2030-05-10',
      }
    );
  });

  test('has no date value for an empty cell', () => {
    const database = createDatabase();
    database.props.cells = {};
    expect(
      readDatabaseCellSource(docWith(database), reminder)?.dateValue
    ).toBeUndefined();
  });

  test('uses an empty title for a row without text', () => {
    const database = createDatabase();
    (database.children[0] as any).text = undefined;
    expect(readDatabaseCellSource(docWith(database), reminder)?.rowTitle).toBe(
      ''
    );
  });

  test.each([
    ['the block is gone', { ...reminder, databaseBlockId: 'other' }],
    ['the row is gone', { ...reminder, rowId: 'other' }],
    ['the column is gone', { ...reminder, columnId: 'other' }],
    ['the column is not a date', { ...reminder, columnId: 'status' }],
  ])('returns null when %s', (_name, target) => {
    expect(
      readDatabaseCellSource(docWith(createDatabase()), target)
    ).toBeNull();
  });

  test('returns null for a block that is not a database', () => {
    expect(
      readDatabaseCellSource(
        docWith(createDatabase(), 'affine:paragraph'),
        reminder
      )
    ).toBeNull();
  });
});

describe('watchDatabaseCellSources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const database = createDatabase();
    const yDoc = new YDoc();
    const records = new Map<string, any>([
      [
        'doc',
        {
          title$: new LiveData('Tasks'),
          trash$: new LiveData(false),
          meta$: new LiveData({}),
        },
      ],
    ]);
    const release = vi.fn();
    const open = vi.fn(() => ({
      doc: {
        blockSuiteDoc: {
          ready: true,
          load: () => {},
          getBlock: docWith(database).getBlock,
        },
        yDoc,
        addPriorityLoad: () => () => {},
        waitForSyncReady: () => Promise.resolve(),
      },
      release,
    }));
    const docsService = {
      list: { doc$: (id: string) => ({ value: records.get(id) }) },
      open,
    } as any;
    const reminders$ = new ReplaySubject<DatabaseCellReminder[]>(1);
    const results: any[] = [];
    const subscription = watchDatabaseCellSources(
      docsService,
      reminders$
    ).subscribe(value => results.push(value));
    return {
      database,
      yDoc,
      records,
      release,
      open,
      reminders$,
      results,
      subscription,
    };
  }

  test('emits nothing to read without reminders', async () => {
    const t = setup();
    t.reminders$.next([]);
    expect(t.results).toEqual([{ sources: [], unresolvedDocIds: [] }]);
    expect(t.open).not.toHaveBeenCalled();
  });

  test('reports the doc as unresolved until it is loaded', async () => {
    const t = setup();
    t.reminders$.next([reminder]);
    expect(t.results.at(0)).toEqual({ sources: [], unresolvedDocIds: ['doc'] });
    await vi.advanceTimersByTimeAsync(10);
    expect(t.results.at(-1)).toMatchObject({
      unresolvedDocIds: [],
      sources: [
        {
          docId: 'doc',
          propertyId: 'due',
          databaseBlockId: 'db',
          rowId: 'row',
          rowTitle: 'Write report',
          docTitle: 'Tasks',
          propertyName: 'Due Date',
          dateValue: '2030-05-10',
          offset: 'on-day',
          trashed: false,
        },
      ],
    });
  });

  test('emits again when the doc changes, debounced', async () => {
    const t = setup();
    t.reminders$.next([reminder]);
    await vi.advanceTimersByTimeAsync(10);
    const before = t.results.length;

    t.database.props.cells.row.due.value = new Date(2030, 5, 1).getTime();
    t.yDoc.transact(() => {});
    t.yDoc.transact(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.results.length).toBe(before + 1);
    expect(t.results.at(-1).sources[0].dateValue).toBe('2030-06-01');
  });

  test('reports a trashed doc', async () => {
    const t = setup();
    t.reminders$.next([reminder]);
    await vi.advanceTimersByTimeAsync(10);
    t.records.get('doc').trash$.next(true);
    t.records.get('doc').meta$.next({ trash: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.results.at(-1).sources[0].trashed).toBe(true);
  });

  test('opens a doc once for several reminders, and releases it', async () => {
    const t = setup();
    t.reminders$.next([reminder, { ...reminder, rowId: 'other-row' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.open).toHaveBeenCalledTimes(1);
    // the second row does not exist
    expect(t.results.at(-1).sources).toHaveLength(1);

    t.subscription.unsubscribe();
    expect(t.release).toHaveBeenCalledTimes(1);
  });

  test('does not reopen the doc when only its reminders change', async () => {
    const t = setup();
    t.reminders$.next([reminder]);
    await vi.advanceTimersByTimeAsync(10);
    t.reminders$.next([{ ...reminder, offset: '1-week' }]);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.open).toHaveBeenCalledTimes(1);
    expect(t.results.at(-1).sources[0].offset).toBe('1-week');
  });

  test('ignores a doc that does not exist anymore', async () => {
    const t = setup();
    t.records.delete('doc');
    t.reminders$.next([reminder]);
    await vi.advanceTimersByTimeAsync(10);
    expect(t.open).not.toHaveBeenCalled();
    expect(t.results.at(-1)).toEqual({ sources: [], unresolvedDocIds: [] });
  });
});
