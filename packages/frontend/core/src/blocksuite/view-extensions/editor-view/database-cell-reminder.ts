import { notify } from '@affine/component';
import {
  DOC_REMINDER_OFFSETS,
  type DocReminderOffset,
  DocReminderService,
} from '@affine/core/modules/doc-reminder';
import { I18n } from '@affine/i18n';
import {
  DatabaseCellReminderExtension,
  type DatabaseCellReminderService,
  type DatabaseCellReminderTarget,
} from '@blocksuite/affine/shared/services';
import type { ExtensionType } from '@blocksuite/affine/store';
import type { FrameworkProvider } from '@toeverything/infra';

const isOffset = (value: string): value is DocReminderOffset =>
  (DOC_REMINDER_OFFSETS as readonly string[]).includes(value);

/**
 * Adds the "Remind me" options to the date cells of database blocks. Reminders
 * are delivered as local notifications, so this does nothing in the apps that
 * can't schedule them.
 */
export function patchDatabaseCellReminderExtension(
  framework: FrameworkProvider
): ExtensionType[] {
  const reminderService = framework.getOptional(DocReminderService);
  if (!reminderService?.supported) return [];

  const createSignal = (target: DatabaseCellReminderTarget) =>
    reminderService.cellReminder$(target).map(r => r?.offset).signal;
  const signals = new Map<string, ReturnType<typeof createSignal>>();

  const service: DatabaseCellReminderService = {
    title: () => I18n['com.affine.doc-reminder.title'](),
    offLabel: () => I18n['com.affine.doc-reminder.off'](),
    options: () =>
      DOC_REMINDER_OFFSETS.map(offset => ({
        value: offset,
        label: I18n[`com.affine.doc-reminder.offset.${offset}`](),
      })),
    offset$: target => {
      const key = [
        target.docId,
        target.databaseBlockId,
        target.rowId,
        target.columnId,
      ].join(':');
      let offset$ = signals.get(key);
      if (!offset$) {
        offset$ = createSignal(target);
        signals.set(key, offset$);
      }
      return offset$;
    },
    setOffset: async (target, offset) => {
      if (offset === null) {
        reminderService.removeCellReminder(target);
        return;
      }
      if (!isOffset(offset)) return;
      const saved = await reminderService.setCellReminder({
        ...target,
        offset,
      });
      if (!saved) {
        notify.error({
          title: I18n['com.affine.doc-reminder.permission-denied'](),
        });
      }
    },
  };

  return [DatabaseCellReminderExtension(service)];
}
