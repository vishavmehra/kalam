import SwiftUI
import WidgetKit

/// Paper and Ink night from src/design/tokens.ts (palette.paper and palette.ink: sheet, ink, ink3).
private enum Ink {
  static let paper = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.110, green: 0.102, blue: 0.094, alpha: 1) : UIColor(red: 1, green: 1, blue: 1, alpha: 1) })
  static let text = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.961, green: 0.945, blue: 0.918, alpha: 1) : UIColor(red: 0.110, green: 0.098, blue: 0.090, alpha: 1) })
  static let muted = Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.639, green: 0.612, blue: 0.573, alpha: 1) : UIColor(red: 0.416, green: 0.392, blue: 0.369, alpha: 1) })
}

struct KalamWidgetView: View {
  let entry: KalamEntry
  @Environment(\.widgetFamily) private var family
  @Environment(\.redactionReasons) private var redaction

  private var hide: Bool { entry.render?.hideWhenLocked ?? true }
  private var rowLimit: Int { family == .systemSmall ? 2 : 5 }

  var body: some View {
    Group {
      if entry.render == nil {
        Text(entry.labels.unboundIos).font(.footnote).foregroundStyle(Ink.text)
      } else if hide && redaction.contains(.privacy) {
        // Locked device (the lock screen, StandBy): say so and show nothing else, not even the name.
        Text(entry.labels.locked).font(.footnote).foregroundStyle(Ink.muted)
      } else {
        content
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .containerBackground(for: .widget) { Ink.paper }
    .widgetURL(entry.render.flatMap { WidgetStore.url(for: $0.link) })
  }

  @ViewBuilder
  private var content: some View {
    if let render = entry.render {
      VStack(alignment: .leading, spacing: 2) {
        Text(render.appName).font(.caption2).foregroundStyle(Ink.muted).lineLimit(1)
        Text(render.title).font(.subheadline.weight(.semibold)).foregroundStyle(Ink.text).lineLimit(2)
        if entry.stale {
          Text(entry.labels.stale).font(.footnote).foregroundStyle(Ink.muted)
        } else if let body = entry.body {
          if let headline = body.headline, !headline.isEmpty {
            Text(headline).font(.system(size: 30, weight: .bold)).foregroundStyle(Ink.text).lineLimit(1).minimumScaleFactor(0.5)
          }
          ForEach(Array(body.rows.prefix(rowLimit).enumerated()), id: \.offset) { _, row in
            HStack(spacing: 6) {
              if let done = row.done {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                  .font(.footnote)
                  .foregroundStyle(Ink.text)
                  .accessibilityLabel(done ? entry.labels.done : entry.labels.notDone)
              }
              Text(row.text).font(.footnote).foregroundStyle(Ink.text).lineLimit(1)
              Spacer(minLength: 4)
              if let detail = row.detail {
                Text(detail).font(.caption).foregroundStyle(Ink.muted).lineLimit(1)
              }
            }
          }
          if let note = body.note, !note.isEmpty {
            Text(note).font(.footnote).foregroundStyle(Ink.muted).lineLimit(3)
          }
        }
      }
      .privacySensitive(hide)
      .accessibilityElement(children: .combine)
    }
  }
}
