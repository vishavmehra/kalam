package expo.modules.kalamwidget

import android.content.Context
import org.json.JSONObject

/**
 * Everything the widget remembers, in this app's private storage: the message Kalam last sent
 * (src/core/widgets/payload.ts) and which widget each home-screen instance shows. Nothing here is sent anywhere.
 *
 * The widget trusts nothing it reads back: a message that does not parse, has the wrong version, or carries a link
 * that is not a Kalam link is ignored, and the widget shows its "tap to choose" state instead.
 */
internal object WidgetData {
  private const val PREFS = "kalam_widgets"
  private const val PAYLOAD = "payload"
  private const val BIND = "bind."
  private const val VERSION = 1
  private const val MAX_BYTES = 256 * 1024

  /** The ids and links the JS side writes (src/core/widgets/model.ts WIDGET_ID, payload.ts WIDGET_LINK). */
  val WIDGET_ID = Regex("^wgt_[a-z0-9]{8,32}$")
  private val LINK = Regex("^kalam://(app/[a-z][a-z0-9_-]{2,63}(\\?screen=[a-z][a-z0-9_]{0,47})?)?$")

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Stores a message after checking it. Returns how many widgets it holds. Throws when it is not a version 1 message. */
  fun save(c: Context, json: String): Int {
    require(json.length <= MAX_BYTES) { "The widget message is too large." }
    val root = JSONObject(json)
    require(root.optInt("v") == VERSION) { "This widget message is not version $VERSION." }
    val count = root.getJSONArray("widgets").length()
    prefs(c).edit().putString(PAYLOAD, json).apply()
    return count
  }

  fun clear(c: Context) {
    prefs(c).edit().remove(PAYLOAD).apply()
  }

  fun payload(c: Context): JSONObject? =
    try {
      prefs(c).getString(PAYLOAD, null)?.let { JSONObject(it) }?.takeIf { it.optInt("v") == VERSION }
    } catch (e: Exception) {
      null
    }

  fun widgets(c: Context): List<JSONObject> {
    val array = payload(c)?.optJSONArray("widgets") ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }.filter { WIDGET_ID.matches(it.optString("id")) }
  }

  fun widget(c: Context, id: String): JSONObject? = widgets(c).firstOrNull { it.optString("id") == id }

  fun boundTo(c: Context, appWidgetId: Int): String? = prefs(c).getString(BIND + appWidgetId, null)

  fun bind(c: Context, appWidgetId: Int, widgetId: String) {
    if (WIDGET_ID.matches(widgetId)) prefs(c).edit().putString(BIND + appWidgetId, widgetId).apply()
  }

  fun unbind(c: Context, appWidgetId: Int) {
    prefs(c).edit().remove(BIND + appWidgetId).apply()
  }

  /** A link the widget may open, or null. Anything but kalam://, kalam://app/<id> or kalam://app/<id>?screen=<id> is dropped. */
  fun safeLink(link: String?): String? = link?.takeIf { LINK.matches(it) }
}
