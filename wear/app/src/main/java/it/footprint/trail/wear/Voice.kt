package it.footprint.trail.wear

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer

/** Quick-tagging vocale: ascolta circa 2 secondi (preferibilmente offline) e riconosce parole chiave. */
object Voice {
    class Tag(val icon: String?, val title: String, val dog: Boolean)

    private val rules = listOf(
        Triple(listOf("porcino", "porcini"), "porcino", "Porcino"),
        Triple(listOf("scorzone"), "scorzone", "Scorzone"),
        Triple(listOf("uncinato"), "uncinato", "Tartufo uncinato"),
        Triple(listOf("bianchetto"), "bianchetto", "Bianchetto"),
        Triple(listOf("bianco"), "bianco", "Tartufo bianco"),
        Triple(listOf("nero"), "nero", "Tartufo nero"),
        Triple(listOf("tartufo", "tartufi"), "scorzone", "Tartufo"),
        Triple(listOf("auto", "macchina", "parcheggio"), "parcheggio", "Auto parcheggiata"),
        Triple(listOf("galletto", "gallinaccio", "finferlo"), "galletto", "Galletto"),
        Triple(listOf("ovolo", "ovulo"), "ovulo", "Ovolo"),
        Triple(listOf("acqua", "sorgente", "fonte"), "acqua", "Sorgente"),
        Triple(listOf("pericolo", "attenzione"), "pericolo", "Pericolo"),
        Triple(listOf("fungo", "funghi"), "fungo", "Fungo")
    )

    fun match(text: String): Tag? {
        val t = text.lowercase()
        val dog = t.contains("cane")
        for ((keys, icon, title) in rules) {
            if (keys.any { t.contains(it) }) return Tag(icon, title, dog)
        }
        // "Cane" da solo: punto segnalato dal cane, con l'ultima icona usata
        if (dog) return Tag(null, "Cane", true)
        return null
    }

    fun listen(ctx: Context, onDone: (String?) -> Unit) {
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            onDone(null)
            return
        }
        val r = SpeechRecognizer.createSpeechRecognizer(ctx)
        val h = Handler(Looper.getMainLooper())
        var finished = false
        AppState.listening = true

        fun finish(res: String?) {
            if (finished) return
            finished = true
            AppState.listening = false
            h.removeCallbacksAndMessages(null)
            r.destroy()
            onDone(res)
        }

        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onError(error: Int) = finish(null)
            override fun onResults(results: Bundle?) {
                val l = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                finish(l?.joinToString(" "))
            }
            override fun onPartialResults(partialResults: Bundle?) {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })

        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "it-IT")
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        }
        r.startListening(i)
        h.postDelayed({
            r.stopListening()
            h.postDelayed({ finish(null) }, 1500)
        }, 2500)
    }
}
