-- Rücknahme absichern, Reste aufräumen.
--
-- Anlass ist ein Fund aus dem vierten Audit: undo_redemption war nicht
-- idempotent. redeem_ticket prüft die scan_id, bevor es schreibt, und
-- wiederholt bei einer zweiten Zustellung nur die damalige Antwort.
-- undo_redemption tat das nicht — das `on conflict (scan_id) do nothing`
-- unterdrückte lediglich den Protokolleintrag, das UPDATE lief trotzdem.
--
-- Der Ablauf, der daraus entsteht, ist am Eingang nicht erkennbar: Gerät A
-- nimmt 01234 zurück, die Antwort geht auf dem Rückweg verloren, der Eintrag
-- bleibt in der Warteschlange. Der Gast kommt zurück, Gerät B löst regulär
-- ein. Dann bekommt A Netz und sendet dieselbe Rücknahme erneut — und macht
-- die fremde, gültige Einlösung zunichte. Im Protokoll steht davon nichts,
-- weil der zweite Eintrag am Primärschlüssel scheitert.

-- ------------------------------------------------------------- Rücknahme --

-- Der Rückgabetyp wechselt von boolean auf text, deshalb erst löschen.
-- 'ok'      — es war eingelöst und ist jetzt frei
-- 'unknown' — es war gar nicht eingelöst (die legitime Leerantwort)
-- Ein Fehlschlag ist keiner dieser Werte: er wirft, und der Endpunkt meldet
-- 'error', damit der Eintrag in der Warteschlange bleibt.
drop function if exists undo_redemption(text, uuid, uuid, text);

-- `create or replace`, nicht `create`: Sonst scheitert ein zweiter Durchlauf
-- dieser Datei an „already exists" — und damit auch alles darunter. Die Regel
-- aus docs/migrationen.md gilt ausnahmslos, und dieses Projekt ist an genau
-- dieser Stelle schon zweimal aufgelaufen.
create or replace function undo_redemption(
  p_code      text,
  p_device_id uuid,
  p_scan_id   uuid,
  p_reason    text,
  -- Wann das Gerät entschieden hat, und ob es dabei Verbindung hatte. Ohne
  -- diese beiden stand im Protokoll der Zeitpunkt des späteren Uploads, und
  -- jede im Funkloch getroffene Rücknahme galt als geprüft.
  p_client_ts timestamptz default now(),
  p_offline   boolean default false
) returns text as $$
declare
  v_rows   integer;
  v_result text;
begin
  -- Dieselbe Vorprüfung wie in redeem_ticket: eine zweite Zustellung
  -- derselben scan_id wiederholt die Antwort, statt erneut zu schreiben.
  select result into v_result from scan_log where scan_id = p_scan_id;
  if found then
    return v_result;
  end if;

  update tickets
     set redeemed_at = null, redeemed_by_device = null, redeemed_scan_id = null
   where code = p_code and redeemed_at is not null;

  get diagnostics v_rows = row_count;
  v_result := case when v_rows > 0 then 'ok' else 'unknown' end;

  insert into scan_log (scan_id, code, device_id, client_ts, action, result, reason, offline)
  values (p_scan_id, p_code, p_device_id, coalesce(p_client_ts, now()), 'undo',
          v_result, p_reason, coalesce(p_offline, false));

  return v_result;
end;
$$ language plpgsql;

-- ------------------------------------------------------- Alte Überladungen --

-- create or replace ersetzt nur bei identischer Parameterliste. Die erste
-- Fassung von redeem_ticket hatte vier Parameter (ohne p_offline) und bliebe
-- sonst als eigene Überladung stehen — ein Aufruf mit vier Parametern wäre
-- dann mehrdeutig und schlüge mit "is not unique" fehl.
drop function if exists redeem_ticket(text, uuid, uuid, timestamptz);

-- ------------------------------------------------------------ Ausführrecht --

-- Der Entzug in 0001/0002 betraf nur Tabellen und die Sicht. Funktionen
-- tragen ihr execute-Recht voreingestellt für PUBLIC. Heute läuft beides als
-- SECURITY INVOKER und scheitert für anon am fehlenden Tabellenrecht — aber
-- eine zweite Verteidigungslinie, die eine Tür offen lässt, ist keine.
revoke execute on function
  redeem_ticket(text, uuid, uuid, timestamptz, boolean),
  undo_redemption(text, uuid, uuid, text, timestamptz, boolean)
  from public, anon, authenticated;

-- Fester Suchpfad: heute folgenlos, weil beide als INVOKER laufen. Der Tag,
-- an dem eine davon SECURITY DEFINER wird, kommt aber in jedem Projekt.
alter function redeem_ticket(text, uuid, uuid, timestamptz, boolean)
  set search_path = public, pg_temp;
alter function undo_redemption(text, uuid, uuid, text, timestamptz, boolean)
  set search_path = public, pg_temp;
alter function touch_updated_at() set search_path = public, pg_temp;
