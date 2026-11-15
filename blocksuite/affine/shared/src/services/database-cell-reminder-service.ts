import { createIdentifier } from '@blocksuite/global/di';
import type { ExtensionType } from '@blocksuite/store';
import type { ReadonlySignal } from '@preact/signals-core';

/**
 * Points to a cell of a database block, which is the thing a reminder is
 * attached to.
 */
export interface DatabaseCellReminderTarget {
  docId: string;
  databaseBlockId: string;
  rowId: string;
  columnId: string;
}

export interface DatabaseCellReminderOption {
  /** the value passed to `setOffset` */
  value: string;
  label: string;
}

/**
 * Lets users get a notification before the date of a database cell.
 *
 * Only provided by the apps that can deliver notifications, when it is not
 * provided the date editor does not show the reminder options.
 */
export interface DatabaseCellReminderService {
  title: () => string;
  /** label of the option that turns the reminder off */
  offLabel: () => string;
  options: () => DatabaseCellReminderOption[];
  /** the selected option, `undefined` when there is no reminder */
  offset$: (
    target: DatabaseCellReminderTarget
  ) => ReadonlySignal<string | undefined>;
  /** `null` removes the reminder */
  setOffset: (
    target: DatabaseCellReminderTarget,
    offset: string | null
  ) => Promise<void>;
}

export const DatabaseCellReminderProvider =
  createIdentifier<DatabaseCellReminderService>('DatabaseCellReminderService');

export function DatabaseCellReminderExtension(
  service: DatabaseCellReminderService
): ExtensionType {
  return {
    setup: di => {
      di.addImpl(DatabaseCellReminderProvider, service);
    },
  };
}
