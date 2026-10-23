# The Rankings

rankings.matthewhearst.com: personal rankings, each with its own page and look.

A Cloudflare Worker serves everything:

- `public/` holds the pages: `index.html` (home), `takeaway/` (the takeaway ranking), `shared/rankings.js` (API calls, login, photo uploads shared by every ranking).
- `src/worker.js` holds the API: entries, edit history, photos (KV) and logins.
- `migrations/` holds the D1 database schema.

Adding a ranking: add its categories to `RANKINGS` in `src/worker.js`, then add a folder in `public/` with its own design, using `shared/rankings.js`.

## Who can edit

- The owner logs in with the permanent code and can do everything, including deleting spots and approving people.
- Anyone else enters their email under "Need a code?". The owner gets an email, approves them under Requests, and the site shows a one-time code plus the owner's draft email filled in (Open in Gmail / Copy email). The owner sends it by hand. Codes never expire, work once, and log in one device. An approved person who asks again is flagged "Wants a new code".
- Approved people can add and edit spots but not delete them. Edit history records who made each change; only the owner sees that.

The draft email is `verification-email.txt` (gitignored). Its first line is `Subject: ...`, and `{{code}}` and `{{link}}` are filled in. The Worker imports it, so it must exist to run or deploy.

## Running locally

```
npx wrangler@3.114.0 d1 migrations apply DB --local
npx wrangler@3.114.0 dev
```

`.dev.vars` (gitignored) sets `DEV_MODE = "1"`, which prints the owner's request emails in the terminal instead of sending them, and `PERMANENT_CODE`.
