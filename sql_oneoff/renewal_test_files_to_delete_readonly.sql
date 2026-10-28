-- ─────────────────────────────────────────────────────────────
-- WHICH UPLOADED FILES OF THE RENEWAL TEST ARE LEFT IN STORAGE?   READ-ONLY.   Nothing is changed or deleted.
-- The revert removes database rows, not files. This lists the files the removed test rows pointed to (read from the holding copy), so you can delete them by hand:
-- Supabase dashboard > Storage > the bucket named in the first column > the path in the second column > delete.
-- ─────────────────────────────────────────────────────────────
select 'csr-issued' as bucket, b.row_data ->> 'storage_path' as path, 'certificate of ' || (b.row_data ->> 'scholar_id_number') as what
  from public._renewal_test_backup b where b.table_name = 'csr_issued' and b.row_data ->> 'storage_path' is not null
union all
select 'renewal-documents', b.row_data ->> 'storage_path', 'document of application ' || coalesce(b.row_data ->> 'record_id', '?')
  from public._renewal_test_backup b where b.table_name = 'renewal_documents' and b.row_data ->> 'storage_path' is not null
order by 1, 2;
