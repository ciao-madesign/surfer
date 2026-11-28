package it.orme.live

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Chiamate «una tantum» del corridore: stato, consenso, cancellazione dati. Da usare fuori dal thread principale. */
object Api {
    data class Me(val name: String, val consent: Boolean, val raceStatus: String)

    private fun call(p: Pairing, method: String, path: String, body: String? = null): Pair<Int, String> {
        val c = URL(p.server + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = 20000
        c.setRequestProperty("Authorization", "Bearer ${p.token}")
        if (body != null) { c.doOutput = true; c.setRequestProperty("Content-Type", "application/json"); c.outputStream.use { it.write(body.toByteArray()) } }
        val code = c.responseCode
        val text = (if (code < 400) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
        c.disconnect(); return code to text
    }

    /** null = rete assente; code 401 = collegamento non più valido. */
    fun me(p: Pairing): Pair<Int, Me?> = try {
        val (code, t) = call(p, "GET", "/api/device/me")
        if (code == 200) JSONObject(t).let { code to Me(it.optString("name"), it.optBoolean("consent"), it.optString("raceStatus")) } else code to null
    } catch (e: Exception) { 0 to null }

    fun consent(p: Pairing): Boolean = try { call(p, "POST", "/api/device/consent", """{"accept":true,"ageOk":true}""").first == 200 } catch (e: Exception) { false }

    fun deleteMyData(p: Pairing): Boolean = try { call(p, "DELETE", "/api/device/me").first == 200 } catch (e: Exception) { false }
}
