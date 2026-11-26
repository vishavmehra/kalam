package expo.modules.kalamnano

import android.content.pm.PackageManager
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
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

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
 * Why the model cannot run (the `reason` in status()), read 2026-11-25:
 *  - https://developers.google.com/ml-kit/genai/prompt/android/get-started, "Common setup issues":
 *    601-BINDING_FAILURE, 606-FEATURE_NOT_FOUND, 1-DOWNLOAD_ERROR ("Unable to resolve host")
 *  - https://developers.google.com/android/reference/kotlin/com/google/mlkit/genai/common/GenAiException.ErrorCode
 *  - firebase-android-sdk ai-logic/firebase-ai-ondevice GenerativeModelImpl.kt: checkStatus() returns ML Kit's
 *    FeatureStatus with no error, so a failed AICore bind reads as UNAVAILABLE (seen on a Pixel 10 in Firebase
 *    Test Lab, docs/evidence/android-nano-pixel10-2026-11-25), while getBaseModelName() lets the error through.
 *
 * Choosing between Nano and the cloud stays in the JS SDK (firebase/ai). This module only runs
 * ONLY_ON_DEVICE requests, so everything generate() returns was produced on the phone.
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

    // Downloads only when asked (a person's choice in Settings or the self-check), then loads the model.
    AsyncFunction("prepare") Coroutine { -> prepareModel() }

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

    // Called by the JS App Check provider on its first token request, which only a cloud request makes.
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

  /**
   * availability (unavailable | downloadable | downloading | available), the AICore model name, and when the
   * model cannot run now: `reason` (OnDeviceReason in src/core/contracts), the AICore or ML Kit error `code`,
   * and the raw error text as `detail`.
   */
  private suspend fun status(): Map<String, Any?> = try {
    val ext = extension()
    if (ext == null) {
      mapOf("availability" to "unavailable", "reason" to "unknown", "detail" to "This build has no Firebase on-device AI SDK.")
    } else {
      when (ext.checkStatus()) {
        OnDeviceModelStatus.AVAILABLE -> mapOf("availability" to "available", "model" to runCatching { ext.getModelName() }.getOrNull())
        OnDeviceModelStatus.DOWNLOADABLE -> mapOf("availability" to "downloadable", "reason" to "model_downloadable")
        OnDeviceModelStatus.DOWNLOADING -> mapOf("availability" to "downloading", "reason" to "model_downloading")
        else -> unavailable(whyUnavailable(ext))
      }
    }
  } catch (e: CancellationException) {
    throw e
  } catch (e: Exception) {
    // No AICore (emulators), an unsupported phone, AICore still setting up, or an unlocked bootloader.
    unavailable(if (aicoreInstalled()) failure(e) else mapOf("reason" to "aicore_missing"))
  }

  private fun unavailable(why: Map<String, Any?>): Map<String, Any?> = mapOf<String, Any?>("availability" to "unavailable") + why

  /**
   * Why checkStatus() said UNAVAILABLE. It folds AICore failures into that answer, so this checks that AICore is
   * installed, then asks for the model name, which throws the underlying AICore or ML Kit error instead.
   */
  private suspend fun whyUnavailable(ext: OnDeviceExtension): Map<String, Any?> {
    if (!aicoreInstalled()) return mapOf("reason" to "aicore_missing")
    val error = try {
      withTimeoutOrNull(PROBE_TIMEOUT_MS) { ext.getModelName() }
      null
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      e
    }
    // No error to read: ML Kit's own words for UNAVAILABLE are "not supported on this device or device hasn't
    // fetched the latest configuration to support it".
    return if (error == null) mapOf("reason" to "device_not_supported") else failure(error)
  }

  /** False when Android AICore is not installed or is turned off. AndroidManifest.xml makes it visible (Android 11+). */
  @Suppress("DEPRECATION")
  private fun aicoreInstalled(): Boolean {
    val packages = appContext.reactContext?.packageManager ?: return true
    return try {
      packages.getApplicationInfo(AICORE_PACKAGE, 0).enabled
    } catch (e: PackageManager.NameNotFoundException) {
      false
    }
  }

  /** reason, error code and the raw text, read from an exception and its causes. */
  private fun failure(error: Throwable): Map<String, Any?> {
    val chain = generateSequence(error) { it.cause }.take(8).toList()
    val text = chain.mapNotNull { it.message }.distinct().joinToString(" | ")
    // AICore names its own code in the message: "error code 601-BINDING_FAILURE" (Pixel 10, Test Lab, 2026-11-25).
    val named = Regex("""error code (-?\d+)-([A-Z_]+)""").find(text)
    val code = named?.groupValues?.get(1)?.toIntOrNull()
      ?: chain.firstNotNullOfOrNull { mlKitCode(it) }
      ?: Regex("""\[ErrorCode (-?\d+)]""").find(text)?.groupValues?.get(1)?.toIntOrNull()
    val name = named?.groupValues?.get(2) ?: code?.let { ML_KIT_CODES[it] }
    val reason = when (name) {
      "BINDING_FAILURE", "BINDING_DIED", "NULL_BINDING", "SERVICE_DISCONNECTED" -> "binding_failure"
      "FEATURE_NOT_FOUND" -> "aicore_not_ready"
      "NEEDS_SYSTEM_UPDATE" -> "needs_system_update"
      "AICORE_INCOMPATIBLE" -> "aicore_missing"
      "NOT_ENOUGH_DISK_SPACE" -> "low_storage"
      "BUSY", "PER_APP_BATTERY_USE_QUOTA_EXCEEDED", "DOWNLOAD_ERROR" -> "battery_or_network_conditions"
      "NOT_AVAILABLE" -> "device_not_supported"
      else -> if (text.contains("Unable to resolve host", ignoreCase = true)) "battery_or_network_conditions" else "unknown"
    }
    return mapOf("reason" to reason, "code" to code, "detail" to text.ifEmpty { error.javaClass.simpleName })
  }

  /** GenAiException.getErrorCode(), looked up by name: ML Kit comes with firebase-ai-ondevice, Kalam does not import it. */
  private fun mlKitCode(t: Throwable): Int? = runCatching { t.javaClass.getMethod("getErrorCode").invoke(t) as? Int }.getOrNull()

  /** Downloads the model if it is downloadable or already downloading, then loads it. Failures become the reason. */
  private suspend fun prepareModel(): Map<String, Any?> {
    val ext = extension() ?: return status()
    try {
      val before = ext.checkStatus()
      if (before == OnDeviceModelStatus.DOWNLOADABLE || before == OnDeviceModelStatus.DOWNLOADING) download(ext)
      if (ext.checkStatus() == OnDeviceModelStatus.AVAILABLE) ext.warmUp()
    } catch (e: CancellationException) {
      throw e
    } catch (e: Exception) {
      return status() + failure(e)
    }
    return status()
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

    private const val AICORE_PACKAGE = "com.google.android.aicore"

    /** The model-name probe in whyUnavailable() normally fails within milliseconds; never hold a status check longer. */
    private const val PROBE_TIMEOUT_MS = 3_000L

    /** GenAiException.ErrorCode values that map to a reason; AICore's own codes come with their names. */
    private val ML_KIT_CODES = mapOf(
      -101 to "AICORE_INCOMPATIBLE",
      8 to "NOT_AVAILABLE",
      9 to "BUSY",
      27 to "PER_APP_BATTERY_USE_QUOTA_EXCEEDED",
      501 to "NOT_ENOUGH_DISK_SPACE",
      601 to "BINDING_FAILURE",
      604 to "NEEDS_SYSTEM_UPDATE",
      606 to "FEATURE_NOT_FOUND",
    )
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
