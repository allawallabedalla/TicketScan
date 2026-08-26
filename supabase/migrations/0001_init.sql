-- TicketScan — Grundschema
--
-- `tickets` hält den aktuellen Zustand, `scan_log` die vollständige Historie
-- jedes Versuchs. Das Protokoll ist nicht optional: es ist die Grundlage jeder
-- Klärung an der Tür.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- Tickets --

create table tickets (
  code               text primary key,          -- exakt wie gedruckt, mit führenden Nullen
  holder_name        text,                      -- bleibt leer, die Tickets sind nicht personalisiert
  category           text not null default 'Festival-Ticket',
  note               text,
  redeemed_at        timestamptz,               -- null = noch kein Bändchen ausgegeben
  redeemed_by_device text,
  redeemed_scan_id   uuid,
  updated_at         timestamptz not null default now()
);

-- Treibt den Delta-Abgleich der Geräte.
create index tickets_updated_at_idx on tickets (updated_at);

-- Nur eingelöste Tickets, für die Zählung im Dashboard.
create index tickets_redeemed_idx on tickets (redeemed_at) where redeemed_at is not null;

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger tickets_touch before update on tickets
  for each row execute function touch_updated_at();

-- --------------------------------------------------------------- Protokoll --

create table scan_log (
  scan_id   uuid primary key,                   -- vom Gerät erzeugt, macht das Einreichen idempotent
  code      text        not null,
  device_id uuid        not null,
  client_ts timestamptz not null,               -- wann das Gerät entschied
  server_ts timestamptz not null default now(),
  action    text        not null check (action in ('redeem', 'undo', 'override')),
  result    text        not null check (result in ('ok', 'duplicate', 'unknown', 'conflict')),
  reason    text,                               -- Begründung bei undo und override
  -- Entstand der Scan ohne Verbindung? Dann konnte er im Moment der
  -- Entscheidung nicht gegen die anderen Geräte geprüft werden. Nach der
  -- Netzwiederkehr macht das aus einem blinden Fleck einen geprüften Zeitraum.
  offline   boolean     not null default false
);

create index scan_log_code_idx      on scan_log (code, server_ts desc);
create index scan_log_device_ts_idx on scan_log (device_id, client_ts desc);

-- ----------------------------------------------------------------- Geräte --

create table devices (
  device_id      uuid primary key default gen_random_uuid(),
  label          text        not null,          -- "Nordeingang 2"
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz,
  synced_upto    timestamptz,
  revoked_at     timestamptz,                   -- gesperrt, etwa nach Verlust
  session_expires_at timestamptz not null       -- Tagesgrenze, siehe Konzept Abschnitt 09
);

-- Jede Anmeldung, damit ein unerwartetes elftes Gerät auffällt.
create table session_log (
  id         bigserial primary key,
  device_id  uuid references devices (device_id),
  label      text,
  succeeded  boolean     not null,
  remote_ip  text,
  created_at timestamptz not null default now()
);

create index session_log_created_idx on session_log (created_at desc);

-- -------------------------------------------------- Bändchen-Gegenrechnung --

-- Zweiter, körperlicher Zähler: die Zahl der ausgegebenen Bändchen muss zur
-- Zahl der Einlösungen passen. Jede Schicht trägt ihren Stand einmal ein.
create table wristband_counts (
  id         bigserial primary key,
  device_id  uuid references devices (device_id),
  counted    integer     not null check (counted >= 0),
  noted_at   timestamptz not null default now(),
  note       text
);

-- ------------------------------------------------------------- Kernabfrage --

-- Löst genau ein Ticket ein. Postgres serialisiert konkurrierende Zugriffe auf
-- dieselbe Zeile selbst — genau ein Gerät bekommt eine Zeile zurück, alle
-- anderen bekommen null. Kein Sperren, keine Transaktionslogik nötig.
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
  -- Schon einmal eingereicht? Dann das damalige Ergebnis wiederholen, statt
  -- ein zweites Mal zu buchen.
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

  -- Bereits eingelöst. War es dasselbe Gerät, ist es ein doppelt gesendeter
  -- Scan; war es ein anderes, hat ein Offline-Fenster zugeschlagen.
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

-- Nimmt eine Einlösung zurück. Für Fehlbuchungen, siehe Konzept Abschnitt 01.
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

-- Bericht über die Zeiträume, in denen ohne Abgleich eingelöst wurde. Macht
-- aus einem blinden Fleck einen geprüften Zeitraum, siehe Konzept Abschnitt 05.
--
-- security_invoker ist hier nicht optional: Eine Sicht läuft in Postgres
-- standardmäßig mit den Rechten ihres Eigentümers und umgeht damit die
-- Zeilensicherheit der Tabellen darunter. Ohne diese Angabe wäre das
-- Scan-Protokoll über die Data API lesbar, obwohl scan_log selbst gesperrt
-- ist.
create or replace view offline_windows with (security_invoker = true) as
select device_id,
       min(server_ts) as von,
       max(server_ts) as bis,
       count(*)                                    as eingeloest,
       count(*) filter (where result = 'conflict') as doppelt
  from scan_log
 where offline and action = 'redeem'
 group by device_id, date_trunc('hour', server_ts);

-- Die Tabellen werden ausschließlich über die Edge Functions angesprochen,
-- die mit dem Service-Role-Schlüssel arbeiten. Kein direkter Zugriff für
-- anonyme Clients.
--
-- Zeilensicherheit ohne eine einzige Richtlinie heißt: anon und authenticated
-- sehen nichts. Der Service-Role-Schlüssel umgeht sie, wie vorgesehen.
alter table tickets          enable row level security;
alter table scan_log         enable row level security;
alter table devices          enable row level security;
alter table session_log      enable row level security;
alter table wristband_counts enable row level security;

-- Zweite Verteidigungslinie, unabhängig davon, ob neue Tabellen im Projekt
-- automatisch freigegeben werden: Die öffentlichen Rollen bekommen die Rechte
-- ausdrücklich wieder entzogen.
revoke all on tickets, scan_log, devices, session_log, wristband_counts,
              offline_windows
  from anon, authenticated;
