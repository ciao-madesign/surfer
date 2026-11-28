package it.orme.live

import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.util.concurrent.Executors

/**
 * Servizio in primo piano: tiene vivo il GPS anche a schermo spento (notifica sempre visibile = condivisione trasparente).
 * Frequenza adattiva come su iPhone: 15 s in corsa, 30 s lento, 60 s in sosta.
 */
class TrackingService : Service(), LocationListener {
    companion object {
        @Volatile var running = false
        @Volatile var noGps = false
        @Volatile var lastFix = 0L
        @Volatile var lastAcc = 0f
        @Volatile var message: String? = null
        private lateinit var instance: Uploader

        fun start(c: Context) = c.startForegroundService(Intent(c, TrackingService::class.java))
        fun stop(c: Context) = c.stopService(Intent(c, TrackingService::class.java))
        fun uploader(c: Context): Uploader { if (!::instance.isInitialized) instance = Uploader(c.applicationContext); return instance }
    }

    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var lm: LocationManager? = null
    private var wake: PowerManager.WakeLock? = null
    private var lastEnqueued = 0L
    private var pairing: Pairing? = null

    override fun onBind(i: Intent?): IBinder? = null

    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        pairing = Pairing.load(this)
        if (pairing == null) { stopSelf(); return START_NOT_STICKY }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("track", "Condivisione posizione", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, RunnerActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(this, "track").setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Orme Live: posizione condivisa").setContentText("Tocca per aprire e interrompere")
            .setContentIntent(open).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) else startForeground(1, n)

        wake = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "surfer:track").apply { acquire(14 * 3600_000L) }
        lm = getSystemService(LocationManager::class.java)
        try { lm!!.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5000L, 5f, this, Looper.getMainLooper()) }
        catch (e: SecurityException) { message = "Permesso di posizione mancante."; stopSelf(); return START_NOT_STICKY }
        running = true; noGps = false; message = null; lastFix = 0; lastEnqueued = 0
        main.postDelayed(watchdog, 30_000)
        return START_NOT_STICKY   // dopo un riavvio di sistema NON riparte da solo: serve un nuovo consenso/avvio esplicito
    }

    override fun onLocationChanged(l: Location) {
        if (!running || l.accuracy < 0) return
        lastFix = System.currentTimeMillis(); lastAcc = l.accuracy
        if (noGps) noGps = false
        val gap = if (l.speed >= 1.5f) 15_000 else if (l.speed >= 0.5f) 30_000 else 60_000
        if (l.time - lastEnqueued < gap) return
        lastEnqueued = l.time
        val up = uploader(this)
        up.enqueue(l.time, l.latitude, l.longitude, if (l.hasAltitude()) l.altitude else null, l.accuracy)
        send("tracking")
    }

    private fun send(status: String) {
        val p = pairing ?: return
        io.execute {
            when (val r = uploader(this).flush(p, status)) {
                Result.UNAUTHORIZED, Result.RACE_ENDED -> main.post {
                    message = if (r == Result.RACE_ENDED) "La gara è conclusa: condivisione terminata." else "Dispositivo non autorizzato: ricollega l'app."
                    stopSelf()
                }
                else -> {}
            }
        }
    }

    // Se per 90 s non arrivano posizioni, avvisa il portale ("Segnale GPS assente") e continua a provare.
    private val watchdog = object : Runnable {
        override fun run() {
            if (!running) return
            if (System.currentTimeMillis() - (if (lastFix == 0L) System.currentTimeMillis() - 91_000 else lastFix) > 90_000) { noGps = true; send("no_gps") }
            else if (uploader(this@TrackingService).pending > 0) send("tracking")   // riprova la coda anche senza nuovi punti
            main.postDelayed(this, 30_000)
        }
    }

    override fun onDestroy() {
        val wasRunning = running
        running = false
        main.removeCallbacksAndMessages(null)
        lm?.removeUpdates(this)
        wake?.let { if (it.isHeld) it.release() }
        uploader(this).discard()                         // interruzione immediata: nulla viene inviato dopo
        val p = pairing
        if (wasRunning && p != null && message == null) io.execute { uploader(this).flush(p, "paused") }
        io.shutdown()
        super.onDestroy()
    }

    @Deprecated("Needed for API < 30") override fun onStatusChanged(p: String?, s: Int, e: android.os.Bundle?) {}
    override fun onProviderDisabled(p: String) { if (running) { noGps = true; send("no_gps") } }
    override fun onProviderEnabled(p: String) {}
}
