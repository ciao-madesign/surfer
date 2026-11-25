package it.surfer.live

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.*

/** Base di tutte le schermate: stessi colori e font del sito, intestazione con il logo, tasto per tornare alla scelta del ruolo. */
open class BaseActivity : Activity() {
    protected lateinit var root: LinearLayout

    // ---------- aspetto: stessi colori e font del sito (Outfit, DM Mono) ----------
    protected fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    protected fun col(id: Int) = getColor(id)
    protected val sans by lazy { resources.getFont(R.font.outfit) }
    protected val mono by lazy { resources.getFont(R.font.dm_mono) }
    protected fun TextView.font(weight: Int = 400) { typeface = sans; setFontVariationSettings("'wght' $weight") }
    protected fun box(fill: Int, stroke: Int = 0, radius: Int = 10) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat(); if (stroke != 0) setStroke(dp(1), stroke)
    }
    protected fun <T : View> T.add(top: Int = 10): T {
        root.addView(this, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) })
        return this
    }
    protected fun tv(s: String, size: Float = 15f, color: Int = R.color.muted, weight: Int = 400) = TextView(this).apply {
        text = s; textSize = size; setTextColor(col(color)); font(weight); setLineSpacing(0f, 1.15f)
    }
    protected fun card(v: TextView) = v.apply { setPadding(dp(16), dp(14), dp(16), dp(14)); background = box(col(R.color.card), col(R.color.border), 12) }
    /** kind: 0 principale (teal), 1 secondario (bordo), 2 pericolo (rosso) */
    protected fun btn(s: String, kind: Int = 1, f: () -> Unit) = Button(this).apply {
        text = s; isAllCaps = false; stateListAnimator = null; minHeight = dp(52); textSize = 16f; font(600)
        setTextColor(col(if (kind == 0) R.color.teal_deep else if (kind == 2) R.color.error else R.color.ink))
        background = when (kind) {
            0 -> box(col(R.color.teal))
            2 -> box(Color.TRANSPARENT, col(R.color.error))
            else -> box(Color.TRANSPARENT, col(R.color.border))
        }
        setOnClickListener { f() }
    }

    /** Crea la pagina scorrevole con l'intestazione (logo + SURFER · LIVE). */
    protected fun setupScreen() {
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(24), dp(20), dp(28)) }
        setContentView(ScrollView(this).apply { addView(root); isFillViewport = true; setBackgroundColor(col(R.color.bg)) })
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(this@BaseActivity).apply { setImageResource(R.drawable.logo_mark) })
            addView(TextView(this@BaseActivity).apply {
                text = "SURFER · LIVE"; textSize = 12f; typeface = mono; letterSpacing = 0.18f; setTextColor(col(R.color.teal)); setPadding(dp(12), 0, 0, 0)
            })
        }.add(0)
    }

    /** Dimentica il ruolo scelto e riapre la schermata di scelta. */
    protected fun changeRole() {
        Role.set(this, null)
        startActivity(Intent(this, HomeActivity::class.java).putExtra(HomeActivity.STAY, true))
        finish()
    }
}
