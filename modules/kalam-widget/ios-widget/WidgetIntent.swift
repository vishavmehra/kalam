import AppIntents
import WidgetKit

/// One of the widgets the person made in Kalam, as the "Edit Widget" screen lists them.
struct KalamWidgetEntity: AppEntity {
  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Kalam widget")
  static var defaultQuery = KalamWidgetQuery()

  var id: String
  var title: String
  var appName: String

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(title)", subtitle: "\(appName)")
  }
}

struct KalamWidgetQuery: EntityQuery {
  func entities(for identifiers: [String]) async throws -> [KalamWidgetEntity] {
    all().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [KalamWidgetEntity] {
    all()
  }

  func defaultResult() async -> KalamWidgetEntity? {
    all().first
  }

  private func all() -> [KalamWidgetEntity] {
    (WidgetStore.load()?.widgets ?? []).map { KalamWidgetEntity(id: $0.id, title: $0.title, appName: $0.appName) }
  }
}

/// Which of the person's Kalam widgets this home-screen widget shows.
struct SelectKalamWidgetIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Choose a Kalam widget"
  static var description = IntentDescription("Pick which of your Kalam widgets to show here.")

  @Parameter(title: "Widget")
  var widget: KalamWidgetEntity?
}
