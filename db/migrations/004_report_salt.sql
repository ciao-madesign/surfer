-- Link del report revocabile: sale per gara usata nella firma del link (cambiandola, il vecchio link smette di funzionare).
ALTER TABLE races ADD COLUMN IF NOT EXISTS report_salt text;
