import { Service } from '@toeverything/infra';

import type { LocalNotificationProvider } from '../providers/local-notification';
import type { DocReminderStore } from '../stores/doc-reminder';
import type { DatabaseCellReminder, DocReminderOffset } from '../types';

export class DocReminderService extends Service {
  constructor(
    private readonly store: DocReminderStore,
    private readonly provider?: LocalNotificationProvider
  ) {
    super();
  }

  /**
   * Reminders are delivered as local notifications, which are only available
   * in the native apps.
   */
  readonly supported = !!this.provider;

  reminders$ = this.store.watchReminders();

  reminder$(docId: string, propertyId: string) {
    return this.store.watchReminder(docId, propertyId);
  }

  private async ensurePermission(): Promise<boolean> {
    if (!this.provider) return false;
    let permission = await this.provider.checkPermission();
    if (permission === 'prompt') {
      permission = await this.provider.requestPermission();
    }
    return permission === 'granted';
  }

  /**
   * Returns `false` when the user did not allow notifications, in which case
   * nothing is saved.
   */
  async setReminder(
    docId: string,
    propertyId: string,
    offset: DocReminderOffset
  ): Promise<boolean> {
    if (!(await this.ensurePermission())) return false;
    this.store.setReminder({ docId, propertyId, offset });
    return true;
  }

  removeReminder(docId: string, propertyId: string) {
    this.store.removeReminder(docId, propertyId);
  }

  cellReminder$(target: Omit<DatabaseCellReminder, 'offset'>) {
    return this.store.watchCellReminder(target);
  }

  /**
   * Returns `false` when the user did not allow notifications, in which case
   * nothing is saved.
   */
  async setCellReminder(reminder: DatabaseCellReminder): Promise<boolean> {
    if (!(await this.ensurePermission())) return false;
    this.store.setCellReminder(reminder);
    return true;
  }

  removeCellReminder(target: Omit<DatabaseCellReminder, 'offset'>) {
    this.store.removeCellReminder(target);
  }
}
