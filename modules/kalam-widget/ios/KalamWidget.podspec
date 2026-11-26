Pod::Spec.new do |s|
  s.name           = 'KalamWidget'
  s.version        = '0.1.0'
  s.summary        = 'Home-screen widget bridge for Kalam'
  s.description    = 'Kalam iOS native module: stores the finished text for the home-screen widgets in an App Group and asks WidgetKit to redraw them.'
  s.author         = 'Vishav Mehra'
  s.license        = 'MIT'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Only this folder is part of the app. The widget extension's sources are in ../ios-widget and are copied into the
  # Xcode project by app.plugin.js, so they are never compiled into the app itself.
  s.source_files = '**/*.{h,m,swift}'
end
