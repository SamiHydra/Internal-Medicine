-- After creating one temporary auth user in Supabase Authentication > Users,
-- run this script in Supabase SQL Editor to promote that user to admin.
--
-- Replace these values before running:
--   bootstrap@example.com
--   Bootstrap Admin
--   bootstrap.admin
--
-- Important:
-- If you want the full hidden superadmin flow with usernames, run
-- supabase/migrations/202604060002_superadmin_admin_setup.sql first.
-- This script is written to work even if that migration has not been applied yet.

do $$
declare
  v_email text := lower('samthegoat@gmal.com');
  v_full_name text := 'Bootstrap Admin';
  v_username text := 'bootstrap.admin';
  v_has_username boolean;
begin
  select exists (
    select 1
    from auth.users auth_user
    where lower(auth_user.email) = v_email
  )
  into strict v_has_username;

  if not v_has_username then
    raise exception 'No auth user exists for %', v_email;
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'username'
  )
  into v_has_username;

  if v_has_username then
    insert into public.profiles (
      id,
      role_key,
      email,
      username,
      full_name,
      title,
      active
    )
    select
      auth_user.id,
      'admin',
      lower(auth_user.email),
      lower(v_username),
      v_full_name,
      'Administrator',
      true
    from auth.users auth_user
    where lower(auth_user.email) = v_email
    on conflict (id) do update
    set role_key = 'admin',
        email = excluded.email,
        username = excluded.username,
        full_name = excluded.full_name,
        title = excluded.title,
        active = true,
        updated_at = timezone('utc', now());
  else
    insert into public.profiles (
      id,
      role_key,
      email,
      full_name,
      title,
      active
    )
    select
      auth_user.id,
      'admin',
      lower(auth_user.email),
      v_full_name,
      'Administrator',
      true
    from auth.users auth_user
    where lower(auth_user.email) = v_email
    on conflict (id) do update
    set role_key = 'admin',
        email = excluded.email,
        full_name = excluded.full_name,
        title = excluded.title,
        active = true,
        updated_at = timezone('utc', now());
  end if;
end
$$;
