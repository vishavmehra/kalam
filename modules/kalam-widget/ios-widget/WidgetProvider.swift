import WidgetKit

struct KalamEntry: TimelineEntry {
  let date: Date
  /// nil: not tied to one of the person's widgets yet, or that widget is gone.
  let render: WidgetRender?
  /// What this widget shows from `date` on.
  let body: WidgetEntryData?
  let labels: WidgetLabels
  /// The app has not been opened for the whole look-ahead.
  let stale: Bool
}

/// Builds the timeline from the entries the app worked out ahead (one per midnight that changes the answer), so the
/// widget turns over by itself while Kalam is closed. After the last day it says it needs Kalam.
struct KalamProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> KalamEntry {
    KalamEntry(date: Date(), render: nil, body: nil, labels: .fallback, stale: false)
  }

  func snapshot(for configuration: SelectKalamWidgetIntent, in context: Context) async -> KalamEntry {
    entries(for: configuration).first ?? placeholder(in: context)
  }

  func timeline(for configuration: SelectKalamWidgetIntent, in context: Context) async -> Timeline<KalamEntry> {
    let list = entries(for: configuration)
    // Reloaded when the app sends a new message (WidgetCenter.reloadAllTimelines), so the end of the list is enough.
    return Timeline(entries: list, policy: .atEnd)
  }

  private func entries(for configuration: SelectKalamWidgetIntent) -> [KalamEntry] {
    let message = WidgetStore.load()
    let labels = message?.labels ?? .fallback
    let now = Date()
    guard let message, let id = configuration.widget?.id, let render = message.widgets.first(where: { $0.id == id }) else {
      return [KalamEntry(date: now, render: nil, body: nil, labels: labels, stale: false)]
    }
    var out = render.entries.map { e -> KalamEntry in
      let at = e.from <= 0 ? now : max(now, Date(timeIntervalSince1970: e.from / 1000))
      return KalamEntry(date: at, render: render, body: e, labels: labels, stale: false)
    }
    let end = Date(timeIntervalSince1970: render.validUntil / 1000)
    if end > now {
      out.append(KalamEntry(date: end, render: render, body: nil, labels: labels, stale: true))
    } else {
      out = [KalamEntry(date: now, render: render, body: nil, labels: labels, stale: true)]
    }
    return out
  }
}
