Pod::Spec.new do |s|
  s.name           = 'KalamApple'
  s.version        = '0.1.0'
  s.summary        = 'Apple Foundation Models on device and App Attest App Check for Kalam'
  s.description    = 'Kalam iOS native module: SystemLanguageModel through Apple Foundation Models, and Firebase App Check tokens from App Attest with DeviceCheck as fallback.'
  s.author         = 'Vishav Mehra'
  s.license        = 'MIT'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  # FoundationModels exists from iOS 26. Weak linking lets the app start on older iOS, where the Swift code
  # reports 'osTooOld' instead of calling it.
  s.weak_frameworks = 'FoundationModels'
  s.frameworks = 'DeviceCheck', 'Speech'

  # Firebase stopped publishing to CocoaPods in October 2026 (firebase.google.com/docs/ios/cocoapods-deprecation),
  # so FirebaseAppCheck comes from Swift Package Manager through React Native's spm_dependency helper
  # (react-native/scripts/react_native_pods.rb, applied in react_native_post_install).
  if defined?(spm_dependency)
    spm_dependency(s,
      url: 'https://github.com/firebase/firebase-ios-sdk.git',
      requirement: { kind: 'upToNextMajorVersion', minimumVersion: '13.0.0' },
      products: ['FirebaseCore', 'FirebaseAppCheck']
    )
  else
    raise 'kalam-apple needs spm_dependency from React Native 0.75 or later to add FirebaseAppCheck.'
  end

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
