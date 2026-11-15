import {
  createORMClient,
  Framework,
  LiveData,
  YjsDBAdapter,
} from '@toeverything/infra';
import { describe, expect, test } from 'vitest';
import { Doc as YDoc } from 'yjs';

import { AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA } from '../../db/schema';
import { DocReminderStore } from './doc-reminder';

const Client = createORMClient(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA);

function setup() {
  const db = new Client(
    new YjsDBAdapter(AFFiNE_WORKSPACE_USERDATA_DB_SCHEMA, {
      getDoc: guid => new YDoc({ guid }),
    })
  );
  const framework = new Framework();
  framework.store(
    DocReminderStore,
    () => new DocReminderStore({ userdataDB$: new LiveData(db) } as any)
  );
  return framework.provider().get(DocReminderStore);
}

describe('DocReminderStore', () => {
  test('creates, updates and removes a reminder', () => {
    const store = setup();
    const list = store.watchReminders();
    const single = store.watchReminder('doc', 'prop');
    list.subscribe(() => {});
    single.subscribe(() => {});
    expect(list.value).toEqual([]);

    store.setReminder({ docId: 'doc', propertyId: 'prop', offset: '1-day' });
    expect(list.value).toEqual([
      { docId: 'doc', propertyId: 'prop', offset: '1-day' },
    ]);
    expect(single.value).toEqual({
      docId: 'doc',
      propertyId: 'prop',
      offset: '1-day',
    });

    // one reminder per doc and property
    store.setReminder({ docId: 'doc', propertyId: 'prop', offset: '1-week' });
    expect(list.value).toHaveLength(1);
    expect(single.value?.offset).toBe('1-week');

    store.removeReminder('doc', 'prop');
    expect(list.value).toEqual([]);
    expect(single.value).toBeUndefined();
  });

  test('keeps reminders of different properties apart', () => {
    const store = setup();
    store.setReminder({ docId: 'doc', propertyId: 'a', offset: 'on-day' });
    store.setReminder({ docId: 'doc', propertyId: 'b', offset: '2-days' });
    store.removeReminder('doc', 'a');
    const list = store.watchReminders();
    list.subscribe(() => {});
    expect(list.value).toEqual([
      { docId: 'doc', propertyId: 'b', offset: '2-days' },
    ]);
  });
});
