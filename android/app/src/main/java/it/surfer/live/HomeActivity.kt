package it.surfer.live

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** Schermata iniziale: sceglie il ruolo. Se un ruolo è già stato scelto, apre direttamente quello (salvo «Torna alla scelta»). */
class HomeActivity : BaseActivity() {
    companion object { const val STAY = "stay" }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        if (!intent.getBooleanExtra(STAY, false)) {
            when (Role.get(this)) {
                Role.VIEWER -> return open(ViewerActivity::class.java)
                Role.RUNNER -> return open(RunnerActivity::class.java)
                Role.ORGANIZER -> return open(OrganizerActivity::class.java)
            }
        }
        setupScreen()
        tv(getString(R.string.home_title), 30f, R.color.ink, 600).add(18)
        choice(R.string.role_viewer, R.string.role_viewer_desc, Role.VIEWER, ViewerActivity::class.java).add(24)
        choice(R.string.role_runner, R.string.role_runner_desc, Role.RUNNER, RunnerActivity::class.java).add(12)
        choice(R.string.role_organizer, R.string.role_organizer_desc, Role.ORGANIZER, OrganizerActivity::class.java).add(12)
    }

    private fun open(c: Class<*>) { startActivity(Intent(this, c)); finish() }

    /** Una scelta: titolo e, se il testo esiste, una riga di spiegazione. */
    private fun choice(title: Int, desc: Int, role: String, target: Class<*>): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(18), dp(18), dp(18)); background = box(col(R.color.card), col(R.color.border), 12)
        isClickable = true
        addView(tv(getString(title), 20f, R.color.ink, 600))
        getString(desc).takeIf { it.isNotBlank() }?.let { addView(tv(it, 14f, R.color.muted).apply { setPadding(0, dp(6), 0, 0) }) }
        setOnClickListener { Role.set(this@HomeActivity, role); open(target) }
    }
}
