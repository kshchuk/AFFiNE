import { DatabaseCellReminderProvider } from '@blocksuite/affine-shared/services';
import { signal } from '@preact/signals-core';
import { describe, expect, it, vi } from 'vitest';

import { DateCell } from '../property-presets/date/cell-renderer.js';

customElements.define('test-date-cell', DateCell);

const reminderService = {
  title: () => 'Remind me',
  offLabel: () => "Don't remind",
  options: () => [{ value: 'on-day', label: 'On the day' }],
  offset$: vi.fn(() => signal<string | undefined>(undefined)),
  setOffset: vi.fn(async () => {}),
};

function createCell(options: {
  service?: typeof reminderService;
  locator?: { docId: string; blockId: string };
  value?: number;
}) {
  const element = document.createElement('test-date-cell') as DateCell;
  element.cell = {
    rowId: 'row',
    property: { id: 'due' },
    value$: signal(options.value),
    view: {
      serviceGet: (key: unknown) =>
        key === DatabaseCellReminderProvider ? (options.service ?? null) : null,
      manager: { dataSource: { locator: options.locator } },
    },
  } as any;
  return element;
}

const menuItem = (cell: DateCell) =>
  (cell as any).reminderMenuItem() as ((...args: any[]) => unknown) | undefined;

describe('date cell reminder', () => {
  const locator = { docId: 'doc', blockId: 'db' };

  it('has no reminder option when the app can not deliver notifications', () => {
    expect(menuItem(createCell({ locator }))).toBeUndefined();
  });

  it('has no reminder option when the data is not stored in a doc', () => {
    expect(menuItem(createCell({ service: reminderService }))).toBeUndefined();
  });

  it('offers the reminder for the cell of the database', () => {
    const item = menuItem(
      createCell({ service: reminderService, locator, value: Date.now() })
    );
    expect(item).toBeTypeOf('function');
    expect(reminderService.offset$).toHaveBeenCalledWith({
      docId: 'doc',
      databaseBlockId: 'db',
      rowId: 'row',
      columnId: 'due',
    });
  });

  it('hides the reminder option while the cell has no date', () => {
    const item = menuItem(createCell({ service: reminderService, locator }));
    const menu = { search: () => true } as any;
    expect(item?.(menu, 0)).toBeUndefined();
  });

  it('shows the reminder option once the cell has a date', () => {
    const item = menuItem(
      createCell({ service: reminderService, locator, value: Date.now() })
    );
    const menu = { search: () => true } as any;
    expect(item?.(menu, 0)).toBeDefined();
  });
});
