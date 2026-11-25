package it.surfer.live

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Un evento seguito. Il codice del link è una credenziale: resta nello spazio privato dell'app. */
data class Event(val token: String, var name: String?, var state: String?)   // state: null | "expired" | "ended"

object Events {
    private fun prefs(c: Context) = c.getSharedPreferences("events", Context.MODE_PRIVATE)

    @Synchronized fun load(c: Context): MutableList<Event> {
        val out = ArrayList<Event>()
        try {
            val a = JSONArray(prefs(c).getString("list", "[]"))
            for (i in 0 until a.length()) a.getJSONObject(i).let { out.add(Event(it.getString("t"), it.optString("n").ifEmpty { null }, it.optString("s").ifEmpty { null })) }
        } catch (_: Exception) {}
        return out
    }

    private fun save(c: Context, list: List<Event>) {
        val a = JSONArray()
        list.forEach { a.put(JSONObject().put("t", it.token).put("n", it.name ?: "").put("s", it.state ?: "")) }
        prefs(c).edit().putString("list", a.toString()).apply()
    }

    /** Accetta il link intero (solo del nostro sito) oppure il solo codice. */
    fun parseToken(input: String): String? {
        val s = input.trim()
        val token = if ('#' in s) {
            val host = try { Uri.parse(s).host } catch (_: Exception) { null }
            if (host != Config.HOST) return null
            s.substringAfterLast('#')
        } else s
        return token.takeIf { it.length >= 20 && it.all { ch -> ch.isLetterOrDigit() || ch == '-' || ch == '_' } }
    }

    /** false se già presente. */
    @Synchronized fun add(c: Context, token: String): Boolean {
        val l = load(c)
        if (l.any { it.token == token }) return false
        l.add(0, Event(token, null, null)); save(c, l); return true
    }

    @Synchronized fun remove(c: Context, token: String) = save(c, load(c).filter { it.token != token })

    @Synchronized fun update(c: Context, token: String, name: String?, state: String?) {
        val l = load(c); l.find { it.token == token }?.let { if (name != null) it.name = name; it.state = state }; save(c, l)
    }

    /** Chiede al server nome e stato. Da usare fuori dal thread principale. code 0 = rete assente. */
    fun fetch(token: String): Pair<Int, JSONObject?> = try {
        val u = URL("${Config.SERVER}/api/live?t=${URLEncoder.encode(token, "UTF-8")}")
        val c = u.openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 20000
        val code = c.responseCode
        val body = if (code == 200) c.inputStream.bufferedReader().readText() else null
        c.disconnect()
        code to body?.let { JSONObject(it) }
    } catch (e: Exception) { 0 to null }
}
