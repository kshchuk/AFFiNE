import type {
  LocalNotificationExtra,
  LocalNotificationPermission,
  LocalNotificationProvider,
} from '@affine/core/modules/doc-reminder';
import {
  LocalNotifications as CapacitorLocalNotifications,
  type LocalNotificationsPlugin,
} from '@capacitor/local-notifications';

type Plugin = Pick<
  LocalNotificationsPlugin,
  | 'checkPermissions'
  | 'requestPermissions'
  | 'getPending'
  | 'schedule'
  | 'cancel'
>;

const toPermission = (display: string): LocalNotificationPermission =>
  display === 'granted'
    ? 'granted'
    : display === 'denied'
      ? 'denied'
      : 'prompt';

/**
 * Delivers doc reminders as local notifications, the OS fires them even when
 * the app is closed, and no push server (APNs) is needed.
 */
export function createLocalNotificationProvider(
  plugin: Plugin = CapacitorLocalNotifications
): LocalNotificationProvider {
  return {
    checkPermission: async () =>
      toPermission((await plugin.checkPermissions()).display),
    requestPermission: async () =>
      toPermission((await plugin.requestPermissions()).display),
    getPending: async () => {
      const { notifications } = await plugin.getPending();
      return notifications.map(n => ({ id: n.id, extra: n.extra ?? null }));
    },
    schedule: async requests => {
      if (!requests.length) return;
      await plugin.schedule({
        notifications: requests.map(request => ({
          id: request.id,
          title: request.title,
          body: request.body,
          schedule: { at: request.at, allowWhileIdle: true },
          extra: request.extra,
        })),
      });
    },
    cancel: async ids => {
      if (!ids.length) return;
      await plugin.cancel({ notifications: ids.map(id => ({ id })) });
    },
  };
}

/**
 * Where to go when the user taps a reminder, `null` for any other notification.
 */
export function getReminderNotificationPath(
  extra: Partial<LocalNotificationExtra> | null | undefined
): string | null {
  if (extra?.kind !== 'doc-reminder' || !extra.workspaceId || !extra.docId) {
    return null;
  }
  return `/workspace/${encodeURIComponent(extra.workspaceId)}/${encodeURIComponent(extra.docId)}`;
}
