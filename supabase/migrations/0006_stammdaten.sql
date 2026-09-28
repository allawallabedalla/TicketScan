-- Stammdaten: ein Schreibweg, der nichts still löscht, und ein Protokoll.
--
-- Anlass ist der siebte Audit-Durchgang. Namen, Kategorien und Vermerke
-- wurden per Upsert geschrieben — mit genau den Spalten des Payloads. Eine
-- leere Zelle beim Einfügen einer Liste war damit ein `null`, und das
-- überschrieb den vorhandenen Namen. Eine Liste nur aus Nummern, gedacht zum
-- Ergänzen, leerte die Namen aller enthaltenen Tickets. Das Import-Skript tat
-- dasselbe. Und was vorher dastand, war danach nirgends mehr.
--
-- Der Name ist am Einlass die zweite Probe neben der Nummer. Ein falscher
-- Name lässt einen berechtigten Gast abweisen; ein fehlender nimmt die Probe.
--
-- Diese Datei legt deshalb EINEN Weg an, über den App und Import-Skript
-- schreiben:
--
--   - Ein Feld, das in der Zeile VORHANDEN ist, wird gesetzt (null leert).
--     Ein FEHLENDES Feld bleibt, wie es ist.
--   - Probelauf: zeigt, was neu, geändert und unverändert wäre, ohne zu
--     schreiben.
--   - Neue Nummern nur mit ausdrücklicher Freigabe. Ein Tippfehler wie 12305
--     wäre sonst ein gültiges Ticket.
--   - Doppelte Nummern in einer Liste und abweichende Stellenzahl sind ein
--     Fehler, bevor irgendetwas geschrieben wird.
--   - Jede tatsächliche Änderung landet mit altem und neuem Wert in
--     ticket_changes.
--
-- Den Einlassstand (redeemed_*) fasst die Funktion nicht an.
--
-- Mehrfach ausführbar, siehe docs/migrationen.md.

-- ------------------------------------------------------------- Protokoll --

create table if not exists ticket_changes (
  id     bigserial primary key,
  code   text        not null,
  feld   text        not null,            -- holder_name, category, note, oder 'angelegt'
  alt    text,
  neu    text,
  quelle text,                            -- z. B. 'app:Laptop Büro', 'import-skript'
  at     timestamptz not null default now()
);

create index if not exists ticket_changes_code_idx on ticket_changes (code, at desc);

alter table ticket_changes enable row level security;
revoke all on ticket_changes from anon, authenticated;
revoke all on sequence ticket_changes_id_seq from anon, authenticated;

-- ------------------------------------------------------------ Schreibweg --

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
    foreach v_feld in array array['holder_name', 'category', 'note'] loop
      v_max := case v_feld when 'holder_name' then 120 when 'category' then 60 else 300 end;
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

      insert into tickets (code, holder_name, category, note)
      values (v_code,
              nullif(btrim(v_zeile->>'holder_name'), ''),
              coalesce(nullif(btrim(v_zeile->>'category'), ''), 'Festival-Ticket'),
              nullif(btrim(v_zeile->>'note'), ''));
      insert into ticket_changes (code, feld, alt, neu, quelle)
      values (v_code, 'angelegt', null, nullif(btrim(v_zeile->>'holder_name'), ''), p_quelle);
      continue;
    end if;

    -- Vorhandenes Ticket: nur die Felder, die in der Zeile stehen.
    v_diff     := false;
    v_neu_name := v_alt.holder_name;
    v_neu_kat  := v_alt.category;
    v_neu_note := v_alt.note;

    foreach v_feld in array array['holder_name', 'category', 'note'] loop
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
        else v_alt.note end;

      continue when v_wert is not distinct from v_altwert;

      v_diff := true;
      case v_feld
        when 'holder_name' then v_neu_name := v_wert;
        when 'category'    then v_neu_kat  := v_wert;
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
         set holder_name = v_neu_name, category = v_neu_kat, note = v_neu_note
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

revoke execute on function stammdaten_schreiben(jsonb, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function stammdaten_schreiben(jsonb, text, boolean, boolean)
  to service_role;
alter function stammdaten_schreiben(jsonb, text, boolean, boolean)
  set search_path = public, pg_temp;
