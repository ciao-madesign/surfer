package it.surfer.live

import android.content.Context

/** Ruolo scelto dall'utente (nessun account: si ricorda solo l'ultima scelta su questo telefono). */
object Role {
    const val VIEWER = "viewer"
    const val RUNNER = "runner"
    const val ORGANIZER = "organizer"
    const val TRAIN = "train"

    private fun prefs(c: Context) = c.getSharedPreferences("app", Context.MODE_PRIVATE)
    fun get(c: Context): String? = prefs(c).getString("role", null)
    fun set(c: Context, role: String?) = prefs(c).edit().apply { if (role == null) remove("role") else putString("role", role) }.apply()
}
