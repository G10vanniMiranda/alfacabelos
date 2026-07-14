-- The application authenticates through server-side opaque sessions and accesses
-- PostgreSQL only through the backend. Supabase anon/authenticated must not read
-- or mutate application tables directly through PostgREST.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AdminAccess', 'AdminLoginAttempt', 'AdminSession', 'Barber',
    'BarberAvailability', 'BlockedSlot', 'Booking', 'Client', 'ClientSession',
    'GalleryImage', 'NotificationDelivery', 'PasswordResetToken',
    'SecurityRateLimitEvent', 'Service', '_prisma_migrations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    FOR policy_name IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
    END LOOP;

    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', table_name);
  END LOOP;
END $$;
