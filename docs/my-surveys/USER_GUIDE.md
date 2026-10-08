# My Surveys — staff guide

My Surveys lets any staff member build a survey, share it with colleagues, collect answers
through a link or QR code (respondents do **not** need an account), and see the results as
charts or export them to Excel/CSV.

You will find it in the sidebar, right under **My Presentations**.

## 1. Create a survey

- **New Survey** opens the builder with an empty survey.
- **Create from Template (CSV)** builds one from a spreadsheet (see section 4).
- **Duplicate** (⋮ menu) copies a survey you can see into a new Draft that you own, with no responses.

## 2. The builder

- Add questions with **Add question**. There are nine types: short answer, paragraph, multiple choice,
  checkboxes, dropdown, linear scale, rating, date and time.
- **Add section** starts a new section; every question below it belongs to it until the next section.
  Respondents see the section title as a short intro screen.
- Each question has a *Required* switch, optional help text, and buttons to move it up/down, duplicate or
  delete it. On a computer you can also drag it by the ⋮⋮ handle.
- **Data privacy consent** (near the top) makes respondents read and agree to a statement before they can
  start. The text is a template, not legal advice — edit it and have it checked by your data protection officer.
- Everything **saves automatically** (look for “All changes saved” under the title).
- **Preview** shows exactly what respondents will see, on a phone-sized or desktop-sized screen. Nothing you
  enter there is saved.

### Editing a survey that already has answers
You can keep improving a live survey. If you change the wording, type, scale or answer options of a question
that people have already answered, it is saved as a **new version**: earlier answers stay attached to the
version they answered, and the results and exports show the versions separately. Changing only “Required” or
the help text does not create a new version. Deleting a question that has answers keeps its answers (it is
marked “Removed from the survey” in the results).

### If two people edit at once
If a colleague saves while you are editing, you will see a banner naming them. Nothing is overwritten
silently: choose *Load their version* or *Keep my version*.

## 3. Publish, link and QR code

1. Open the survey and click **Publish**. Fix anything it lists (for example a question with no text).
2. You get a private link such as `…/s/k9thxttmh` and a QR code. Use **Copy link** or **Download QR (PNG)**.
3. Settings (same window): the message shown after submitting, an optional **closing date and time**, an
   optional **response limit**, and **one response per device**.
4. **Close survey** stops answers at any time; **Reopen survey** resumes it with the same link and QR code.

The survey closes **automatically** at its closing date or when the response limit is reached. Closed
surveys show respondents “This survey is no longer accepting responses”.

*One response per device* is based on the browser, so it discourages repeat answers but cannot stop someone
using another phone or a private window.

## 4. Create from a CSV template

1. **Create from Template (CSV) → Download Template** and open it in Excel or Google Sheets.
2. Keep row 1 (the column names). Replace the example rows with your questions — one per row. The
   instructions are at the bottom of the file (rows starting with `#` are ignored).
3. Save as **CSV (UTF-8)** and upload it. Every row is checked first; if anything is wrong you get a list by
   row number and **nothing is created**. If it passes, review the preview and create the Draft.

| Column | Meaning |
|---|---|
| `section` | Groups questions; a new section starts whenever the name changes (blank = same section) |
| `question_text` | The question |
| `question_type` | `short_answer`, `paragraph`, `multiple_choice`, `checkboxes`, `dropdown`, `linear_scale`, `rating`, `date`, `time` |
| `required` | `yes` or `no` |
| `options` | Choices separated by `\|` (at least 2) — for multiple choice, checkboxes, dropdown |
| `help_text` | Optional hint |
| `scale_min`, `scale_max`, `scale_min_label`, `scale_max_label` | For linear scales (0 or 1 up to 2–10); for a rating, `scale_max` is the number of stars (3–10) |

## 5. Share with colleagues

Open the survey and click **Share** (owner only), or use ⋮ → **Share** on the list.
Search by name or email and add people as:

- **Editor** — edit questions and settings, publish or close, view responses.
- **Viewer** — view the survey and its responses, nothing else.

Only the **owner** can delete the survey or manage sharing. Shared surveys appear under **Shared with me**.
A colleague can leave a survey with ⋮ → **Remove from my list**. Sharing controls which *staff* can open the
survey here; if it is published, anyone with the public link can still answer it.

## 6. Results and exports

- ⋮ → **View Responses** (or the **Responses** button in the builder) shows charts for every question:
  bars or a pie for choices, a distribution with the mean for scales and ratings, columns per date or per
  hour, and a list (or word cloud) of text answers. Charts update by themselves as responses arrive.
- **Export → Excel (.xlsx) or CSV** downloads one row per response with one column per question
  (a reworded question gets one column per version). The Excel file also has a *Questions* sheet describing
  each column. Respondents' device ids are never exported.
- The same charts and export are in **Research Project Monitoring → Survey Results**, where each survey you
  own (or that was shared with you) appears under **My Surveys**. Only the owner and the people it is shared
  with can see a survey's results — that rule is enforced by the database, not just the screen.

## 7. Good practice

- Ask for as little personal information as you need (Data Privacy Act of 2012).
- Open exported files from a trusted location and keep them with the same care as the survey itself.
  Text that begins with `=`, `+`, `-` or `@` is exported with a leading apostrophe so spreadsheets never run it as a formula.
