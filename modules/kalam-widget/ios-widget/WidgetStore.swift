import Foundation

/// What the app sends (src/core/widgets/payload.ts, version 1). Finished text only: no record ids, no formulas.
struct WidgetRow: Decodable, Hashable {
  let text: String
  let detail: String?
  let done: Bool?
}

struct WidgetEntryData: Decodable, Hashable {
  /// Milliseconds since 1970. The first entry is 0.
  let from: Double
  let headline: String?
  let rows: [WidgetRow]
  let note: String?
}

struct WidgetRender: Decodable, Hashable, Identifiable {
  let id: String
  let appName: String
  let title: String
  let kind: String
  let size: String
  let hideWhenLocked: Bool
  let link: String
  /// Milliseconds since 1970. After this the widget asks the person to open Kalam.
  let validUntil: Double
  let entries: [WidgetEntryData]
}

/// The words the widget prints itself, in the language the app sent them in. `unboundAndroid` is in the message for the
/// Android widget and is not read here: a tap on an unchosen iPhone widget does nothing, so it says how to choose instead.
struct WidgetLabels: Decodable, Hashable {
  let empty: String
  let stale: String
  let locked: String
  let unboundIos: String
  let done: String
  let notDone: String

  static let fallback = WidgetLabels(
    empty: "Nothing to show yet",
    stale: "Open Kalam to update",
    locked: "Unlock to see this",
    unboundIos: "Touch and hold this widget, then choose Edit Widget",
    done: "Done",
    notDone: "Not done"
  )
}

struct WidgetMessage: Decodable {
  let v: Int
  let generatedAt: Double
  let labels: WidgetLabels
  let widgets: [WidgetRender]
}

/// Reads the message the app stored in the App Group. It trusts nothing: a message that does not decode, or has another
/// version, is treated as if there were none.
enum WidgetStore {
  static let key = "payload"

  /// app.plugin.js writes the group into this target's Info.plist.
  static var group: String? {
    Bundle.main.object(forInfoDictionaryKey: "KalamWidgetAppGroup") as? String
  }

  static func load() -> WidgetMessage? {
    guard
      let group, let defaults = UserDefaults(suiteName: group),
      let text = defaults.string(forKey: key), let data = text.data(using: .utf8),
      let message = try? JSONDecoder().decode(WidgetMessage.self, from: data), message.v == 1
    else { return nil }
    return message
  }

  /// The only places a widget may open: kalam://, kalam://app/<id> and kalam://app/<id>?screen=<id>.
  static func url(for link: String) -> URL? {
    let pattern = "^kalam://(app/[a-z][a-z0-9_-]{2,63}(\\?screen=[a-z][a-z0-9_]{0,47})?)?$"
    guard link.range(of: pattern, options: .regularExpression) != nil else { return nil }
    return URL(string: link)
  }
}
