-- Nachziehen der Härtung aus 0001.
--
-- Hintergrund: 0001 wurde nach dem ersten Anlegen des Projekts noch einmal
-- geändert — security_invoker auf der Sicht und der Rechteentzug für die
-- öffentlichen Rollen kamen später dazu. Supabase merkt sich aber, welche
-- Migration bereits gelaufen ist, und spielt sie nicht erneut ein. Auf einer
-- Datenbank, die den alten Stand bekommen hat, würde die Härtung sonst still
-- fehlen.
--
-- Alle Anweisungen hier sind mehrfach ausführbar. Auf einer frisch angelegten
-- Datenbank ändern sie nichts, auf einer älteren holen sie den Fehler auf.

-- Eine Sicht läuft in Postgres standardmäßig mit den Rechten ihres Eigentümers
-- und umgeht damit die Zeilensicherheit der Tabellen darunter. Ohne
-- security_invoker wäre das Scan-Protokoll über die Data API lesbar, obwohl
-- scan_log selbst gesperrt ist.
create or replace view offline_windows with (security_invoker = true) as
select device_id,
       min(server_ts) as von,
       max(server_ts) as bis,
       count(*)                                    as eingeloest,
       count(*) filter (where result = 'conflict') as doppelt
  from scan_log
 where offline and action = 'redeem'
 group by device_id, date_trunc('hour', server_ts);

alter table tickets          enable row level security;
alter table scan_log         enable row level security;
alter table devices          enable row level security;
alter table session_log      enable row level security;
alter table wristband_counts enable row level security;

revoke all on tickets, scan_log, devices, session_log, wristband_counts,
              offline_windows
  from anon, authenticated;
