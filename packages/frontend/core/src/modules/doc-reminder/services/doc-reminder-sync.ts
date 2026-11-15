import { DebugLogger } from '@affine/debug';
import { I18n } from '@affine/i18n';
import { OnEvent, Service } from '@toeverything/infra';
import { combineLatest, debounceTime, map, of, switchMap } from 'rxjs';

import type { DocsService } from '../../doc';
import type { Workspace, WorkspaceService } from '../../workspace';
import { WorkspaceInitialized } from '../../workspace';
import type { WorkspacePropertyService } from '../../workspace-property';
import type {
  LocalNotificationProvider,
  LocalNotificationRequest,
} from '../providers/local-notification';
import type { DocReminderStore } from '../stores/doc-reminder';
import type { DocReminderOffset } from '../types';
import {
  diffNotifications,
  type PlannedReminder,
  planReminders,
  type ReminderSource,
} from '../utils';

const logger = new DebugLogger('doc-reminder-sync');

/**
 * iOS allows 64 pending local notifications for the whole app, keep some room
 * for other workspaces.
 */
const MAX_SCHEDULED_PER_WORKSPACE = 30;

const BODY_KEYS = {
  'on-day': 'com.affine.doc-reminder.notification.on-day',
  '1-day': 'com.affine.doc-reminder.notification.1-day',
  '2-days': 'com.affine.doc-reminder.notification.2-days',
  '1-week': 'com.affine.doc-reminder.notification.1-week',
} as const satisfies Record<DocReminderOffset, string>;

/**
 * Keeps the notifications scheduled on the device in sync with the reminders
 * of the opened workspace, so they fire even if the app is closed.
 */
@OnEvent(WorkspaceInitialized, s => s.onWorkspaceInitialized)
export class DocReminderSyncService extends Service {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly store: DocReminderStore,
    private readonly docsService: DocsService,
    private readonly workspacePropertyService: WorkspacePropertyService,
    private readonly provider?: LocalNotificationProvider
  ) {
    super();
  }

  private queue: Promise<unknown> = Promise.resolve();

  onWorkspaceInitialized(_workspace: Workspace) {
    if (!this.provider) return;

    const sources$ = combineLatest([
      this.store.watchReminders().asObservable(),
      this.docsService.list.docsMap$.asObservable(),
      this.workspacePropertyService.properties$.asObservable(),
    ]).pipe(
      switchMap(([reminders, docsMap, properties]) => {
        const sources = reminders.map(reminder => {
          const record = docsMap.get(reminder.docId);
          const property = properties.find(p => p.id === reminder.propertyId);
          if (!record || property?.type !== 'date') {
            return of(null);
          }
          return combineLatest([
            record.title$.asObservable(),
            record.trash$.asObservable(),
            record.customProperty$(reminder.propertyId).asObservable(),
          ]).pipe(
            map(([docTitle, trashed, dateValue]): ReminderSource => ({
              ...reminder,
              docTitle,
              trashed,
              dateValue,
              propertyName: property.name ?? '',
            }))
          );
        });
        return sources.length ? combineLatest(sources) : of([]);
      }),
      map(sources => sources.filter((s): s is ReminderSource => !!s)),
      debounceTime(500)
    );

    const subscription = sources$.subscribe(sources => {
      this.queue = this.queue
        .then(() => this.reconcile(sources))
        .catch(error => logger.error('failed to schedule reminders', error));
    });
    this.disposables.push(() => subscription.unsubscribe());
  }

  private toRequest(planned: PlannedReminder): LocalNotificationRequest {
    const workspaceId = this.workspaceService.workspace.id;
    const title =
      planned.docTitle || I18n['com.affine.doc-reminder.untitled-doc']();
    const body = I18n[BODY_KEYS[planned.offset]]({
      property: planned.propertyName,
    });
    return {
      id: planned.id,
      title,
      body,
      at: planned.at,
      extra: {
        kind: 'doc-reminder',
        workspaceId,
        docId: planned.docId,
        propertyId: planned.propertyId,
        signature: `${planned.at.getTime()}|${title}|${body}`,
      },
    };
  }

  private async reconcile(sources: ReminderSource[]) {
    const provider = this.provider;
    if (!provider) return;
    const workspaceId = this.workspaceService.workspace.id;

    const desired = planReminders({
      workspaceId,
      sources,
      now: new Date(),
      limit: MAX_SCHEDULED_PER_WORKSPACE,
    }).map(planned => this.toRequest(planned));

    // only touch what this workspace scheduled
    const pending = (await provider.getPending())
      .filter(
        n =>
          n.extra?.kind === 'doc-reminder' &&
          n.extra.workspaceId === workspaceId
      )
      .map(n => ({ id: n.id, signature: n.extra?.signature }));

    const { cancel, schedule } = diffNotifications(
      pending,
      desired.map(d => ({ ...d, signature: d.extra.signature }))
    );
    if (cancel.length) await provider.cancel(cancel);
    if (schedule.length) await provider.schedule(schedule);
  }
}
