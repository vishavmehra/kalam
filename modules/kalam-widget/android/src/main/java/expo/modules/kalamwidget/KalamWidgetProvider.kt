package expo.modules.kalamwidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * The Kalam home-screen widget (docs/14 §18, written by src/core/widgets). It draws finished text that the app
 * worked out on the phone and cannot read the app's database, run a formula or use the network. A tap opens a
 * kalam:// link, and nothing else.
 *
 * Which widget an instance shows is chosen in the app ("Add to home screen": requestPinAppWidget, answered by
 * ACTION_PINNED) or by tapping an unchosen instance (WidgetPickerActivity). The text changes by itself at the
 * midnights the app worked out ahead, through one inexact alarm. Never compiled or run: see the module README.
 */
open class KalamWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) {
    for (id in appWidgetIds) render(context, manager, id)
    scheduleNext(context)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: android.os.Bundle) {
    // The widget was resized, or moved between the home screen and the lock screen.
    render(context, manager, appWidgetId)
  }

  override fun onDeleted(context: Context, appWidgetIds: IntArray) {
    for (id in appWidgetIds) WidgetData.unbind(context, id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_PINNED -> {
        val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        val widgetId = intent.getStringExtra(EXTRA_WIDGET)
        // Only this app sends the answer (the receiver is not exported), but check anyway: the widget must exist in the stored
        // message, and the instance must be one the system really placed.
        if (
          id != AppWidgetManager.INVALID_APPWIDGET_ID && widgetId != null && WidgetData.WIDGET_ID.matches(widgetId) &&
          WidgetData.widget(context, widgetId) != null && appWidgetIds(context).contains(id)
        ) {
          WidgetData.bind(context, id, widgetId)
          render(context, AppWidgetManager.getInstance(context), id)
          scheduleNext(context)
        }
      }
      ACTION_REFRESH -> updateAll(context)
      else -> super.onReceive(context, intent)
    }
  }

  companion object {
    const val ACTION_PINNED = "expo.modules.kalamwidget.PINNED"
    const val ACTION_REFRESH = "expo.modules.kalamwidget.REFRESH"
    const val EXTRA_WIDGET = "kalam_widget_id"
    /** Rows a small instance draws. A larger one draws all the rows it was sent. */
    private const val SMALL_ROWS = 2

    private fun component(context: Context) = ComponentName(context, KalamWidgetProvider::class.java)

    fun appWidgetIds(context: Context): IntArray = AppWidgetManager.getInstance(context).getAppWidgetIds(component(context))

    /** Draws every instance again, then sets the alarm for the next change. Called after the app sends a new message. */
    fun updateAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      for (id in appWidgetIds(context)) render(context, manager, id)
      scheduleNext(context)
    }

    private fun immutable() = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

    /** What an instance shows right now: the last entry whose time has come. */
    private fun currentEntry(widget: JSONObject, now: Long): JSONObject? {
      val entries = widget.optJSONArray("entries") ?: return null
      var found: JSONObject? = null
      for (i in 0 until entries.length()) {
        val e = entries.optJSONObject(i) ?: continue
        if (e.optLong("from") <= now) found = e
      }
      return found ?: entries.optJSONObject(0)
    }

    private fun openIntent(context: Context, link: String?): Intent {
      val safe = WidgetData.safeLink(link)
      val intent =
        if (safe != null) Intent(Intent.ACTION_VIEW, Uri.parse(safe)).setPackage(context.packageName)
        else context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
      return intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }

    private fun hostedOnLockScreen(manager: AppWidgetManager, appWidgetId: Int): Boolean =
      manager.getAppWidgetOptions(appWidgetId)
        .getInt(AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY, AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN) ==
        AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD

    internal fun render(context: Context, manager: AppWidgetManager, appWidgetId: Int) {
      val views = RemoteViews(context.packageName, R.layout.kalam_widget)
      val labels = WidgetData.payload(context)?.optJSONObject("labels")
      val widget = WidgetData.boundTo(context, appWidgetId)?.let { WidgetData.widget(context, it) }
      fun text(key: String, fallback: Int) = labels?.optString(key)?.takeIf { it.isNotEmpty() } ?: context.getString(fallback)
      fun hide(vararg ids: Int) = ids.forEach { views.setViewVisibility(it, View.GONE) }
      fun show(id: Int, value: String) {
        views.setTextViewText(id, value)
        views.setViewVisibility(id, View.VISIBLE)
      }

      views.removeAllViews(R.id.kalam_widget_rows)
      if (widget == null) {
        // Not tied to one of the person's widgets yet. A tap lets them pick one.
        hide(R.id.kalam_widget_app, R.id.kalam_widget_headline, R.id.kalam_widget_rows, R.id.kalam_widget_note)
        show(R.id.kalam_widget_title, text("unboundAndroid", R.string.kalam_widget_unbound))
        views.setContentDescription(R.id.kalam_widget_root, text("unboundAndroid", R.string.kalam_widget_unbound))
        val pick = Intent(context, WidgetPickerActivity::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        views.setOnClickPendingIntent(R.id.kalam_widget_root, PendingIntent.getActivity(context, appWidgetId, pick, immutable()))
        manager.updateAppWidget(appWidgetId, views)
        return
      }

      val open = PendingIntent.getActivity(context, appWidgetId, openIntent(context, widget.optString("link")), immutable())
      views.setOnClickPendingIntent(R.id.kalam_widget_root, open)

      // "Hide when locked" (the default): on the lock screen the widget says so and shows nothing else, not even its name.
      if (widget.optBoolean("hideWhenLocked", true) && hostedOnLockScreen(manager, appWidgetId)) {
        hide(R.id.kalam_widget_app, R.id.kalam_widget_headline, R.id.kalam_widget_rows, R.id.kalam_widget_note)
        show(R.id.kalam_widget_title, text("locked", R.string.kalam_widget_locked))
        views.setContentDescription(R.id.kalam_widget_root, text("locked", R.string.kalam_widget_locked))
        manager.updateAppWidget(appWidgetId, views)
        return
      }

      val now = System.currentTimeMillis()
      val entry = currentEntry(widget, now)
      val stale = now > widget.optLong("validUntil", Long.MAX_VALUE) || entry == null
      val said = StringBuilder()
      show(R.id.kalam_widget_app, widget.optString("appName"))
      show(R.id.kalam_widget_title, widget.optString("title"))
      said.append(widget.optString("appName")).append(". ").append(widget.optString("title")).append(". ")
      hide(R.id.kalam_widget_headline, R.id.kalam_widget_rows, R.id.kalam_widget_note)

      if (stale) {
        // The app has not been opened for the whole look-ahead. Never show the last number as if it were current.
        show(R.id.kalam_widget_note, text("stale", R.string.kalam_widget_stale))
        said.append(text("stale", R.string.kalam_widget_stale))
      } else if (entry != null) {
        val headline = entry.optString("headline")
        if (headline.isNotEmpty()) {
          show(R.id.kalam_widget_headline, headline)
          said.append(headline).append(". ")
        }
        val rows = entry.optJSONArray("rows")
        val limit = if (widget.optString("size") == "small") SMALL_ROWS else Int.MAX_VALUE
        if (rows != null && rows.length() > 0) {
          views.setViewVisibility(R.id.kalam_widget_rows, View.VISIBLE)
          for (i in 0 until minOf(rows.length(), limit)) {
            val row = rows.optJSONObject(i) ?: continue
            val line = RemoteViews(context.packageName, R.layout.kalam_widget_row)
            line.setTextViewText(R.id.kalam_widget_row_text, row.optString("text"))
            said.append(row.optString("text"))
            if (row.has("detail")) {
              line.setTextViewText(R.id.kalam_widget_row_detail, row.optString("detail"))
              said.append(", ").append(row.optString("detail"))
            }
            if (row.has("done")) {
              val done = row.optBoolean("done")
              val word = if (done) text("done", R.string.kalam_widget_done) else text("notDone", R.string.kalam_widget_not_done)
              line.setTextViewText(R.id.kalam_widget_row_check, if (done) "✓" else "○")
              line.setContentDescription(R.id.kalam_widget_row_check, word)
              said.append(", ").append(word)
            } else {
              line.setViewVisibility(R.id.kalam_widget_row_check, View.GONE)
            }
            said.append(". ")
            views.addView(R.id.kalam_widget_rows, line)
          }
        }
        val note = entry.optString("note")
        if (note.isNotEmpty()) {
          show(R.id.kalam_widget_note, note)
          said.append(note)
        }
      }
      views.setContentDescription(R.id.kalam_widget_root, said.toString().trim())
      manager.updateAppWidget(appWidgetId, views)
    }

    /** One inexact alarm for the next time any instance's text changes (an entry's start, or the end of the look-ahead). Needs no permission. */
    internal fun scheduleNext(context: Context) {
      val now = System.currentTimeMillis()
      var next = Long.MAX_VALUE
      for (id in appWidgetIds(context)) {
        val widget = WidgetData.boundTo(context, id)?.let { WidgetData.widget(context, it) } ?: continue
        val entries = widget.optJSONArray("entries")
        if (entries != null) {
          for (i in 0 until entries.length()) {
            val from = entries.optJSONObject(i)?.optLong("from") ?: continue
            if (from > now && from < next) next = from
          }
        }
        val validUntil = widget.optLong("validUntil")
        if (validUntil > now && validUntil < next) next = validUntil
      }
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val intent = Intent(context, KalamWidgetProvider::class.java).setAction(ACTION_REFRESH)
      val pending = PendingIntent.getBroadcast(context, 0, intent, immutable())
      if (next == Long.MAX_VALUE) alarms.cancel(pending) else alarms.set(AlarmManager.RTC, next, pending)
    }

    /** True when this launcher lets an app ask for a widget to be added (Android 8 and later, and a launcher that supports it). */
    fun canPin(context: Context): Boolean =
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported
  }
}
