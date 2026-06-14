-- 1. Migrate existing reminders from PENDING to CREATED
update reminders
set status_id = (select id from reminder_statuses where code = 'CREATED')
where status_id = (select id from reminder_statuses where code = 'PENDING');

-- 2. Delete PENDING status from reminder_statuses
delete from reminder_statuses
where code = 'PENDING';
