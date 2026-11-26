package expo.modules.kalamwidget

import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.os.Bundle

/**
 * Opens when someone taps a Kalam widget that is not tied to one of their widgets yet (added from the widget list
 * instead of from the app). Lists the widgets the app has sent and ties this instance to the one they pick.
 * Not exported: only the widget's own PendingIntent starts it.
 */
class WidgetPickerActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
      finish()
      return
    }
    val widgets = WidgetData.widgets(this)
    val builder =
      AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
        .setTitle(R.string.kalam_widget_picker_title)
        .setOnCancelListener { finish() }
    if (widgets.isEmpty()) {
      builder.setMessage(R.string.kalam_widget_picker_none).setPositiveButton(R.string.kalam_widget_ok) { _, _ -> finish() }
    } else {
      val names = widgets.map { "${it.optString("title")} (${it.optString("appName")})" }.toTypedArray()
      builder.setItems(names) { _, which ->
        WidgetData.bind(this, appWidgetId, widgets[which].optString("id"))
        KalamWidgetProvider.render(this, AppWidgetManager.getInstance(this), appWidgetId)
        KalamWidgetProvider.scheduleNext(this)
        finish()
      }
    }
    builder.show()
  }
}
