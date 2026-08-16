# Attendance update deployment

1. In Supabase, open **SQL Editor**, create a new query, paste the entire
   contents of `supabase_migration_attendance_system.sql`, and run it once.
   This is required for single-use QR/number-code enforcement.
2. In GitHub, open the repository, choose **Add file > Upload files**, then
   drag the contents of this update folder into the browser. Replace files
   when GitHub asks. Do not upload `node_modules` or `dist`.
3. Commit the upload and let the normal Vercel/GitHub deployment complete.

What changed:

- The SDP checklist fetches every scholar, not only the first API response.
- A code is atomically redeemed once and repeat scans receive an error.
- Activity details and attendance are now separate tabs in SDP Monitoring.
- Staff can download a print-ready A4 QR-code PDF: 20 outlined QR codes per
  page, each labelled with the activity name, code, and code type.
- SDP monitors can permanently delete an SDP activity (with confirmation).
- Voucher attendance now generates one voucher per participant, supports
  1-, 2-, 4-, or 8-hour credits, and can generate additional vouchers for
  unexpected participants.
