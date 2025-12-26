-- Function to safely deduct rewards
create or replace function public.deduct_rewards(minutes numeric)
returns numeric
language plpgsql
security definer
as $$
declare
  new_balance numeric;
begin
  update public.fit_state
  set rewards_balance = rewards_balance - minutes
  where id = 'singleton'
  returning rewards_balance into new_balance;
  
  return new_balance;
end;
$$;

-- Grant permission to anon role (used by Shortcuts)
grant execute on function public.deduct_rewards(numeric) to anon;
grant execute on function public.deduct_rewards(numeric) to service_role;
