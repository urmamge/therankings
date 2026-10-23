-- Kit the owner is using right now, shown in "In my bag" on the badminton page.
ALTER TABLE entries ADD COLUMN in_bag INTEGER NOT NULL DEFAULT 0;
