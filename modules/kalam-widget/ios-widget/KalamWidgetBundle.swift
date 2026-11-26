import SwiftUI
import WidgetKit

/// The Kalam widget extension (docs/14 §18). Copied into the Xcode project by modules/kalam-widget/app.plugin.js when
/// the iOS widget is turned on. iOS 17 or later (AppIntentConfiguration). Never compiled: see ../README.md.
@main
struct KalamWidgetBundle: WidgetBundle {
  var body: some Widget {
    KalamWidget()
  }
}

struct KalamWidget: Widget {
  let kind = "KalamWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: SelectKalamWidgetIntent.self, provider: KalamProvider()) { entry in
      KalamWidgetView(entry: entry)
    }
    .configurationDisplayName("Kalam")
    .description("A number or a short list from one of your Kalam apps. Everything stays on this iPhone.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
