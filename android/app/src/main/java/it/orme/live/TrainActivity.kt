package it.orme.live

import android.os.Bundle
import android.view.View
import android.widget.LinearLayout

/** Ingresso «Allenamento / Escursione»: scelta della modalità e avviso. Il tracciamento arriva nella fase successiva (serve anche il server). */
class TrainActivity : BaseActivity() {
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        setupScreen()
        Role.set(this, Role.TRAIN)
        tv(getString(R.string.role_train), 30f, R.color.ink, 600).add(18)
        mode(R.string.train_workout, R.string.train_workout_desc).add(12)
        mode(R.string.train_hike, R.string.train_hike_desc).add(12)
        tv(getString(R.string.train_warning), 13f, R.color.muted).add(18)
        btn(getString(R.string.change_role), 1) { changeRole() }.add(10)
    }

    private fun mode(title: Int, desc: Int): View = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(18), dp(18), dp(18), dp(18)); background = box(col(R.color.card), col(R.color.border), 12)
        addView(tv(getString(title), 20f, R.color.ink, 600))
        addView(tv(getString(desc), 14f, R.color.muted).apply { setPadding(0, dp(6), 0, 0) })
    }
}
