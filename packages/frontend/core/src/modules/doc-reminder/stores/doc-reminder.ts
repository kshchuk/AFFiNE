import { LiveData, Store } from '@toeverything/infra';

import type { WorkspaceDBService } from '../../db';
import type { DocReminder } from '../types';

const toId = (docId: string, propertyId: string) => `${docId}:${propertyId}`;

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
}
