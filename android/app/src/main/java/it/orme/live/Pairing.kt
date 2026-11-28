package it.orme.live

import android.content.Context
import android.util.Base64
import org.json.JSONObject

/** Codice di collegamento del portale: base64url di {"u": server, "t": token dispositivo, "n": nome}. */
data class Pairing(val server: String, val token: String, val name: String) {
    companion object {
        /** Accetta il codice da solo o il link intero (…/track#codice). */
        fun parse(input: String): Pairing? = try {
            val code = input.trim().substringAfterLast('#')
            val j = JSONObject(String(Base64.decode(code, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)))
            val u = j.getString("u").trimEnd('/')
            val t = j.getString("t")
            if (!u.startsWith("https://") || t.length < 20) null else Pairing(u, t, j.optString("n", "Corridore"))
        } catch (e: Exception) { null }

        // Il token è una credenziale: resta in uno spazio privato dell'app (no backup, vedi allowBackup=false).
        private fun prefs(c: Context) = c.getSharedPreferences("pairing", Context.MODE_PRIVATE)
        fun load(c: Context): Pairing? = prefs(c).run {
            val t = getString("t", null) ?: return null
            Pairing(getString("u", "")!!, t, getString("n", "Corridore")!!)
        }
        fun save(c: Context, p: Pairing?) = prefs(c).edit().apply {
            clear(); if (p != null) { putString("u", p.server); putString("t", p.token); putString("n", p.name) }
        }.apply()
    }
}
