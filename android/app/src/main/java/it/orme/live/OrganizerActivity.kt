package it.orme.live

import android.os.Bundle

/** Schermata del ruolo «organizer»: per ora solo titolo e ritorno alla scelta. Il contenuto arriva nelle fasi successive (vedi ROADMAP.md). */
class OrganizerActivity : BaseActivity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setupScreen()
        Role.set(this, Role.ORGANIZER)
        tv(getString(R.string.role_organizer), 30f, R.color.ink, 600).add(18)
        btn(getString(R.string.change_role), 1) { changeRole() }.add(24)
    }
}
