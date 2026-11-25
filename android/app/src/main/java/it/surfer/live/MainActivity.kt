package it.surfer.live

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
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
    private lateinit var scanBtn: Button
    private lateinit var codeBox: EditText
    private lateinit var pairBtn: Button
    private lateinit var ageBox: CheckBox
    private lateinit var agreeBtn: Button
    private lateinit var consentText: TextView
    private lateinit var toggle: Button
    private lateinit var batteryBtn: Button
    private lateinit var forget: Button
    private lateinit var unpair: Button

    // ---------- aspetto: stessi colori e font del sito (Outfit, DM Mono) ----------
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private fun col(id: Int) = getColor(id)
    private val sans by lazy { resources.getFont(R.font.outfit) }
    private val mono by lazy { resources.getFont(R.font.dm_mono) }
    private fun TextView.font(weight: Int = 400) { typeface = sans; setFontVariationSettings("'wght' $weight") }
    private fun box(fill: Int, stroke: Int = 0, radius: Int = 10) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke != 0) setStroke(dp(1), stroke)
    }
    private fun <T : View> T.add(top: Int = 10): T {
        root.addView(this, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) })
        return this
    }
    private fun tv(s: String, size: Float = 15f, color: Int = R.color.muted, weight: Int = 400) = TextView(this).apply {
        text = s; textSize = size; setTextColor(col(color)); font(weight); setLineSpacing(0f, 1.15f)
    }
    private fun card(v: TextView) = v.apply { setPadding(dp(16), dp(14), dp(16), dp(14)); background = box(col(R.color.card), col(R.color.border), 12) }
    /** kind: 0 principale (teal), 1 secondario (bordo), 2 pericolo (rosso) */
    private fun btn(s: String, kind: Int = 1, f: () -> Unit) = Button(this).apply {
        text = s; isAllCaps = false; stateListAnimator = null; minHeight = dp(52); textSize = 16f; font(600)
        setTextColor(col(if (kind == 0) R.color.teal_deep else if (kind == 2) R.color.error else R.color.ink))
        background = when (kind) {
            0 -> box(col(R.color.teal))
            2 -> box(Color.TRANSPARENT, col(R.color.error))
            else -> box(Color.TRANSPARENT, col(R.color.border))
        }
        setOnClickListener { f() }
    }
    private lateinit var dot: GradientDrawable
    private fun setDot(color: Int) { dot.setColor(col(color)) }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(24), dp(20), dp(28)) }
        setContentView(ScrollView(this).apply { addView(root); isFillViewport = true; setBackgroundColor(col(R.color.bg)) })
        // intestazione: logo + etichetta
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(this@MainActivity).apply { setImageResource(R.drawable.logo_mark) })
            addView(TextView(this@MainActivity).apply {
                text = "SURFER · LIVE"; textSize = 12f; typeface = mono; letterSpacing = 0.18f; setTextColor(col(R.color.teal)); setPadding(dp(12), 0, 0, 0)
            })
        }.add(0)
        title = tv("Surfer Live", 30f, R.color.ink, 600).add(18)
        dot = box(col(R.color.faint), 0, 50).apply { setSize(dp(10), dp(10)); shape = GradientDrawable.OVAL }
        status = tv("", 16f, R.color.ink).apply { setCompoundDrawablesRelativeWithIntrinsicBounds(dot, null, null, null); compoundDrawablePadding = dp(10); gravity = Gravity.CENTER_VERTICAL }.add(6)
        scanBtn = btn("Scansiona il QR code", 0) { scan() }.add(20)
        codeBox = EditText(this).apply {
            hint = "Oppure incolla qui il link o il codice"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 2
            font(); textSize = 15f; setTextColor(col(R.color.ink)); setHintTextColor(col(R.color.faint)); gravity = Gravity.TOP
            setPadding(dp(14), dp(12), dp(14), dp(12)); background = box(col(R.color.panel), col(R.color.border))
        }.add(16)
        pairBtn = btn("Collega", 1) { doPair(codeBox.text.toString()) }.add(10)
        consentText = card(tv("Durante la gara la tua posizione e il tuo nome sono visibili a chi ha il link della gara. Le posizioni vengono cancellate 24 ore dopo la fine; il report con i tempi resta 3 giorni. Puoi cancellare i tuoi dati in qualsiasi momento da questa app.", 14f)).add(16)
        ageBox = CheckBox(this).apply {
            text = "Ho almeno 14 anni, oppure sono il genitore o tutore e acconsento per un minore."; textSize = 14f; font(); setTextColor(col(R.color.muted))
            setOnCheckedChangeListener { _, c -> agreeBtn.isEnabled = c; agreeBtn.alpha = if (c) 1f else 0.4f }
        }.add(8)
        agreeBtn = btn("Acconsento", 0) { doConsent() }.add(8)
        toggle = btn("Avvia condivisione", 0) { toggleSharing() }.add(18)
        info = card(tv("", 13f, R.color.muted).apply { typeface = mono; setLineSpacing(0f, 1.3f) }).add(14)
        err = tv("", 14f, R.color.error).add(10)
        batteryBtn = btn("Impostazioni batteria (consigliato: senza restrizioni)", 1) { askBattery() }.add(18)
        unpair = btn("Scollega questo telefono", 1) { if (!TrackingService.running) { Pairing.save(this, null); pairing = null; consent = null; render() } }.add(10)
        forget = btn("Cancella i miei dati", 2) { doForget() }.add(10)
        tv("Consigli: tieni attivo il GPS e disattiva il risparmio energetico. La notifica resta visibile finché condividi.", 13f, R.color.faint).add(18)
        handle(intent)
        tick()
    }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }

    /** Il QR di /gestisci apre l'app direttamente con il collegamento già dentro. */
    private fun handle(i: Intent?) { i?.data?.let { u -> doPair(u.toString()); intent = Intent() } }

    override fun onResume() { super.onResume(); pairing = Pairing.load(this); if (pairing != null && consent == null) loadMe(); render() }

    private fun scan() {
        val opts = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(this, opts).startScan()
            .addOnSuccessListener { b -> b.rawValue?.let { doPair(it) } }
            .addOnFailureListener { err.text = "Scanner non disponibile su questo telefono: incolla il link nel campo qui sotto." }
    }

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
        scanBtn.visibility = vis(!paired); codeBox.visibility = vis(!paired); pairBtn.visibility = vis(!paired)
        val needConsent = paired && consent == false
        consentText.visibility = vis(needConsent); ageBox.visibility = vis(needConsent); agreeBtn.visibility = vis(needConsent)
        agreeBtn.isEnabled = ageBox.isChecked; agreeBtn.alpha = if (ageBox.isChecked) 1f else 0.4f
        toggle.visibility = vis(paired && consent == true)
        toggle.text = if (sharing) "Interrompi condivisione" else "Avvia condivisione"
        toggle.background = if (sharing) box(Color.TRANSPARENT, col(R.color.error)) else box(col(R.color.teal))
        toggle.setTextColor(col(if (sharing) R.color.error else R.color.teal_deep))
        info.visibility = vis(paired); batteryBtn.visibility = vis(paired); forget.visibility = vis(paired); unpair.visibility = vis(paired && !sharing)
        title.text = if (paired) pairing!!.name else "Collega il telefono"
        TrackingService.message?.let { err.text = it }
        err.visibility = vis(err.text.isNotEmpty())
        status.text = when {
            !paired -> "Scansiona il QR dell'organizzatore oppure incolla il link."
            consent == null -> "Verifico il collegamento…"
            consent == false -> "Serve il tuo consenso per condividere la posizione."
            !sharing -> "Condivisione ferma: la tua posizione non viene inviata."
            TrackingService.noGps -> "Segnale GPS assente"
            else -> "Condivisione attiva"
        }
        setDot(when { !paired || consent != true || !sharing -> R.color.faint; TrackingService.noGps -> R.color.warn; else -> R.color.teal })
        val up = TrackingService.uploader(this)
        fun ago(t: Long) = if (t == 0L) "–" else ((System.currentTimeMillis() - t) / 1000).let { s -> if (s < 90) "$s s fa" else "${s / 60} min fa" }
        info.text = "Ultimo punto: ${ago(TrackingService.lastFix)}\nPrecisione: ${if (TrackingService.lastFix == 0L) "–" else "${TrackingService.lastAcc.toInt()} m"}\n" +
            "In attesa di invio: ${up.pending}\nUltimo invio: ${ago(up.lastSuccess)}" + (up.lastError?.let { "\n$it" } ?: "")
    }

    private fun vis(b: Boolean) = if (b) View.VISIBLE else View.GONE
    private fun tick() { render(); ui.postDelayed({ tick() }, 2000) }
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy() }
}
