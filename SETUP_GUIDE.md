# GATE ECE 2027 Tracker — Setup Guide (Google Sheets backend)

This system has three pieces that work together:

1. **`GATE_ECE_2027_Tracker.xlsx`** — the data. Import this into Google Sheets and
   it becomes your live database: Subjects, Topics, MockTests, StudyPlan, a
   formula-driven Dashboard, a hidden Lists sheet (the single source of truth
   for every dropdown), and an automatic ChangeLog.
2. **`Code.gs`** — a small Apps Script API that sits on top of the Sheet so the
   dashboard (and anyone else) can read and write data live, instead of editing
   cells by hand.
3. **`GATE_ECE_2027_Tracker.jsx`** — the dashboard UI. It polls the API every
   few seconds, so any edit — from you, a study partner, or directly in the
   Sheet — appears everywhere within seconds.

This is the same pattern real products use for a lightweight shared backend:
**spreadsheet = database, Apps Script = API layer, frontend = client.**

## Step 1 — Import the workbook into Google Sheets

1. Go to [sheets.google.com](https://sheets.google.com) → **File → Import → Upload**
   → select `GATE_ECE_2027_Tracker.xlsx`.
2. Choose **"Insert new sheet(s)"** so all tabs come in together.
3. Open the **README — Start Here** tab to confirm everything imported.

## Step 2 — Install the Apps Script backend

1. In the Sheet, go to **Extensions → Apps Script**.
2. Delete the placeholder `function myFunction(){}` code.
3. Paste in the entire contents of **`Code.gs`**.
4. Click the **Save** icon.
5. In the function dropdown at the top, select **`setupOnEditTrigger`** and
   click **Run** once. This makes manual edits made directly in the Sheet
   (not just edits from the dashboard) also get logged and synced. The first
   run will ask you to authorize the script — that's expected, it's your own
   script running on your own Sheet.

## Step 3 — Deploy it as a Web App

1. Click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone (so study partners can use it too — only
     people with the link can reach it, and it only exposes the fields you
     allow in `WRITABLE_FIELDS`)
4. Click **Deploy**, authorize again if asked, then **copy the Web app URL**.
   It looks like `https://script.google.com/macros/s/AKfycb.../exec`.

## Step 4 — Connect the dashboard

1. Open the dashboard (`GATE_ECE_2027_Tracker.jsx`) — paste it into a new
   Claude artifact, or drop it into any React project.
2. Go to the **Settings** tab inside the dashboard.
3. Paste the Web App URL and your name, then **Save & Connect**.
4. You should see the sync dot turn green ("Live") within a few seconds.

That's it — every status change, confidence rating, mock score, or note now
writes straight to the Sheet, and every connected dashboard picks it up
automatically.

## Sharing with study partners

- Share the Google Sheet itself with **Editor** access for anyone who should
  be able to edit cells directly.
- Give them the same dashboard + the same Web App URL — they paste it into
  their own Settings tab once, and they're live too.
- Every edit, from anyone, anywhere, is timestamped and attributed in the
  **ChangeLog** sheet.

## If something doesn't sync

- **"Not connected" never goes away** → double check the URL ends in `/exec`,
  not `/dev`.
- **Sync error after saving an edit** → open Apps Script → **Deploy → Manage
  deployments** and make sure you deployed a **new version** after any code
  change (editing `Code.gs` doesn't update a live deployment automatically).
- **Dropdown shows an unexpected value** → check the `Lists` sheet in Google
  Sheets; every dropdown in both the Sheet and the dashboard reads from there,
  so fixing it once fixes it everywhere.

## Updating the exam date or targets

Edit them directly in the **Config** sheet (`ExamDate`, `TargetAIR`,
`PYQTotalTarget`, `DailyStudyHoursTarget`) — the Dashboard sheet and the React
dashboard both read live from there, so nothing else needs to change.
