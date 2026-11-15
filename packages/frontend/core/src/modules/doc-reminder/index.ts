import type { Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { WorkspacePropertyService } from '../workspace-property';
import { LocalNotificationProvider } from './providers/local-notification';
import { DocReminderService } from './services/doc-reminder';
import { DocReminderSyncService } from './services/doc-reminder-sync';
import { DocReminderStore } from './stores/doc-reminder';

export {
  type LocalNotificationExtra,
  type LocalNotificationPermission,
  LocalNotificationProvider,
  type LocalNotificationRequest,
  type PendingLocalNotification,
} from './providers/local-notification';
export type {
  DatabaseCellReminder,
  DocReminder,
  DocReminderOffset,
} from './types';
export { DOC_REMINDER_OFFSETS } from './types';
export { DocReminderService };

export function configureDocReminderModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .store(DocReminderStore, [WorkspaceDBService])
    .service(
      DocReminderService,
      f =>
        new DocReminderService(
          f.get(DocReminderStore),
          f.getOptional(LocalNotificationProvider)
        )
    )
    .service(
      DocReminderSyncService,
      f =>
        new DocReminderSyncService(
          f.get(WorkspaceService),
          f.get(DocReminderStore),
          f.get(DocsService),
          f.get(WorkspacePropertyService),
          f.getOptional(LocalNotificationProvider)
        )
    );
}
