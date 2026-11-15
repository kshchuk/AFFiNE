import { MenuItem, MenuSeparator, notify } from '@affine/component';
import { DocService } from '@affine/core/modules/doc';
import {
  DOC_REMINDER_OFFSETS,
  type DocReminderOffset,
  DocReminderService,
} from '@affine/core/modules/doc-reminder';
import { I18n, useI18n } from '@affine/i18n';
import { useLiveData, useServiceOptional } from '@toeverything/infra';
import { useCallback, useMemo } from 'react';

/**
 * Lets the user get a notification on the device before the date of a `date`
 * doc property. Renders nothing where reminders can't be delivered (the web
 * and desktop apps) or when no date is selected.
 */
export const DateReminderMenuItems = ({
  propertyId,
  hasDate,
}: {
  propertyId: string;
  hasDate: boolean;
}) => {
  const t = useI18n();
  const docService = useServiceOptional(DocService);
  const reminderService = useServiceOptional(DocReminderService);
  const docId = docService?.doc.id;
  // a new LiveData is created on every call, keep it stable between renders
  const reminder$ = useMemo(
    () => (docId ? reminderService?.reminder$(docId, propertyId) : undefined),
    [docId, propertyId, reminderService]
  );
  const reminder = useLiveData(reminder$);

  const setOffset = useCallback(
    (offset: DocReminderOffset | null) => {
      if (!docId || !reminderService) return;
      if (offset === null) {
        reminderService.removeReminder(docId, propertyId);
        return;
      }
      reminderService
        .setReminder(docId, propertyId, offset)
        .then(saved => {
          if (!saved) {
            notify.error({
              title: I18n['com.affine.doc-reminder.permission-denied'](),
            });
          }
        })
        .catch(error => {
          console.error('Failed to set the reminder', error);
        });
    },
    [docId, propertyId, reminderService]
  );

  if (!docId || !reminderService?.supported || !hasDate) return null;

  return (
    <>
      <MenuSeparator />
      <MenuItem
        selected={!reminder}
        onSelect={e => {
          e.preventDefault();
          setOffset(null);
        }}
        data-testid="doc-reminder-off"
      >
        {t['com.affine.doc-reminder.off']()}
      </MenuItem>
      {DOC_REMINDER_OFFSETS.map(offset => (
        <MenuItem
          key={offset}
          selected={reminder?.offset === offset}
          onSelect={e => {
            e.preventDefault();
            setOffset(offset);
          }}
          data-testid={`doc-reminder-${offset}`}
        >
          {t[`com.affine.doc-reminder.offset.${offset}`]()}
        </MenuItem>
      ))}
    </>
  );
};
