import { describe, expect, test, vi } from 'vitest';

import {
  createLocalNotificationProvider,
  getReminderNotificationPath,
} from './index';

const createPlugin = () => ({
  checkPermissions: vi.fn(async () => ({ display: 'prompt' as const })),
  requestPermissions: vi.fn(async () => ({ display: 'granted' as const })),
  getPending: vi.fn(async () => ({
    notifications: [{ id: 1, extra: { kind: 'doc-reminder' } }, { id: 2 }],
  })),
  schedule: vi.fn(async () => ({ notifications: [] })),
  cancel: vi.fn(async () => {}),
});

describe('createLocalNotificationProvider', () => {
  test('maps permissions', async () => {
    const plugin = createPlugin();
    const provider = createLocalNotificationProvider(plugin as any);
    expect(await provider.checkPermission()).toBe('prompt');
    expect(await provider.requestPermission()).toBe('granted');
    plugin.checkPermissions.mockResolvedValueOnce({
      display: 'prompt-with-rationale' as any,
    });
    expect(await provider.checkPermission()).toBe('prompt');
    plugin.checkPermissions.mockResolvedValueOnce({ display: 'denied' as any });
    expect(await provider.checkPermission()).toBe('denied');
  });

  test('returns pending notifications with their extra', async () => {
    const provider = createLocalNotificationProvider(createPlugin() as any);
    expect(await provider.getPending()).toEqual([
      { id: 1, extra: { kind: 'doc-reminder' } },
      { id: 2, extra: null },
    ]);
  });

  test('schedules and cancels, skipping empty calls', async () => {
    const plugin = createPlugin();
    const provider = createLocalNotificationProvider(plugin as any);
    await provider.schedule([]);
    await provider.cancel([]);
    expect(plugin.schedule).not.toHaveBeenCalled();
    expect(plugin.cancel).not.toHaveBeenCalled();

    const at = new Date(2030, 0, 2, 9);
    const extra = {
      kind: 'doc-reminder' as const,
      workspaceId: 'w',
      docId: 'd',
      propertyId: 'p',
      signature: 's',
    };
    await provider.schedule([{ id: 7, title: 't', body: 'b', at, extra }]);
    expect(plugin.schedule).toHaveBeenCalledWith({
      notifications: [
        {
          id: 7,
          title: 't',
          body: 'b',
          schedule: { at, allowWhileIdle: true },
          extra,
        },
      ],
    });
    await provider.cancel([7, 8]);
    expect(plugin.cancel).toHaveBeenCalledWith({
      notifications: [{ id: 7 }, { id: 8 }],
    });
  });
});

describe('getReminderNotificationPath', () => {
  test('builds the doc path', () => {
    expect(
      getReminderNotificationPath({
        kind: 'doc-reminder',
        workspaceId: 'ws 1',
        docId: 'doc',
      })
    ).toBe('/workspace/ws%201/doc');
  });

  test('ignores other notifications', () => {
    expect(getReminderNotificationPath(null)).toBeNull();
    expect(getReminderNotificationPath({})).toBeNull();
    expect(
      getReminderNotificationPath({ kind: 'doc-reminder', docId: 'd' })
    ).toBeNull();
  });
});
