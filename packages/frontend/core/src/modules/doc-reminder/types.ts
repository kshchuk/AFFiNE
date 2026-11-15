export const DOC_REMINDER_OFFSETS = [
  'on-day',
  '1-day',
  '2-days',
  '1-week',
] as const;

export type DocReminderOffset = (typeof DOC_REMINDER_OFFSETS)[number];

export const DOC_REMINDER_OFFSET_DAYS: Record<DocReminderOffset, number> = {
  'on-day': 0,
  '1-day': 1,
  '2-days': 2,
  '1-week': 7,
};

/**
 * Date properties have no time part, reminders fire at this local hour.
 */
export const DOC_REMINDER_HOUR = 9;

export interface DocReminder {
  docId: string;
  propertyId: string;
  offset: DocReminderOffset;
}
