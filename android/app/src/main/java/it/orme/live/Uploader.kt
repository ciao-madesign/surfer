package it.orme.live

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

enum class Result { OK, RETRY, UNAUTHORIZED, RACE_ENDED }

/** Coda su disco + invio a blocchi. Senza rete i punti restano in coda e partono al ritorno del segnale. */
class Uploader(ctx: Context) {
    private val file = File(ctx.filesDir, "queue.json")
    private val queue = ArrayList<JSONObject>()
    private val maxQueue = 5000   // ~20 ore a 15 s: oltre, si scartano i più vecchi
    private val chunk = 100       // il server accetta al massimo 120 punti per richiesta
    @Volatile var lastError: String? = null
    @Volatile var lastSuccess = 0L

    init { try { JSONArray(file.readText()).let { a -> for (i in 0 until a.length()) queue.add(a.getJSONObject(i)) } } catch (_: Exception) {} }

    val pending: Int get() = synchronized(this) { queue.size }

    @Synchronized fun enqueue(t: Long, lat: Double, lon: Double, ele: Double?, acc: Float) {
        queue.add(JSONObject().put("t", t).put("lat", lat).put("lon", lon).put("acc", acc.toDouble()).apply { if (ele != null) put("ele", ele) })
        while (queue.size > maxQueue) queue.removeAt(0)
        persist()
    }

    /** «Interrompi»: i punti non inviati vengono cancellati, non verranno condivisi dopo. */
    @Synchronized fun discard() { queue.clear(); persist() }

    private fun persist() = try { file.writeText(JSONArray(queue).toString()) } catch (_: Exception) {}

    /** Da chiamare fuori dal thread principale. Svuota la coda (o manda solo lo stato, se vuota). */
    fun flush(p: Pairing, status: String): Result {
        do {
            val batch = synchronized(this) { queue.take(chunk) }
            val r = post(p, batch, status)
            if (r != Result.OK) return r
            synchronized(this) { repeat(batch.size) { if (queue.isNotEmpty()) queue.removeAt(0) }; persist() }
            lastSuccess = System.currentTimeMillis(); lastError = null
        } while (pending > 0)
        return Result.OK
    }

    private fun post(p: Pairing, pts: List<JSONObject>, status: String): Result = try {
        val c = URL("${p.server}/api/device/positions").openConnection() as HttpURLConnection
        c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 20000; c.doOutput = true
        c.setRequestProperty("Authorization", "Bearer ${p.token}")
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(JSONObject().put("points", JSONArray(pts)).put("status", status).toString().toByteArray()) }
        val code = c.responseCode
        c.disconnect()
        when (code) {
            200 -> Result.OK
            401 -> { lastError = "Dispositivo non autorizzato"; Result.UNAUTHORIZED }
            410 -> { lastError = "Gara conclusa"; Result.RACE_ENDED }
            400 -> { lastError = "Dati rifiutati dal server"; Result.OK }  // blocco non valido: si scarta
            else -> { lastError = "Server non disponibile"; Result.RETRY }
        }
    } catch (e: Exception) { lastError = "Connessione assente"; Result.RETRY }
}
