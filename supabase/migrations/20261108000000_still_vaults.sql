-- Private ciphertext for one confirmed Supabase user.
-- Authorization uses auth.uid() only. user_metadata is not consulted.
-- anon has no privileges. authenticated cannot delete a row.

create table public.still_vaults (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 0,
  iv text not null,
  ciphertext text not null,
  wrapped_iv text not null,
  wrapped_ct text not null,
  updated_at timestamptz not null default now(),
  constraint still_vaults_ciphertext_present check (char_length(iv) > 8 and char_length(ciphertext) > 16),
  constraint still_vaults_wrapped_present check (char_length(wrapped_iv) > 8 and char_length(wrapped_ct) > 8),
  constraint still_vaults_revision_nonnegative check (revision >= 0)
);

alter table public.still_vaults enable row level security;

revoke all on table public.still_vaults from public;
revoke all on table public.still_vaults from anon;
revoke all on table public.still_vaults from authenticated;
grant select, insert, update on table public.still_vaults to authenticated;

create policy still_vaults_select
  on public.still_vaults
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy still_vaults_insert
  on public.still_vaults
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy still_vaults_update
  on public.still_vaults
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.still_vaults_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or new.user_id is distinct from auth.uid() then
    raise exception 'not allowed';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 0 then
      raise exception 'revision must start at 0';
    end if;
  else
    if new.user_id is distinct from old.user_id then
      raise exception 'user is fixed';
    end if;
    if new.revision is distinct from old.revision + 1 then
      raise exception 'revision conflict';
    end if;
    if new.wrapped_ct is distinct from old.wrapped_ct or new.wrapped_iv is distinct from old.wrapped_iv then
      raise exception 'wrapped key is fixed';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

alter function public.still_vaults_guard() set search_path = public, auth;

revoke all on function public.still_vaults_guard() from public;
revoke all on function public.still_vaults_guard() from anon;
revoke all on function public.still_vaults_guard() from authenticated;

create trigger still_vaults_guard
  before insert or update on public.still_vaults
  for each row execute function public.still_vaults_guard();
