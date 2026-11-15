import { Framework } from '@toeverything/infra';
import { describe, expect, test, vi } from 'vitest';

import type { LocalNotificationPermission } from '../providers/local-notification';
import { DocReminderService } from './doc-reminder';

function setup(
  current: LocalNotificationPermission,
  afterRequest: LocalNotificationPermission = 'granted',
  withProvider = true
) {
  const store = {
    setReminder: vi.fn(),
    removeReminder: vi.fn(),
    watchReminders: vi.fn(),
    watchReminder: vi.fn(),
    setCellReminder: vi.fn(),
    removeCellReminder: vi.fn(),
  };
  const provider = {
    checkPermission: vi.fn(async () => current),
    requestPermission: vi.fn(async () => afterRequest),
    getPending: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
  };
  const framework = new Framework();
  framework.service(
    DocReminderService,
    () =>
      new DocReminderService(store as any, withProvider ? provider : undefined)
  );
  return {
    store,
    provider,
    service: framework.provider().get(DocReminderService),
  };
}

describe('DocReminderService', () => {
  test('is not supported without a notification provider', async () => {
    const { service, store } = setup('granted', 'granted', false);
    expect(service.supported).toBe(false);
    expect(await service.setReminder('doc', 'prop', 'on-day')).toBe(false);
    expect(store.setReminder).not.toHaveBeenCalled();
  });

  test('saves the reminder when notifications are allowed', async () => {
    const { service, store, provider } = setup('granted');
    expect(service.supported).toBe(true);
    expect(await service.setReminder('doc', 'prop', '1-day')).toBe(true);
    expect(provider.requestPermission).not.toHaveBeenCalled();
    expect(store.setReminder).toHaveBeenCalledWith({
      docId: 'doc',
      propertyId: 'prop',
      offset: '1-day',
    });
  });

  test('asks for permission the first time', async () => {
    const { service, store, provider } = setup('prompt', 'granted');
    expect(await service.setReminder('doc', 'prop', 'on-day')).toBe(true);
    expect(provider.requestPermission).toHaveBeenCalledTimes(1);
    expect(store.setReminder).toHaveBeenCalled();
  });

  test('saves nothing when the user denies notifications', async () => {
    const denied = setup('prompt', 'denied');
    expect(await denied.service.setReminder('doc', 'prop', 'on-day')).toBe(
      false
    );
    expect(denied.store.setReminder).not.toHaveBeenCalled();

    const alreadyDenied = setup('denied');
    expect(
      await alreadyDenied.service.setReminder('doc', 'prop', 'on-day')
    ).toBe(false);
    expect(alreadyDenied.provider.requestPermission).not.toHaveBeenCalled();
  });

  test('removes a reminder', () => {
    const { service, store } = setup('granted');
    service.removeReminder('doc', 'prop');
    expect(store.removeReminder).toHaveBeenCalledWith('doc', 'prop');
  });

  describe('database cells', () => {
    const cell = {
      docId: 'doc',
      databaseBlockId: 'db',
      rowId: 'row',
      columnId: 'col',
    };

    test('saves the reminder when notifications are allowed', async () => {
      const { service, store, provider } = setup('prompt', 'granted');
      expect(await service.setCellReminder({ ...cell, offset: '1-day' })).toBe(
        true
      );
      expect(provider.requestPermission).toHaveBeenCalledTimes(1);
      expect(store.setCellReminder).toHaveBeenCalledWith({
        ...cell,
        offset: '1-day',
      });
    });

    test('saves nothing when the user denies notifications', async () => {
      const { service, store } = setup('denied');
      expect(await service.setCellReminder({ ...cell, offset: '1-day' })).toBe(
        false
      );
      expect(store.setCellReminder).not.toHaveBeenCalled();
    });

    test('removes a reminder', () => {
      const { service, store } = setup('granted');
      service.removeCellReminder(cell);
      expect(store.removeCellReminder).toHaveBeenCalledWith(cell);
    });
  });
});
