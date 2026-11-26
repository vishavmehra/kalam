import ExpoModulesCore
import WidgetKit

/**
 Home-screen widgets for Kalam on iOS (docs/14 §18). The app sends one finished message (src/core/widgets/payload.ts):
 the text each widget shows. This module stores it in the App Group that the widget extension (../ios-widget) also
 reads, and asks WidgetKit to redraw. The extension cannot read the app's database, run a formula or use the network.

 Sources, read 2026-11-25:
  - https://developer.apple.com/documentation/widgetkit/making-a-configurable-widget (AppIntentConfiguration, iOS 17)
  - https://developer.apple.com/documentation/widgetkit/widgetcenter/reloadalltimelines()
  - https://developer.apple.com/documentation/xcode/configuring-app-groups (a shared container needs the App Groups
    entitlement in both targets)
 iOS gives an app no way to add a widget to the home screen: the person adds it from the home screen (touch and hold,
 then the + button), so `requestPin` always answers "unsupported". WidgetKit does not say how many of each configured
 widget exist without an async call that cannot name Kalam's own ids, so `placed` is empty (`canCount` is false).

 Not compiled or device-tested: see README.md.
 */
public final class KalamWidgetModule: Module {
  private static let key = "payload"
  private static let maxBytes = 256 * 1024
  private static let version = 1

  /// The App Group both targets share. app.plugin.js writes it into the Info.plist of the app and of the extension.
  private var defaults: UserDefaults? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "KalamWidgetAppGroup") as? String, !group.isEmpty else { return nil }
    return UserDefaults(suiteName: group)
  }

  public func definition() -> ModuleDefinition {
    Name("KalamWidget")

    AsyncFunction("availability") { () -> [String: Any] in
      if self.defaults == nil {
        return [
          "supported": false,
          "platform": "ios",
          "reason": "This build has no App Group for widgets. Turn on the iOS widget in the kalam-widget plugin options and build again.",
        ]
      }
      return ["supported": true, "platform": "ios", "canPin": false, "canCount": false]
    }

    // Stores the message after checking it, then asks WidgetKit to redraw. Returns the number of widgets it holds.
    AsyncFunction("publish") { (json: String) throws -> Int in
      guard let defaults = self.defaults else {
        throw Exception(name: "WidgetNotReady", description: "This build has no App Group for widgets.", code: "ERR_WIDGET_NOT_READY")
      }
      guard json.utf8.count <= Self.maxBytes,
            let data = json.data(using: .utf8),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            root["v"] as? Int == Self.version,
            let widgets = root["widgets"] as? [Any]
      else {
        throw Exception(name: "WidgetMessage", description: "The widget message was not accepted.", code: "ERR_WIDGET_MESSAGE")
      }
      defaults.set(json, forKey: Self.key)
      WidgetCenter.shared.reloadAllTimelines()
      return widgets.count
    }

    AsyncFunction("clear") { () -> Void in
      self.defaults?.removeObject(forKey: Self.key)
      WidgetCenter.shared.reloadAllTimelines()
    }

    AsyncFunction("requestPin") { (_ widgetId: String) -> [String: Any] in
      ["ok": false, "reason": "unsupported"]
    }

    AsyncFunction("placed") { () -> [String: Int] in
      [:]
    }
  }
}
