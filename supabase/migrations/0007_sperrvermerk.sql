-- Sperrvermerk: ein Ticket ungültig machen, und zwar auf allen Geräten.
--
-- Anlass: Beim Kurztest nach dem siebten Audit stand auf einem Gerät ein
-- Ticket mehr als erwartet. Es war berechtigt — aber die Frage „was, wenn
-- nicht?" hatte keine gute Antwort. Löschen erreicht die Geräte nicht: Der
-- Abgleich überträgt geänderte Zeilen, keine verschwundenen. Ein gelöschtes
-- Ticket blieb auf jedem Gerät gültig, bis es neu eingerichtet wurde.
--
-- Ein Sperrvermerk ist dagegen eine Änderung, und die kommt überall an. Der
-- Text ist zugleich der Grund, den die Einlasskraft sieht („doppelt
-- verkauft", „als gestohlen gemeldet"). null heißt: nicht gesperrt.
--
-- Die Sperre wirkt zweifach: Das Gerät weist lokal ab, sobald der Vermerk
-- angekommen ist; und der Server bucht ein gesperrtes Ticket nie ein, auch
-- nicht, wenn ein Gerät im Funkloch noch den alten Stand hatte. Dann steht
-- im Protokoll „gesperrt", und die Übersicht kann es zeigen.
--
-- Mehrfach ausführbar, siehe docs/migrationen.md.

alter table tickets add column if not exists gesperrt text;

-- Neues Ergebnis im Protokoll. Die alte Prüfung wird über ihren INHALT
-- gesucht, nicht über ihren Namen: Hieße sie in der echten Datenbank anders
-- als erwartet, bliebe sie sonst stehen — und jede Einlösung eines gesperrten
-- Tickets scheiterte am Protokolleintrag. Der Vorgang bliebe für immer in der
-- Warteschlange des Geräts.
do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'scan_log'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%result%'
  loop
    execute format('alter table scan_log drop constraint %I', v_name);
  end loop;
end $$;

alter table scan_log add constraint scan_log_result_check
  check (result in ('ok', 'duplicate', 'unknown', 'conflict', 'gesperrt'));

-- ------------------------------------------------------------ Einlösung --

-- Wie 0003, mit einer zusätzlichen Bedingung: Gesperrt wird nie eingelöst.
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
     and t.gesperrt is null
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

  if v_row.gesperrt is not null and v_row.redeemed_at is null then
    insert into scan_log (scan_id, code, device_id, client_ts, action, result, reason, offline)
    values (p_scan_id, p_code, p_device_id, p_client_ts, 'redeem', 'gesperrt',
            v_row.gesperrt, p_offline);
    return query select 'gesperrt'::text, v_row.code, v_row.category,
                        v_row.redeemed_at, v_row.redeemed_by_device;
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

alter function redeem_ticket(text, uuid, uuid, timestamptz, boolean)
  set search_path = public, pg_temp;

-- ------------------------------------------------------------ Schreibweg --

-- Wie 0006, mit dem Feld `gesperrt` (höchstens 200 Zeichen). Auch hier gilt:
-- fehlt es in der Zeile, bleibt es; null hebt die Sperre auf.
create or replace function stammdaten_schreiben(
  p_zeilen      jsonb,
  p_quelle      text    default null,
  p_neu_erlaubt boolean default false,
  p_probe       boolean default false
) returns jsonb as $$
declare
  v_zeile      jsonb;
  v_code       text;
  v_alt        tickets%rowtype;
  v_stellen    integer;
  v_dupes      text;
  v_feld       text;
  v_wert       text;
  v_altwert    text;
  v_max        integer;
  v_diff       boolean;
  v_neu_name   text;
  v_neu_kat    text;
  v_neu_note   text;
  v_neu_sperre text;
  v_neu        integer := 0;
  v_geaendert  integer := 0;
  v_gleich     integer := 0;
  v_neue_codes text[]  := '{}';
  v_aend       jsonb   := '[]'::jsonb;
begin
  if jsonb_typeof(p_zeilen) is distinct from 'array' then
    raise exception 'p_zeilen muss eine Liste sein';
  end if;
  if jsonb_array_length(p_zeilen) > 500 then
    raise exception 'Höchstens 500 Zeilen je Aufruf';
  end if;

  -- Doppelte Nummern: Postgres lehnt ein Upsert, das dieselbe Zeile zweimal
  -- trifft, ohnehin ab — aber mit einer Meldung, die niemand am Eingang
  -- versteht. Und über zwei Blöcke verteilt gewann still die letzte Zeile.
  select string_agg(c, ', ') into v_dupes from (
    select z->>'code' as c from jsonb_array_elements(p_zeilen) z
     group by 1 having count(*) > 1 order by 1 limit 10
  ) d;
  if v_dupes is not null then
    raise exception 'Doppelte Nummern in der Liste: %', v_dupes;
  end if;

  select length(t.code) into v_stellen from tickets t limit 1;

  for v_zeile in select * from jsonb_array_elements(p_zeilen) loop
    v_code := btrim(v_zeile->>'code');
    if v_code is null or v_code !~ '^[0-9]+$' then
      raise exception '„%" ist keine Nummer', coalesce(v_zeile->>'code', '(leer)');
    end if;
    if v_stellen is not null and length(v_code) <> v_stellen then
      raise exception '„%" hat % statt % Stellen. Führende Nullen im Export verloren?',
        v_code, length(v_code), v_stellen;
    end if;

    -- Längen prüfen statt still kürzen.
    foreach v_feld in array array['holder_name', 'category', 'note', 'gesperrt'] loop
      v_max := case v_feld when 'holder_name' then 120 when 'category' then 60
                        when 'gesperrt' then 200 else 300 end;
      if length(btrim(v_zeile->>v_feld)) > v_max then
        raise exception '%: % ist länger als % Zeichen', v_code, v_feld, v_max;
      end if;
    end loop;

    select * into v_alt from tickets t where t.code = v_code for update;

    if not found then
      v_neu := v_neu + 1;
      if coalesce(array_length(v_neue_codes, 1), 0) < 20 then
        v_neue_codes := v_neue_codes || v_code;
      end if;
      if p_probe then continue; end if;
      if not p_neu_erlaubt then
        raise exception 'Nummer % steht nicht in der Liste. Neue Nummern müssen ausdrücklich freigegeben werden.', v_code;
      end if;

      insert into tickets (code, holder_name, category, note, gesperrt)
      values (v_code,
              nullif(btrim(v_zeile->>'holder_name'), ''),
              coalesce(nullif(btrim(v_zeile->>'category'), ''), 'Festival-Ticket'),
              nullif(btrim(v_zeile->>'note'), ''),
              nullif(btrim(v_zeile->>'gesperrt'), ''));
      insert into ticket_changes (code, feld, alt, neu, quelle)
      values (v_code, 'angelegt', null, nullif(btrim(v_zeile->>'holder_name'), ''), p_quelle);
      continue;
    end if;

    -- Vorhandenes Ticket: nur die Felder, die in der Zeile stehen.
    v_diff     := false;
    v_neu_name := v_alt.holder_name;
    v_neu_kat  := v_alt.category;
    v_neu_note := v_alt.note;
    v_neu_sperre := v_alt.gesperrt;

    foreach v_feld in array array['holder_name', 'category', 'note', 'gesperrt'] loop
      continue when not (v_zeile ? v_feld);

      v_wert := nullif(btrim(v_zeile->>v_feld), '');
      if v_feld = 'category' then
        -- Die Spalte ist nicht leer zu machen; „leeren" heißt zurück auf den
        -- Standard.
        v_wert := coalesce(v_wert, 'Festival-Ticket');
      end if;
      v_altwert := case v_feld
        when 'holder_name' then v_alt.holder_name
        when 'category'    then v_alt.category
        when 'gesperrt'    then v_alt.gesperrt
        else v_alt.note end;

      continue when v_wert is not distinct from v_altwert;

      v_diff := true;
      case v_feld
        when 'holder_name' then v_neu_name := v_wert;
        when 'category'    then v_neu_kat  := v_wert;
        when 'gesperrt'    then v_neu_sperre := v_wert;
        else                    v_neu_note := v_wert;
      end case;

      if jsonb_array_length(v_aend) < 50 then
        v_aend := v_aend || jsonb_build_object(
          'code', v_code, 'feld', v_feld, 'alt', v_altwert, 'neu', v_wert);
      end if;
      if not p_probe then
        insert into ticket_changes (code, feld, alt, neu, quelle)
        values (v_code, v_feld, v_altwert, v_wert, p_quelle);
      end if;
    end loop;

    if not v_diff then
      v_gleich := v_gleich + 1;
      continue;
    end if;

    v_geaendert := v_geaendert + 1;
    if not p_probe then
      update tickets t
         set holder_name = v_neu_name, category = v_neu_kat, note = v_neu_note,
             gesperrt = v_neu_sperre
       where t.code = v_code;
    end if;
  end loop;

  return jsonb_build_object(
    'neu',          v_neu,
    'geaendert',    v_geaendert,
    'unveraendert', v_gleich,
    'neueCodes',    to_jsonb(v_neue_codes),
    'aenderungen',  v_aend,
    'geschrieben',  not p_probe
  );
end;
$$ language plpgsql;


-- Die Rechte hängen an der Signatur, die gleich bleibt — trotzdem erneut
-- setzen, damit diese Datei für sich allein stimmt.
revoke execute on function stammdaten_schreiben(jsonb, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function stammdaten_schreiben(jsonb, text, boolean, boolean)
  to service_role;
alter function stammdaten_schreiben(jsonb, text, boolean, boolean)
  set search_path = public, pg_temp;
