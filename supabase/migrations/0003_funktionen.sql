-- Einlöse- und Rücknahmefunktion neu anlegen.
--
-- Dieselbe Vorsichtsmaßnahme wie 0002, aus demselben Grund: 0001 wurde nach
-- dem ersten Einspielen noch zweimal geändert — der Parameter p_offline kam
-- dazu, und in undo_redemption stand row_count in einer als boolean
-- deklarierten Variablen, was jede Rücknahme zur Laufzeit hätte scheitern
-- lassen. Eine bereits eingespielte Migration wird aber nicht erneut
-- ausgeführt.
--
-- Auf einer Datenbank mit aktuellem Stand ändert diese Migration nichts. Auf
-- einer älteren holt sie beides nach. Ab hier gilt die Regel aus
-- docs/migrationen.md ausnahmslos: neue Datei statt Änderung.

alter table scan_log add column if not exists offline boolean not null default false;

create or replace function redeem_ticket(
  p_code      text,
  p_device_id uuid,
  p_scan_id   uuid,
  p_client_ts timestamptz,
  p_offline   boolean default false
) returns table (result text, code text, category text, redeemed_at timestamptz,
                 redeemed_by_device text) as $$
declare
  v_row tickets%rowtype;
begin
  if exists (select 1 from scan_log where scan_id = p_scan_id) then
    return query
      select l.result, l.code, t.category, t.redeemed_at, t.redeemed_by_device
        from scan_log l left join tickets t on t.code = l.code
       where l.scan_id = p_scan_id;
    return;
  end if;

  update tickets t
     set redeemed_at        = now(),
         redeemed_by_device = p_device_id::text,
         redeemed_scan_id   = p_scan_id
   where t.code = p_code
     and t.redeemed_at is null
  returning t.* into v_row;

  if found then
    insert into scan_log (scan_id, code, device_id, client_ts, action, result, offline)
    values (p_scan_id, p_code, p_device_id, p_client_ts, 'redeem', 'ok', p_offline);
    return query select 'ok'::text, v_row.code, v_row.category,
                        v_row.redeemed_at, v_row.redeemed_by_device;
    return;
  end if;

  select * into v_row from tickets where tickets.code = p_code;

  if not found then
    insert into scan_log (scan_id, code, device_id, client_ts, action, result, offline)
    values (p_scan_id, p_code, p_device_id, p_client_ts, 'redeem', 'unknown', p_offline);
    return query select 'unknown'::text, p_code, null::text, null::timestamptz, null::text;
    return;
  end if;

  insert into scan_log (scan_id, code, device_id, client_ts, action, result, offline)
  values (p_scan_id, p_code, p_device_id, p_client_ts, 'redeem',
          case when v_row.redeemed_by_device = p_device_id::text
               then 'duplicate' else 'conflict' end, p_offline);

  return query select
    case when v_row.redeemed_by_device = p_device_id::text
         then 'duplicate'::text else 'conflict'::text end,
    v_row.code, v_row.category, v_row.redeemed_at, v_row.redeemed_by_device;
end;
$$ language plpgsql;

create or replace function undo_redemption(
  p_code      text,
  p_device_id uuid,
  p_scan_id   uuid,
  p_reason    text
) returns boolean as $$
declare
  v_rows integer;
begin
  update tickets
     set redeemed_at = null, redeemed_by_device = null, redeemed_scan_id = null
   where code = p_code and redeemed_at is not null;

  get diagnostics v_rows = row_count;

  insert into scan_log (scan_id, code, device_id, client_ts, action, result, reason)
  values (p_scan_id, p_code, p_device_id, now(), 'undo',
          case when v_rows > 0 then 'ok' else 'unknown' end, p_reason)
  on conflict (scan_id) do nothing;

  return v_rows > 0;
end;
$$ language plpgsql;
