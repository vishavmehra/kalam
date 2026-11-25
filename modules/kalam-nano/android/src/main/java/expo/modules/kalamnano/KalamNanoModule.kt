package expo.modules.kalamnano

import com.google.firebase.Firebase
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceExtension
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.ai
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Gemini Nano on Android through Firebase AI Logic's on-device SDK, plus App Check tokens from Play
 * Integrity. Sources, read 2026-11-18:
 *  - https://firebase.google.com/docs/ai-logic/hybrid/android/get-started (firebase-ai 18.2.0 +
 *    firebase-ai-ondevice 16.0.0-beta08, Experimental; on-device runs the ML Kit Prompt API on AICore)
 *  - https://firebase.google.com/docs/reference/kotlin/com/google/firebase/ai/OnDeviceExtension
 *    (checkStatus, download, warmUp, getModelName; FirebaseAIOnDevice.* is deprecated)
 *  - https://firebase.google.com/docs/ai-logic/hybrid/android/generate-structured-output (on-device
 *    structured output needs compile-time @Generable classes, so Kalam puts the runtime JSON Schema in
 *    the prompt and validates the answer with Zod in JS)
 *
 * Choosing between Nano and the cloud stays in the JS SDK (firebase/ai). This module only runs
 * ONLY_ON_DEVICE requests, so everything generate() returns was produced on the phone.
 * Not compiled or device-tested yet: see modules/kalam-nano/README.md.
 */
@OptIn(PublicPreviewAPI::class)
class KalamNanoModule : Module() {
  /** Running generate() calls by request id, so a JS AbortSignal can cancel them. */
  private val jobs = ConcurrentHashMap<String, Job>()

  /** One model per sampling config: OnDeviceConfig is fixed for the lifetime of a GenerativeModel. */
  private val models = ConcurrentHashMap<String, GenerativeModel>()

  override fun definition() = ModuleDefinition {
    Name("KalamNano")
    Events("onDownloadProgress")

    // Public EXPO_PUBLIC_FIREBASE_* identifiers, no secrets. Safe to call more than once.
    Function("configure") { options: FirebaseConfig -> ensureFirebaseApp(options) }

    AsyncFunction("availability") Coroutine { -> status() }

    // Downloads only when asked (a user action in Settings), then loads the model into memory.
    AsyncFunction("prepare") Coroutine { ->
      val ext = extension()
      if (ext != null) {
        val before = ext.checkStatus()
        if (before == OnDeviceModelStatus.DOWNLOADABLE || before == OnDeviceModelStatus.DOWNLOADING) download(ext)
        if (ext.checkStatus() == OnDeviceModelStatus.AVAILABLE) ext.warmUp()
      }
      status()
    }

    AsyncFunction("warmUp") Coroutine { ->
      val ext = extension()
      ext?.warmUp()
      ext != null
    }

    AsyncFunction("generate") Coroutine { requestId: String, options: GenerateOptions ->
      currentCoroutineContext()[Job]?.let { jobs[requestId] = it }
      try {
        val response = model(options).generateContent(options.prompt)
        mapOf(
          "text" to (response.text ?: ""),
          "source" to if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "cloud",
        )
      } finally {
        jobs.remove(requestId)
      }
    }

    Function("cancel") { requestId: String -> jobs.remove(requestId)?.cancel() != null }

    Function("installPlayIntegrity") {
      FirebaseAppCheck.getInstance(app()).installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
    }

    AsyncFunction("getAppCheckToken") Coroutine { forceRefresh: Boolean -> appCheckToken(forceRefresh) }

    OnDestroy {
      jobs.values.forEach { it.cancel() }
      jobs.clear()
    }
  }

  private fun ensureFirebaseApp(options: FirebaseConfig) {
    val context = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()
    if (FirebaseApp.getApps(context).any { it.name == APP_NAME }) return
    FirebaseApp.initializeApp(
      context,
      FirebaseOptions.Builder()
        .setApiKey(options.apiKey)
        .setApplicationId(options.appId)
        .setProjectId(options.projectId)
        .build(),
      APP_NAME,
    )
  }

  private fun app(): FirebaseApp = FirebaseApp.getInstance(APP_NAME)

  private fun model(options: GenerateOptions? = null): GenerativeModel {
    val key = "${options?.temperature}/${options?.topK}/${options?.maxOutputTokens}"
    return models.getOrPut(key) {
      Firebase.ai(app = app(), backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = UNUSED_CLOUD_MODEL,
        onDeviceConfig = OnDeviceConfig(
          mode = InferenceMode.ONLY_ON_DEVICE,
          maxOutputTokens = options?.maxOutputTokens,
          temperature = options?.temperature?.toFloat(),
          topK = options?.topK,
        ),
      )
    }
  }

  private fun extension(): OnDeviceExtension? = model().onDeviceExtension

  /** availability (unavailable | downloadable | downloading | available), AICore model name, detail. */
  private suspend fun status(): Map<String, Any?> = try {
    val ext = extension()
    val availability = when (ext?.checkStatus()) {
      OnDeviceModelStatus.AVAILABLE -> "available"
      OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
      OnDeviceModelStatus.DOWNLOADING -> "downloading"
      else -> "unavailable"
    }
    mapOf(
      "availability" to availability,
      "model" to if (availability == "available") runCatching { ext?.getModelName() }.getOrNull() else null,
      "detail" to if (ext == null) "This build has no Firebase on-device AI SDK." else null,
    )
  } catch (e: Exception) {
    // No AICore (emulators), an unsupported phone, AICore still setting up, or an unlocked bootloader.
    mapOf("availability" to "unavailable", "detail" to (e.message ?: e.javaClass.simpleName))
  }

  private suspend fun download(ext: OnDeviceExtension) {
    var total: Long? = null
    ext.download().collect { status ->
      when (status) {
        is DownloadStatus.DownloadStarted -> {
          total = status.bytesToDownload
          progress(0L, total)
        }
        is DownloadStatus.DownloadInProgress -> progress(status.totalBytesDownloaded, total)
        is DownloadStatus.DownloadFailed -> throw CodedException("ERR_NANO_DOWNLOAD", status.exception.message, status.exception)
        else -> Unit // DownloadCompleted
      }
    }
  }

  private fun progress(done: Long, total: Long?) {
    sendEvent("onDownloadProgress", mapOf("bytesDownloaded" to done.toDouble(), "bytesToDownload" to total?.toDouble()))
  }

  private suspend fun appCheckToken(forceRefresh: Boolean): Map<String, Any> = suspendCancellableCoroutine { cont ->
    FirebaseAppCheck.getInstance(app()).getAppCheckToken(forceRefresh)
      .addOnSuccessListener { token ->
        cont.resume(mapOf("token" to token.token, "expireTimeMillis" to token.expireTimeMillis.toDouble()))
      }
      .addOnFailureListener { error -> cont.resumeWithException(error) }
  }

  companion object {
    /** A named app, so it never collides with a default app from google-services.json. */
    private const val APP_NAME = "kalam"

    /** generativeModel() requires a cloud model name; ONLY_ON_DEVICE never calls the cloud. */
    private const val UNUSED_CLOUD_MODEL = "gemini-2.5-flash-lite"
  }
}

class FirebaseConfig : Record {
  @Field var apiKey: String = ""

  @Field var projectId: String = ""

  @Field var appId: String = ""
}

class GenerateOptions : Record {
  @Field var prompt: String = ""

  /** Unset means the on-device defaults (temperature 0, greedy decoding). */
  @Field var temperature: Double? = null

  @Field var topK: Int? = null

  @Field var maxOutputTokens: Int? = null
}
