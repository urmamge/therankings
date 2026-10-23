-- An approved person who asks again (say, on a new phone) is flagged for the owner to send a new code.
ALTER TABLE access_requests ADD COLUMN wants_code INTEGER NOT NULL DEFAULT 0;
