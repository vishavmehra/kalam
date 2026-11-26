package expo.modules.kalamwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS side: modules/kalam-widget/index.ts. Home-screen widgets for Kalam (docs/14 §18). The app sends one finished
 * message (src/core/widgets/payload.ts) with the text each widget shows. This module stores it, redraws the
 * widgets, and can ask the system to add one to the home screen. It gives the JS side nothing back but counts.
 *
 * Sources, read 2026-11-25:
 *  - https://developer.android.com/develop/ui/views/appwidgets/configuration (pinning: AppWidgetManager.requestPinAppWidget,
 *    isRequestPinAppWidgetSupported, the success callback carries EXTRA_APPWIDGET_ID; API 26 and later)
 *  - https://developer.android.com/reference/android/appwidget/AppWidgetManager#OPTION_APPWIDGET_HOST_CATEGORY
 *    (the host category tells a home-screen instance from a lock-screen one)
 * Never compiled or run: see README.md.
 */
class KalamWidgetModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() =
    ModuleDefinition {
      Name("KalamWidget")

      AsyncFunction("availability") {
        mapOf("supported" to true, "platform" to "android", "canPin" to KalamWidgetProvider.canPin(context), "canCount" to true)
      }

      /** Stores the message and redraws every instance. Returns the number of widgets it holds. */
      AsyncFunction("publish") { json: String ->
        val count =
          try {
            WidgetData.save(context, json)
          } catch (e: Exception) {
            throw CodedException("ERR_WIDGET_MESSAGE", e.message ?: "The widget message was not accepted.", e)
          }
        KalamWidgetProvider.updateAll(context)
        count
      }

      /** Forgets the message. Instances already on the home screen stay and ask the person to pick again. */
      AsyncFunction("clear") {
        WidgetData.clear(context)
        KalamWidgetProvider.updateAll(context)
      }

      /** Asks the launcher to add an instance of this widget. The person answers in a system dialog. */
      AsyncFunction("requestPin") { widgetId: String ->
        when {
          !WidgetData.WIDGET_ID.matches(widgetId) || WidgetData.widget(context, widgetId) == null ->
            mapOf("ok" to false, "reason" to "unknown_widget")
          !KalamWidgetProvider.canPin(context) -> mapOf("ok" to false, "reason" to "unsupported")
          else -> {
            val manager = AppWidgetManager.getInstance(context)
            val provider = ComponentName(context, KalamWidgetProvider::class.java)
            val answer =
              Intent(context, KalamWidgetProvider::class.java)
                .setAction(KalamWidgetProvider.ACTION_PINNED)
                .putExtra(KalamWidgetProvider.EXTRA_WIDGET, widgetId)
            // The system adds the new instance's id to this intent, so it has to be mutable (required from Android 12).
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            val callback = PendingIntent.getBroadcast(context, widgetId.hashCode(), answer, flags)
            if (manager.requestPinAppWidget(provider, null, callback)) mapOf("ok" to true) else mapOf("ok" to false, "reason" to "failed")
          }
        }
      }

      /** Widget id to the number of instances on the home screen (and lock screen). */
      AsyncFunction("placed") {
        val counts = HashMap<String, Int>()
        for (id in KalamWidgetProvider.appWidgetIds(context)) {
          val widgetId = WidgetData.boundTo(context, id) ?: continue
          counts[widgetId] = (counts[widgetId] ?: 0) + 1
        }
        counts
      }
    }
}
