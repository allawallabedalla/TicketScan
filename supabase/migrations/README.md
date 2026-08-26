# Migrationen

**Eine eingespielte Migration wird nie wieder verändert.**

Supabase merkt sich, welche Dateien bereits gelaufen sind, und überspringt sie
danach. Eine nachträgliche Änderung an `0001_init.sql` erreicht die Datenbank
also nicht mehr — sie sieht im Repo richtig aus und fehlt trotzdem.

Genau das ist einmal passiert: Die Härtung der Sicht `offline_windows` kam nach
dem ersten Einspielen dazu und musste als `0002_harden.sql` nachgereicht
werden.

Ab jetzt gilt: **jede Änderung am Schema wird eine neue Datei.** Durchnummeriert,
mit sprechendem Namen. Wer prüfen will, was tatsächlich in der Datenbank steht:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

Anweisungen so schreiben, dass sie ein zweites Mal schadlos laufen —
`create or replace`, `if not exists`, `revoke`. Dann kostet ein doppelter
Durchlauf nichts.
