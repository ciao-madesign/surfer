package it.surfer.live

import android.os.Bundle

/** Schermata del ruolo «viewer»: per ora solo titolo e ritorno alla scelta. Il contenuto arriva nelle fasi successive (vedi ROADMAP.md). */
class ViewerActivity : BaseActivity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setupScreen()
        Role.set(this, Role.VIEWER)
        tv(getString(R.string.role_viewer), 30f, R.color.ink, 600).add(18)
        btn(getString(R.string.change_role), 1) { changeRole() }.add(24)
    }
}
