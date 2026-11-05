-- Undo of supabase_migration_renewal_csr_testing_a_column.sql: removes the testing switch (run undo_renewal_csr_testing_b.sql first).
set lock_timeout = '5s';
alter table public.csr_settings drop column if exists testing_enabled;
