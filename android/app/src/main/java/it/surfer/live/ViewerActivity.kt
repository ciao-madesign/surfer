package it.surfer.live

import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Toast
import java.util.concurrent.Executors

/** Ruolo «Spettatore»: elenco degli eventi seguiti. Si aggiunge da link, QR o aprendo un link di gara; si guarda dentro l'app. */
class ViewerActivity : BaseActivity() {
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())
    private lateinit var list: LinearLayout

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setupScreen()
        Role.set(this, Role.VIEWER)
        tv(getString(R.string.events_title), 30f, R.color.ink, 600).add(18)
        btn(getString(R.string.events_add), 0) { showAdd() }.add(16)
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }.add(8)
        btn(getString(R.string.change_role), 1) { changeRole() }.add(24)
        handle(intent)
    }

    override fun onNewIntent(i: Intent) { super.onNewIntent(i); handle(i) }

    /** Un link di gara aperto da fuori (messaggio, browser) viene aggiunto e aperto. */
    private fun handle(i: Intent?) { i?.data?.let { u -> intent = Intent(); addLink(u.toString(), true) } }

    override fun onResume() { super.onResume(); render(); refresh() }

    private fun toast(id: Int) = Toast.makeText(this, getString(id), Toast.LENGTH_LONG).show()

    /** Restituisce true se il link è stato accettato (nuovo o già presente). */
    private fun addLink(input: String, open: Boolean): Boolean {
        val token = Events.parseToken(input) ?: run { toast(R.string.link_invalid); return false }
        if (Events.add(this, token)) { render(); refresh() } else if (!open) { toast(R.string.already_added); return true }
        if (open) openEvent(token)
        return true
    }

    private fun openEvent(token: String) = startActivity(Intent(this, EventActivity::class.java).putExtra("t", token))

    private fun showAdd() {
        val input = EditText(this).apply { hint = getString(R.string.add_hint); font(); textSize = 15f; setSingleLine(false); minLines = 2; gravity = Gravity.TOP }
        val frame = FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(input) }
        val d = AlertDialog.Builder(this).setTitle(getString(R.string.add_title)).setView(frame)
            .setPositiveButton(getString(R.string.add_confirm), null)
            .setNeutralButton(getString(R.string.scan_qr), null)
            .create()
        d.show()
        // I due pulsanti non chiudono la finestra se il link non è valido o la scansione non parte.
        d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener { if (addLink(input.text.toString(), false)) d.dismiss() }
        d.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener { scanQr { raw -> if (addLink(raw, false)) d.dismiss() } }
    }

    private fun confirmRemove(e: Event) {
        val d = AlertDialog.Builder(this).setMessage(getString(R.string.unfollow_title))
            .setPositiveButton(getString(R.string.unfollow_confirm)) { _, _ -> Events.remove(this, e.token); render() }
            .setNegativeButton(getString(R.string.cancel), null)
            .create()
        d.show()
        d.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(col(R.color.error))
    }

    private fun render() {
        list.removeAllViews()
        val events = Events.load(this)
        if (events.isEmpty()) {
            list.addView(tv(getString(R.string.events_empty), 15f, R.color.faint).apply { setPadding(0, dp(8), 0, 0) })
            return
        }
        for (e in events) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(18), dp(8), dp(8), dp(8)); background = box(col(R.color.card), col(R.color.border), 12)
                isClickable = true; setOnClickListener { openEvent(e.token) }
            }
            val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(8)) }
            texts.addView(tv(e.name ?: getString(R.string.event_unnamed), 18f, R.color.ink, 600))
            when (e.state) {
                "expired" -> texts.addView(tv(getString(R.string.event_expired), 14f, R.color.error))
                "ended" -> texts.addView(tv(getString(R.string.event_ended), 14f, R.color.muted))
            }
            row.addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(ImageView(this).apply {
                setImageResource(R.drawable.ic_trash); contentDescription = getString(R.string.unfollow_confirm)
                setPadding(dp(12), dp(12), dp(12), dp(12)); setOnClickListener { confirmRemove(e) }
            }, LinearLayout.LayoutParams(dp(48), dp(48)))
            list.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        }
    }

    /** Aggiorna nome e stato di ogni evento dal server. */
    private fun refresh() {
        for (e in Events.load(this)) io.execute {
            val (code, j) = Events.fetch(e.token)
            when {
                code == 200 && j != null -> {
                    val race = j.optJSONObject("race")
                    Events.update(this, e.token, race?.optString("name")?.ifEmpty { null }, if (race?.optString("status") == "ended") "ended" else null)
                }
                code == 410 -> Events.update(this, e.token, null, "ended")
                code == 401 -> Events.update(this, e.token, null, "expired")
            }
            if (code != 0) ui.post { if (!isFinishing) render() }
        }
    }

    override fun onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy() }
}
