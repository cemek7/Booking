-- Trigger to increment chats.unread_count on inbound messages
create or replace function public.increment_chat_unread()
returns trigger as $$
begin
  -- Only increment for inbound messages with a valid chat_id
  if (new.direction = 'inbound' and new.chat_id is not null) then
    update public.chats set unread_count = coalesce(unread_count,0) + 1 where id = new.chat_id;
  end if;
  return new;
end;
$$ language plpgsql;

-- Create trigger if not exists (Postgres doesn't support IF NOT EXISTS for triggers; guard via catalog check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'tg_increment_chat_unread'
  ) THEN
    CREATE TRIGGER tg_increment_chat_unread
    AFTER INSERT ON public.messages
    FOR EACH ROW EXECUTE FUNCTION public.increment_chat_unread();
  END IF;
END;$$;
