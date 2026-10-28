-- Info tags that aren't scored, like a racquet's weight (4U) or balance. JSON {tag: value}.
ALTER TABLE entries ADD COLUMN tags TEXT NOT NULL DEFAULT '{}';
