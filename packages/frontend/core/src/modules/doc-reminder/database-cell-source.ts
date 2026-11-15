import { debounce, isEqual } from 'lodash-es';
import {
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  switchMap,
} from 'rxjs';

import type { DocsService } from '../doc';
import type { DatabaseCellReminder } from './types';
import { formatCellDate, type ReminderSource } from './utils';

/**
 * The parts of a database block that are needed to read a cell.
 */
interface DatabaseModelLike {
  props: {
    columns: Array<{ id: string; type: string; name: string }>;
    cells: Record<string, Record<string, { value?: unknown } | undefined>>;
  };
  children: Array<{ id: string; text?: { toString: () => string } | null }>;
}

interface BlockSuiteDocLike {
  getBlock: (
    id: string
  ) => { flavour: string; model: unknown } | null | undefined;
}

export type DatabaseCellSource = Pick<
  ReminderSource,
  'propertyName' | 'rowTitle' | 'dateValue'
>;

/**
 * Read the date of a database cell without rendering the database.
 *
 * Returns `null` when the cell is gone: the database block, the row or the
 * column was deleted, or the column is not a date column anymore.
 */
export function readDatabaseCellSource(
  doc: BlockSuiteDocLike,
  reminder: Pick<DatabaseCellReminder, 'databaseBlockId' | 'rowId' | 'columnId'>
): DatabaseCellSource | null {
  const block = doc.getBlock(reminder.databaseBlockId);
  if (block?.flavour !== 'affine:database') return null;
  const model = block.model as DatabaseModelLike;

  const column = model.props.columns.find(c => c.id === reminder.columnId);
  if (column?.type !== 'date') return null;

  const row = model.children.find(c => c.id === reminder.rowId);
  if (!row) return null;

  return {
    propertyName: column.name,
    rowTitle: row.text?.toString() ?? '',
    dateValue: formatCellDate(
      model.props.cells[reminder.rowId]?.[reminder.columnId]?.value
    ),
  };
}

export interface DatabaseCellSources {
  sources: ReminderSource[];
  /**
   * Docs that are not loaded yet. Nothing is known about their reminders, the
   * notifications of these docs must be left alone.
   */
  unresolvedDocIds: string[];
}

type DocState =
  | { status: 'loading' }
  | { status: 'missing' }
  | {
      status: 'ready';
      doc: BlockSuiteDocLike;
      docTitle: string;
      trashed: boolean;
    };

const CHANGE_DEBOUNCE_MS = 500;

/**
 * Open the doc in the background, and emit whenever its content changed.
 * The doc is released when unsubscribed.
 */
function watchDoc(docsService: DocsService, docId: string) {
  return new Observable<DocState>(subscriber => {
    const record = docsService.list.doc$(docId).value;
    if (!record) {
      subscriber.next({ status: 'missing' });
      return;
    }
    subscriber.next({ status: 'loading' });

    let ref: ReturnType<DocsService['open']>;
    try {
      ref = docsService.open(docId);
    } catch (error) {
      console.error('failed to open the doc of a reminder', error);
      subscriber.next({ status: 'missing' });
      return;
    }
    const { doc } = ref;
    if (!doc.blockSuiteDoc.ready) {
      doc.blockSuiteDoc.load();
    }
    const disposePriorityLoad = doc.addPriorityLoad(10);

    let disposed = false;
    const emit = () => {
      if (disposed) return;
      subscriber.next({
        status: 'ready',
        doc: doc.blockSuiteDoc,
        docTitle: record.title$.value,
        trashed: record.trash$.value,
      });
    };
    const emitDebounced = debounce(emit, CHANGE_DEBOUNCE_MS);

    let metaSubscription: { unsubscribe: () => void } | undefined;
    doc
      .waitForSyncReady()
      .then(() => {
        if (disposed) return;
        emit();
        // changes of the cells, from this device or synced from others
        doc.yDoc.on('afterTransaction', emitDebounced);
        metaSubscription = record.meta$.asObservable().subscribe(emitDebounced);
      })
      .catch(error => {
        console.error('failed to load the doc of a reminder', error);
      });

    return () => {
      disposed = true;
      emitDebounced.cancel();
      doc.yDoc.off('afterTransaction', emitDebounced);
      metaSubscription?.unsubscribe();
      disposePriorityLoad();
      ref.release();
    };
  });
}

/**
 * The date, title and so on of every database cell that has a reminder.
 * Docs are opened in the background to read their cells, only the docs that
 * have reminders are opened.
 */
export function watchDatabaseCellSources(
  docsService: DocsService,
  reminders$: Observable<DatabaseCellReminder[]>
): Observable<DatabaseCellSources> {
  const docIds$: Observable<string[]> = reminders$.pipe(
    map(reminders => [...new Set(reminders.map(r => r.docId))].sort()),
    distinctUntilChanged(isEqual)
  );

  return docIds$.pipe(
    switchMap((docIds): Observable<DatabaseCellSources> => {
      if (!docIds.length) {
        return of<DatabaseCellSources>({ sources: [], unresolvedDocIds: [] });
      }
      return combineLatest(
        docIds.map(docId => {
          const remindersOfDoc$ = reminders$.pipe(
            map(reminders => reminders.filter(r => r.docId === docId)),
            distinctUntilChanged(isEqual)
          );
          return combineLatest([
            watchDoc(docsService, docId),
            remindersOfDoc$,
          ]).pipe(map(([state, reminders]) => ({ docId, state, reminders })));
        })
      ).pipe(
        map(docs => {
          const sources: ReminderSource[] = [];
          const unresolvedDocIds: string[] = [];
          for (const { docId, state, reminders } of docs) {
            if (state.status === 'loading') {
              unresolvedDocIds.push(docId);
              continue;
            }
            if (state.status === 'missing') continue;
            for (const reminder of reminders) {
              const cell = readDatabaseCellSource(state.doc, reminder);
              if (!cell) continue;
              sources.push({
                ...cell,
                docId,
                propertyId: reminder.columnId,
                databaseBlockId: reminder.databaseBlockId,
                rowId: reminder.rowId,
                offset: reminder.offset,
                docTitle: state.docTitle,
                trashed: state.trashed,
              });
            }
          }
          return { sources, unresolvedDocIds };
        })
      );
    })
  );
}
