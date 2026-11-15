import { createIdentifier } from '@toeverything/infra';

export type LocalNotificationPermission = 'granted' | 'denied' | 'prompt';

export interface LocalNotificationExtra {
  kind: 'doc-reminder';
  workspaceId: string;
  docId: string;
  /** id of the doc property, or of the column for a database cell */
  propertyId: string;
  /** set when the reminder is for a cell of a database block */
  databaseBlockId?: string;
  rowId?: string;
  /** changes whenever the scheduled content or time changes */
  signature: string;
}

export interface LocalNotificationRequest {
  /** 32-bit signed integer */
  id: number;
  title: string;
  body: string;
  at: Date;
  extra: LocalNotificationExtra;
}

export interface PendingLocalNotification {
  id: number;
  /** the `extra` that was passed when scheduling, if any */
  extra?: Partial<LocalNotificationExtra> | null;
}

/**
 * Schedules notifications on the device, they are delivered by the OS even
 * when the app is not running. Only implemented by the native apps.
 */
export interface LocalNotificationProvider {
  checkPermission: () => Promise<LocalNotificationPermission>;
  requestPermission: () => Promise<LocalNotificationPermission>;
  getPending: () => Promise<PendingLocalNotification[]>;
  schedule: (requests: LocalNotificationRequest[]) => Promise<void>;
  cancel: (ids: number[]) => Promise<void>;
}

export const LocalNotificationProvider =
  createIdentifier<LocalNotificationProvider>('LocalNotificationProvider');
