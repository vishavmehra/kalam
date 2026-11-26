/**
 * Home-screen widgets and install shortcuts (docs/14 §18). Everything is worked out on this device.
 *
 *   UI        <WidgetsButton spec appId />        header button + the "Add to home screen" sheet for one app
 *             <WidgetSettingsButton />            device-wide widget settings (Settings screen)
 *             <DashboardCards />                  the widgets as cards on the shelf (web and everywhere else)
 *   hooks     useWidgetSync()                     mount once in the root layout
 *   service   getWidgetService(), syncWidgets(), clearWidgets()
 *   pure      src/core/widgets (model, sources, snapshot, payload, service)
 *   native    modules/kalam-widget (Android home-screen widget, iOS WidgetKit extension)
 */
export { AddToHomeScreenSheet, type AddToHomeScreenSheetProps } from './AddToHomeScreenSheet';
export { DashboardCards } from './DashboardCards';
export { WidgetSettingsSheet, type WidgetSettingsSheetProps } from './WidgetSettingsSheet';
export { WidgetSettingsButton, WidgetsButton } from './WidgetsButton';
export { clearWidgets, getWidgetService, getWidgetStore, syncWidgets } from './service';
export { useWidgetSync, useWidgetsController } from './use-widgets';
export { createWidgetsController, type WidgetsController, type WidgetsState } from './controller';
export { widgetEngine } from './engine';
export { applyStartScreen } from './start-screen';
export { WIDGET_UI } from './copy';
