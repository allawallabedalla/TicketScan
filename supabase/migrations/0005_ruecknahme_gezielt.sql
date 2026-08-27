-- Rücknahme trifft nur noch die Einlösung, die sie meint.
--
-- 0004 hat die doppelte Zustellung derselben Rücknahme abgefangen. Der
-- Nachbarfall blieb offen, und er ist genauso schädlich:
--
--   Gerät A erfasst 01234 versehentlich und nimmt es sofort zurück — beides
--   im Funkloch, beides in der Warteschlange. Der rechtmäßige Inhaber geht
--   derweil zu Tor B; dort ist 01234 frei, B löst regulär ein. Später bekommt
--   A Netz: die Einlösung läuft in einen conflict (richtig), die Rücknahme
--   danach macht Bs gültige Einlösung zunichte. Die scan_id ist neu, die
--   Prüfung aus 0004 greift nicht.
--
-- tickets.redeemed_scan_id steht seit 0003 in der Tabelle und wurde nie
-- benutzt. Genau dafür ist es da: Die Rücknahme benennt die Einlösung, die
-- sie zurücknimmt. Trifft sie eine andere an, tut sie nichts.
--
-- Ohne p_undo_of bleibt es beim alten Verhalten — das ist der Fall
-- „Trotzdem einlassen": Dort gibt jemand bewusst eine fremde Einlösung frei,
-- weil das Ticket unversehrt vor ihm liegt.

create or replace function undo_redemption(
  p_code      text,
  p_device_id uuid,
  p_scan_id   uuid,
  p_reason    text,
  p_client_ts timestamptz default now(),
  p_offline   boolean default false,
  -- Die scan_id der Einlösung, die zurückgenommen werden soll. null heißt:
  -- was auch immer gerade eingelöst ist.
  p_undo_of   uuid default null
) returns text as $$
declare
  v_rows   integer;
  v_result text;
begin
  select result into v_result from scan_log where scan_id = p_scan_id;
  if found then
    return v_result;
  end if;

  update tickets
     set redeemed_at = null, redeemed_by_device = null, redeemed_scan_id = null
   where code = p_code
     and redeemed_at is not null
     and (p_undo_of is null or redeemed_scan_id = p_undo_of);

  get diagnostics v_rows = row_count;
  v_result := case when v_rows > 0 then 'ok' else 'unknown' end;

  insert into scan_log (scan_id, code, device_id, client_ts, action, result, reason, offline)
  values (p_scan_id, p_code, p_device_id, coalesce(p_client_ts, now()), 'undo',
          v_result, p_reason, coalesce(p_offline, false));

  return v_result;
end;
$$ language plpgsql;

-- Die Fassung aus 0004 hat eine andere Parameterliste und bliebe sonst als
-- eigene Überladung stehen — ein Aufruf mit sechs Parametern wäre dann
-- mehrdeutig. (0004 selbst war aus demselben Grund nicht wiederholbar: dort
-- stand `create function` statt `create or replace`. Diese Datei behebt das
-- mit, indem sie die Funktion ohnehin ersetzt.)
drop function if exists undo_redemption(text, uuid, uuid, text, timestamptz, boolean);

-- Rechte erneut setzen — die neue Signatur erbt sie nicht.
revoke execute on function
  undo_redemption(text, uuid, uuid, text, timestamptz, boolean, uuid)
  from public, anon, authenticated;

-- Und ausdrücklich dem Dienstkonto geben, mit dem die Endpunkte arbeiten.
--
-- Ohne diese Zeile hing das Ausführrecht möglicherweise am PUBLIC-Grant, den
-- 0004 entzogen hat. Dann wäre jede Einlösung mit `error` gescheitert — und
-- weil die App gescheiterte Vorgänge in der Warteschlange behält, hätte
-- niemand mehr eingelassen werden können, während die Statuszeile mitzählt.
grant execute on function
  redeem_ticket(text, uuid, uuid, timestamptz, boolean),
  undo_redemption(text, uuid, uuid, text, timestamptz, boolean, uuid)
  to service_role;

alter function undo_redemption(text, uuid, uuid, text, timestamptz, boolean, uuid)
  set search_path = public, pg_temp;
