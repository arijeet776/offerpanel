# Digi Sanchaar — Netlify (frontend) + Render (API) + Supabase

```
public/   -> Netlify  (static pages)         server.js + src/ -> Render (API + postback)
                          \________ Supabase (database) ________/
```

## Links your users and partners see (domain: offers.digisanchaar.online)
| Link | What it is |
|---|---|
| `/<campaign id>/<referral id>` | Offer page (prelander) — e.g. `/K7QX2M9B/REF1730000000123` |
| `/gen/<campaign id>` | Partner link generator, campaign already selected (`/gen` alone lets them pick) |
| `/referral` | Partner dashboard: wallet, withdrawals and a list of Date / Campaign ID / UPI (centre hidden) / events achieved / referral amount |
| `/tracker/<campaign id>` | Offer status tracker: the user types their UPI ID and sees each event (Install, KYC, …) and the Cashback Payout as Successful / Pending / Rejected, plus previous entries. Reads straight from Supabase (the old Google Apps Script tracker is no longer needed). |
| `/admin/DGSNR` | Admin panel (login still required) |

Old links (`/?cid=..&ref=..`, `/?page=gen`, `/?page=ref`) are redirected automatically, on Netlify and on the old Render URL.
To change the admin path, edit the `/admin/DGSNR` line in `public/_redirects`. `/admin.html` itself is blocked (404), so the panel opens only through that path. A hidden path is still only obscurity; the real protection is the admin login.
Campaign IDs are random 8-character codes, generated automatically for every new campaign and never re-used. Old IDs such as `CAMP_0001` keep working.

## Look & feel
Every page uses the same design as the offer page: `public/css/brand.css` (shared) + `public/css/admin.css` (admin only), logo `public/logo.png`, font Sora. Change a colour once in the `:root` block of `brand.css` and all pages follow.

## 1. Supabase
SQL Editor → paste `sql/schema.sql` → Run (safe to re-run on your existing project; it adds the wallet tables and functions).
**v4 update (per-campaign fields):** just re-run `sql/schema.sql` once; it adds the `collect_fields` column. Old campaigns keep asking Name + UPI exactly as before until you edit them.
**v5 update (unlimited events):** re-run `sql/schema.sql` once more **before** deploying the new backend. It adds `campaigns.events` / `conversions.events`, copies every old campaign and lead into them, and replaces the `record_event` function. Nothing is lost: the old `goal_name_1..3`, `payout_1..3` and `goal..goal3` columns are still filled for the first 3 events, so Google Sheets keeps working.
Already have live data? Then also run **once**: `sql/v2_migrate_existing_data.sql` (if you have not yet) and `sql/v3_backfill_existing_campaigns.sql` (read the comments first).
Copy Project URL + **service_role** key.

## 2. Render (backend)
New → Blueprint (`render.yaml`) or Web Service: build `npm install`, start `npm start`. Environment:
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ADMIN_PASSWORD`, `ADMIN_TOKEN_SECRET`, `ADMIN_COMPANY_NAME`,
**`FRONTEND_URL`** and **`PUBLIC_BASE_URL`** = `https://offers.digisanchaar.online`, `POSTBACK_SECRET` (long random), `MIN_WITHDRAWAL` (default 50),
`SHEETS_WEBHOOK_URL`, `SHEETS_SECRET`. Optional: `API_PUBLIC_URL` if the backend has its own domain (e.g. `https://api.digisanchaar.online`).
> Free Render plans sleep. A sleeping server can **miss a network postback**, so use the paid Starter plan for live traffic.

## 3. Netlify (frontend)
1. Open `public/js/config.js` and put your Render URL in `window.QX_API`.
2. Netlify → Add site → import the repo (publish directory `public`, already set in `netlify.toml`, no build command).
3. Domain settings → add custom domain `offers.digisanchaar.online` (a CNAME at your DNS to the Netlify site).
Never put the Supabase service key on Netlify.

## 4. Campaigns, events & postback
**Add Campaign** takes everything in one place: brand logo URL (with preview), tracking link, **Click ID macro** (you type the parameter name where our Click ID goes, e.g. `aff_sub1`), **details to collect from the user** (UPI ID is always asked; default is UPI + Mobile number, tick Name / Gmail only if that campaign needs them), **events with their own payout** (as many as the campaign needs, up to 20; payout can be 0), the "how to complete" steps (one per line, shown on the offer page) and partner rules. The Campaign ID is generated automatically.
Total payout = sum of the event payouts. Pick the number of events in the form and a name + payout row appears for each one. The user/partner split chosen on the link applies to every event in the same ratio.

**Postback:** All Campaigns → **Postback** shows ready URLs (one per event, plus one URL for all events) and the last 10 postbacks received. What we take from every postback:
1. **Advertiser's click ID** — `click_id={click_id}`, saved with the lead.
2. **Our Click ID** — comes back through the macro typed when the campaign was created (e.g. `aff_sub1={aff_sub1}`). If the network uses other macro names, rename only the part inside `{ }`.
3. **Event** — the URL carries `goal=<event name>`, or `goal={event}` if the network sends it. We read any of `goal, event, event_name, goal_name, goal_value, event_type, action` and use the first one that matches a campaign event (case, spaces and symbols ignored). Single-event campaigns accept any name; if a network sends no event at all, events are taken in order; an unknown name on a multi-event campaign is ignored (`IGNORED_UNKNOWN_EVENT`) so the wrong payout is never paid. Fix the event name in the campaign and have the network re-fire.
4. **Date & time** — never sent by networks: the moment the postback arrives is stored as the event time.
Example: `https://<render>/postback?click_id={click_id}&aff_sub1={aff_sub1}&goal=Install&cid=K7QX2M9B&key=SECRET`
Each event is added to the lead (with its time), its payout is added, and the partner's share goes into the wallet. A repeated event is ignored; events can arrive in any order. Every postback and its result is saved in `postback_log` (re-run `schema.sql` once to create it; entries older than 30 days are removed automatically).

## 5. Wallet & withdrawals
- Every successful lead credits the referrer's share to their wallet at once (shown on `/referral`).
- Partner presses **Withdraw** → one request at a time, minimum `MIN_WITHDRAWAL`, always paid to the UPI registered on the account.
- Admin → **Withdrawals**: Pay (enter the transaction ID) or Reject (amount returns to the wallet). Paid ones appear in the Payment Log.
- Payments screen: the referrer side shows "IN WALLET"; **Reverse** takes a wrongly credited amount back out (balance can go negative if already withdrawn).
- Admin pays only the **user** share from the Payments screen. A lead with several events can be paid in parts: the screen shows what is still due, and a later event after a full payment makes the new amount payable again. Overpaying or reusing a transaction ID is refused.

## 6. Deleting a finished campaign
All Campaigns → **Delete**. It shows what will be erased and removes the campaign, its clicks, conversions, referral links and user payment records from Supabase in one step (frees space on the free plan).
If user payouts are still unpaid you must type the campaign ID to confirm. Partner wallets and withdrawals are never deleted. Rows already sent to Google Sheets stay in the sheet as your archive.

## 7. Status tracker
`GET`-free and login-free: `POST /api/tracker/status` (latest attempt for that UPI + campaign) and `POST /api/tracker/history` (all attempts, every campaign). Each click is matched to its lead by the exact Click ID. Event steps turn green only when that event's postback really arrived (no guessing, no cascade). **Cashback Payout** turns green only after you mark the user as PAID in Payments; it shows Rejected if the user payout is rejected. Only progress is shown (no amounts, mobile or Gmail), and lookups are rate-limited.

## 8. Go-live checklist
1. Supabase: run `sql/schema.sql` once more (adds `postback_log`, part payments, removes old re-run traps). On live data also run the v2/v3 files once if you have not.
2. Render: set all environment variables (section 2), `ADMIN_COMPANY_NAME=Digi Sanchaar`, and use the Starter plan for live traffic.
3. Put your Render URL in `public/js/config.js` (`window.QX_API`), then deploy `public/` on Netlify.
4. Open **Postback** on a test campaign, give the URL to your network, fire a test conversion and check "Last 10 postbacks received".
5. Run `npm install` once and commit the generated `package-lock.json`.
6. Apps Script: set `SECRET` in `SheetsReceiver.gs` (same as `SHEETS_SECRET`) and redeploy the web app.
