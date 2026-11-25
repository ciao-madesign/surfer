package it.surfer.live

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import java.util.concurrent.Executors

/** Schermata unica: collega → consenso → avvia/interrompi. UI costruita nel codice per non avere altri file. */
class MainActivity : Activity() {
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private var pairing: Pairing? = null
    private var consent: Boolean? = null   // null = da verificare

    private lateinit var root: LinearLayout
    private lateinit var title: TextView
    private lateinit var status: TextView
    private lateinit var info: TextView
    private lateinit var err: TextView
    private lateinit var codeBox: EditText
    private lateinit var pairBtn: Button
    private lateinit var ageBox: CheckBox
    private lateinit var agreeBtn: Button
    private lateinit var consentText: TextView
    private lateinit var toggle: Button
    private lateinit var batteryBtn: Button
    private lateinit var forget: Button
    private lateinit var unpair: Button

    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun <T : View> T.add(): T { root.addView(this); return this }
    private fun tv(s: String, size: Float = 15f) = TextView(this).apply { text = s; textSize = size; setPadding(0, dp(6), 0, dp(6)) }
    private fun btn(s: String, f: () -> Unit) = Button(this).apply { text = s; setOnClickListener { f() } }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(28), dp(20), dp(20)) }
        setContentView(ScrollView(this).apply { addView(root) })
        title = tv("Surfer Live", 26f).add()
        status = tv("", 17f).add()
        codeBox = EditText(this).apply { hint = "Incolla il link o il codice dell'organizzatore"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 2 }.add()
        pairBtn = btn("Collega") { doPair(codeBox.text.toString()) }.add()
        consentText = tv("Durante la gara la tua posizione e il tuo nome sono visibili a chi ha il link della gara. Le posizioni vengono cancellate 24 ore dopo la fine; il report con i tempi resta 3 giorni. Puoi cancellare i tuoi dati in qualsiasi momento da questa app.", 14f).add()
        ageBox = CheckBox(this).apply { text = "Ho almeno 14 anni, oppure sono il genitore o tutore e acconsento per un minore."; setOnCheckedChangeListener { _, c -> agreeBtn.isEnabled = c } }.add()
        agreeBtn = btn("Acconsento") { doConsent() }.add()
        toggle = btn("Avvia condivisione") { toggleSharing() }.add()
        info = tv("", 14f).add()
        err = tv("", 14f).apply { setTextColor(Color.rgb(180, 30, 30)) }.add()
        batteryBtn = btn("Impostazioni batteria (consigliato: senza restrizioni)") { askBattery() }.add()
        unpair = btn("Scollega questo telefono") { if (!TrackingService.running) { Pairing.save(this, null); pairing = null; consent = null; render() } }.add()
        forget = btn("Cancella i miei dati") { doForget() }.add()
        tv("Consigli: tieni attivo il GPS, disattiva il risparmio energetico. La notifica resta visibile finché condividi.", 13f).add()
        handle(intent)
        tick()
    }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }

    /** Il QR di /gestisci apre l'app direttamente con il collegamento già dentro. */
    private fun handle(i: Intent?) { i?.data?.let { u -> doPair(u.toString()); intent = Intent() } }

    override fun onResume() { super.onResume(); pairing = Pairing.load(this); if (pairing != null && consent == null) loadMe(); render() }

    private fun doPair(raw: String) {
        val p = Pairing.parse(raw) ?: run { err.text = "Codice non valido. Chiedi un nuovo QR all'organizzatore."; return }
        Pairing.save(this, p); pairing = p; consent = null; err.text = ""; codeBox.setText(""); loadMe(); render()
    }

    private fun loadMe() {
        val p = pairing ?: return
        io.execute {
            val (code, me) = Api.me(p)
            ui.post {
                when {
                    code == 401 -> { Pairing.save(this, null); pairing = null; err.text = "Questo collegamento non è più valido. Chiedi un nuovo QR all'organizzatore." }
                    me != null -> consent = me.consent
                    else -> consent = true   // offline: si prosegue; il server rifiuta comunque i dati senza consenso
                }
                render()
            }
        }
    }

    private fun doConsent() {
        val p = pairing ?: return
        io.execute { val ok = Api.consent(p); ui.post { if (ok) { consent = true; err.text = "" } else err.text = "Non sono riuscito a registrare il consenso. Riprova."; render() } }
    }

    private fun doForget() {
        val p = pairing ?: return
        AlertDialog.Builder(this).setMessage("Cancellare i tuoi dati dal server e scollegare questo telefono?")
            .setPositiveButton("Cancella") { _, _ ->
                TrackingService.stop(this); TrackingService.uploader(this).discard()
                io.execute { val ok = Api.deleteMyData(p); ui.post { if (ok) { Pairing.save(this, null); pairing = null; consent = null; err.text = "" } else err.text = "Cancellazione non riuscita. Riprova."; render() } }
            }.setNegativeButton("Annulla", null).show()
    }

    private fun toggleSharing() {
        if (TrackingService.running) { TrackingService.stop(this); render(); return }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION) +
                (if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.POST_NOTIFICATIONS) else emptyArray<String>()), 1)
            return
        }
        TrackingService.start(this); ui.postDelayed({ render() }, 500)
    }

    override fun onRequestPermissionsResult(rc: Int, perms: Array<out String>, res: IntArray) {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) toggleSharing()
        else err.text = "Senza il permesso di posizione non posso condividere."
    }

    private fun askBattery() {
        // Apre l'elenco delle app con restrizioni batteria: lì si sceglie «Senza restrizioni» per Surfer Live.
        // Sui telefoni con gestione aggressiva (Xiaomi, Samsung, Huawei) evita che il GPS si fermi a schermo spento.
        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    private fun render() {
        val paired = pairing != null
        val sharing = TrackingService.running
        codeBox.visibility = vis(!paired); pairBtn.visibility = vis(!paired)
        val needConsent = paired && consent == false
        consentText.visibility = vis(needConsent); ageBox.visibility = vis(needConsent); agreeBtn.visibility = vis(needConsent)
        agreeBtn.isEnabled = ageBox.isChecked
        toggle.visibility = vis(paired && consent == true)
        toggle.text = if (sharing) "Interrompi condivisione" else "Avvia condivisione"
        info.visibility = vis(paired); batteryBtn.visibility = vis(paired); forget.visibility = vis(paired); unpair.visibility = vis(paired && !sharing)
        title.text = if (paired) pairing!!.name else "Surfer Live"
        TrackingService.message?.let { err.text = it }
        status.text = when {
            !paired -> "Apri il link del tuo QR oppure incolla qui il codice."
            consent == null -> "Verifico il collegamento…"
            consent == false -> "Serve il tuo consenso per condividere la posizione."
            !sharing -> "Condivisione ferma: la tua posizione non viene inviata."
            TrackingService.noGps -> "Segnale GPS assente"
            else -> "Condivisione attiva"
        }
        val up = TrackingService.uploader(this)
        fun ago(t: Long) = if (t == 0L) "–" else ((System.currentTimeMillis() - t) / 1000).let { s -> if (s < 90) "$s s fa" else "${s / 60} min fa" }
        info.text = "Ultimo punto: ${ago(TrackingService.lastFix)}\nPrecisione: ${if (TrackingService.lastFix == 0L) "–" else "${TrackingService.lastAcc.toInt()} m"}\n" +
            "In attesa di invio: ${up.pending}\nUltimo invio: ${ago(up.lastSuccess)}" + (up.lastError?.let { "\n$it" } ?: "")
    }

    private fun vis(b: Boolean) = if (b) View.VISIBLE else View.GONE
    private fun tick() { render(); ui.postDelayed({ tick() }, 2000) }
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy() }
}
