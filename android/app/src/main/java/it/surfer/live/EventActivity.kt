package it.surfer.live

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

/** Mostra la gara in diretta dentro l'app: è la stessa pagina /live del sito, quindi sito e app sono identici. */
class EventActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val token = intent.getStringExtra("t") ?: run { finish(); return }
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0a0f14"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                // Si resta sul nostro sito; qualsiasi altro indirizzo si apre nel browser.
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val u = request?.url ?: return true
                    if (u.host == Config.HOST) return false
                    if (u.scheme == "http" || u.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
            }
        }
        setContentView(web)
        web.loadUrl("${Config.SERVER}/live#$token")
    }

    @Deprecated("Back")
    override fun onBackPressed() { if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed() }

    override fun onDestroy() { if (::web.isInitialized) web.destroy(); super.onDestroy() }
}
