import { LiveData, Store } from '@toeverything/infra';
import { combineLatest, map } from 'rxjs';

import type { WorkspaceDBService } from '../../db';
import type { DatabaseCellReminder, DocReminder } from '../types';

const toId = (docId: string, propertyId: string) => `${docId}:${propertyId}`;

type CellTarget = Omit<DatabaseCellReminder, 'offset'>;

const toCellId = ({ docId, databaseBlockId, rowId, columnId }: CellTarget) =>
  `${docId}:${databaseBlockId}:${rowId}:${columnId}`;

const toCellReminder = (row: DatabaseCellReminder): DatabaseCellReminder => ({
  docId: row.docId,
  databaseBlockId: row.databaseBlockId,
  rowId: row.rowId,
  columnId: row.columnId,
  offset: row.offset,
});

export class DocReminderStore extends Store {
  constructor(private readonly workspaceDBService: WorkspaceDBService) {
    super();
  }

  watchReminders() {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.docReminder.find$(), []))
      .flat()
      .map(rows =>
        rows.map((row): DocReminder => ({
          docId: row.docId,
          propertyId: row.propertyId,
          offset: row.offset,
        }))
      );
  }

  watchReminder(docId: string, propertyId: string) {
    return this.workspaceDBService.userdataDB$
      .map(db =>
        LiveData.from(db.docReminder.get$(toId(docId, propertyId)), undefined)
      )
      .flat()
      .map((row): DocReminder | undefined =>
        row
          ? { docId: row.docId, propertyId: row.propertyId, offset: row.offset }
          : undefined
      );
  }

  setReminder({ docId, propertyId, offset }: DocReminder) {
    const table = this.workspaceDBService.userdataDB$.value.docReminder;
    const id = toId(docId, propertyId);
    if (table.get(id)) {
      table.update(id, { offset });
    } else {
      table.create({ id, docId, propertyId, offset });
    }
  }

  removeReminder(docId: string, propertyId: string) {
    this.workspaceDBService.userdataDB$.value.docReminder.delete(
      toId(docId, propertyId)
    );
  }

  /**
   * `true` until the reminders are loaded, an empty list is not trustworthy
   * before that.
   */
  watchLoading() {
    return this.workspaceDBService.userdataDB$
      .map(db =>
        LiveData.from(
          combineLatest([
            db.docReminder.isLoading$.asObservable(),
            db.databaseCellReminder.isLoading$.asObservable(),
          ]).pipe(map(([a, b]) => a || b)),
          true
        )
      )
      .flat();
  }

  watchCellReminders() {
    return this.workspaceDBService.userdataDB$
      .map(db => LiveData.from(db.databaseCellReminder.find$(), []))
      .flat()
      .map(rows => rows.map(toCellReminder));
  }

  watchCellReminder(target: CellTarget) {
    return this.workspaceDBService.userdataDB$
      .map(db =>
        LiveData.from(db.databaseCellReminder.get$(toCellId(target)), undefined)
      )
      .flat()
      .map(row => (row ? toCellReminder(row) : undefined));
  }

  setCellReminder(reminder: DatabaseCellReminder) {
    const table =
      this.workspaceDBService.userdataDB$.value.databaseCellReminder;
    const id = toCellId(reminder);
    if (table.get(id)) {
      table.update(id, { offset: reminder.offset });
    } else {
      table.create({ id, ...reminder });
    }
  }

  removeCellReminder(target: CellTarget) {
    this.workspaceDBService.userdataDB$.value.databaseCellReminder.delete(
      toCellId(target)
    );
  }
}
