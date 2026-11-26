import DeviceCheck
import ExpoModulesCore
import FirebaseAppCheck
import FirebaseCore
import Speech
#if canImport(FoundationModels)
import FoundationModels
#endif

/**
 Apple Foundation Models on the device, plus App Check tokens from App Attest. Sources, read 2026-11-25:
  - https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel (iOS 26.0+, availability
    and its unavailable reasons, supportedLanguages)
  - https://developer.apple.com/documentation/foundationmodels/languagemodelsession, the overload
    init(model: SystemLanguageModel = .default, tools: [any Tool] = [], instructions: String? = nil)
  - https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition (a
    request "can only honor its requiresOnDeviceRecognition property if supportsOnDeviceRecognition is true")
  - https://firebase.google.com/docs/ai-logic/hybrid/ios/get-started (on-device needs Apple Intelligence on,
    text only, about 4096 tokens, foreground only; the app cannot start the model download)
  - firebase-ios-sdk FirebaseAI/CHANGELOG.md 13.0.0 (Firebase's own SystemLanguageModel/HybridModel wrapper
    was removed in favour of Apple's Foundation Models framework, used directly here)
  - https://firebase.google.com/docs/app-check/ios/app-attest-provider (App Attest, DeviceCheck fallback,
    factory set before the Firebase app is configured)

 Choosing between the device and the cloud stays in Firebase AI Logic's JS SDK (firebase/ai), as on the web
 and Android. This module only runs SystemLanguageModel.default, so everything generate() returns was
 produced on this iPhone or iPad. Not compiled or device-tested yet: see modules/kalam-apple/README.md.
 */
public final class KalamAppleModule: Module {
  private static let appName = "kalam"
  // Error codes on-device.ios.ts maps to Prompt API error names.
  private static let notSupported = "ERR_APPLE_NOT_SUPPORTED"
  private static let notAllowed = "ERR_APPLE_NOT_ALLOWED"
  private static let tooLarge = "ERR_APPLE_TOO_LARGE"
  private static let failed = "ERR_APPLE_FAILED"

  private let requests = RunningRequests()

  public func definition() -> ModuleDefinition {
    Name("KalamApple")

    AsyncFunction("availability") { () async -> [String: Any] in
      await Self.availability()
    }

    AsyncFunction("generate") { (requestId: String, options: GenerateOptions) async throws -> [String: String] in
      let prompt = options.prompt
      let instructions = options.instructions
      let temperature = options.temperature
      let maxTokens = options.maxOutputTokens
      let task = Task {
        try await Self.respond(prompt: prompt, instructions: instructions, temperature: temperature, maxTokens: maxTokens)
      }
      self.requests.add(requestId, task)
      defer { self.requests.remove(requestId) }
      let text = try await task.value
      return ["text": text, "source": "on_device"]
    }

    // ponytail: a cancel that arrives before generate() registered its task is lost; the JS side has already
    // rejected the request, so the only cost is one wasted on-device answer.
    Function("cancel") { (requestId: String) -> Bool in
      self.requests.cancel(requestId)
    }

    // expo-speech-recognition sets requiresOnDeviceRecognition only when the recognizer for the requested
    // locale supports it, and otherwise uses Apple's servers. Its own check covers the phone's default
    // locale only, so Kalam asks about the locale it will dictate in. Locale normalised as expo does.
    Function("supportsOnDeviceSpeech") { (locale: String) -> Bool in
      let id = locale.replacingOccurrences(of: "_", with: "-")
      return SFSpeechRecognizer(locale: Locale(identifier: id))?.supportsOnDeviceRecognition ?? false
    }

    // Public EXPO_PUBLIC_FIREBASE_* identifiers, no secrets. Safe to call more than once.
    Function("installAppAttest") { (config: FirebaseConfig) in
      Self.installAppAttest(config)
    }

    AsyncFunction("getAppCheckToken") { (forceRefresh: Bool) async throws -> [String: Any] in
      guard let app = FirebaseApp.app(name: Self.appName), let appCheck = AppCheck.appCheck(app: app) else {
        throw Exception(name: "AppCheckNotReady", description: "App Attest was not set up before asking for a token.", code: Self.failed)
      }
      let token = try await appCheck.token(forcingRefresh: forceRefresh)
      return ["token": token.token, "expireTimeMillis": token.expirationDate.timeIntervalSince1970 * 1000]
    }

    // Simulator only: settles the Apple Intelligence check at launch, so a status question does not wait on it.
    OnCreate {
      Self.startSimulatorCheck()
    }

    OnDestroy {
      self.requests.cancelAll()
    }
  }

  /// availability: available | unavailable, with the reason and the supported languages.
  private static func availability() async -> [String: Any] {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let model = SystemLanguageModel.default
      switch model.availability {
      case .available:
        #if targetEnvironment(simulator)
        // A simulator uses its Mac's Apple Intelligence. In a Mac virtual machine, which cannot turn it on, the
        // simulator still says .available and then every request fails (Apple Developer Forums thread 787199);
        // GitHub run 45615319769 showed "On-device AI ready" on a macOS runner. One short real answer decides.
        guard await simulatorAnswers() else {
          return ["availability": "unavailable", "reason": "simulatorNoModel"]
        }
        #endif
        let languages = Set(model.supportedLanguages.compactMap { $0.languageCode?.identifier.lowercased() })
        return ["availability": "available", "languages": Array(languages)]
      case .unavailable(.deviceNotEligible):
        return ["availability": "unavailable", "reason": "deviceNotEligible"]
      case .unavailable(.appleIntelligenceNotEnabled):
        return ["availability": "unavailable", "reason": "appleIntelligenceNotEnabled"]
      case .unavailable(.modelNotReady):
        // Apple: "The models aren't available on the user's device. Models are downloaded automatically based
        // on factors like network status, battery level, and system load." Not proof that a download is running.
        return ["availability": "unavailable", "reason": "modelNotReady"]
      case .unavailable:
        return ["availability": "unavailable", "reason": "unknown"]
      @unknown default:
        return ["availability": "unavailable", "reason": "unknown"]
      }
    }
    #endif
    return ["availability": "unavailable", "reason": "osTooOld"]
  }

  private static func startSimulatorCheck() {
    #if targetEnvironment(simulator) && canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      if case .available = SystemLanguageModel.default.availability {
        Task { _ = await simulatorAnswers() }
      }
    }
    #endif
  }

  #if targetEnvironment(simulator) && canImport(FoundationModels)
  private static let simulatorCheck = SimulatorCheck()

  /// True when the model really answers. One check per launch, shared by every caller.
  @available(iOS 26.0, *)
  private static func simulatorAnswers() async -> Bool {
    await simulatorCheck.run { await askOnce() }.value
  }

  /// One short real prompt, at most 20 seconds.
  @available(iOS 26.0, *)
  private static func askOnce() async -> Bool {
    await withTaskGroup(of: Bool.self) { group in
      group.addTask {
        let model = SystemLanguageModel.default
        let session = LanguageModelSession(model: model)
        let prompt = "Reply with the word OK."
        let options = GenerationOptions(sampling: .greedy, temperature: nil, maximumResponseTokens: 8)
        let reply = try? await session.respond(to: prompt, options: options)
        return !(reply?.content.isEmpty ?? true)
      }
      group.addTask {
        try? await Task.sleep(nanoseconds: 20_000_000_000)
        return false
      }
      let first = await group.next() ?? false
      group.cancelAll()
      return first
    }
  }
  #endif

  /// One single-turn prompt on SystemLanguageModel.default. Greedy decoding unless a temperature is given.
  /// Kalam's own system text goes to the session as instructions, the request (with any user text) as the
  /// prompt. Apple: "the model is typically trained to obey instructions over any commands it receives in
  /// prompts" (developer.apple.com/documentation/foundationmodels/instructions).
  private static func respond(prompt: String, instructions: String?, temperature: Double?, maxTokens: Int?) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26.0, *) {
      let model = SystemLanguageModel.default
      guard model.isAvailable else {
        throw Exception(name: "ModelUnavailable", description: "Apple Intelligence is not ready on this device.", code: notSupported)
      }
      let session = LanguageModelSession(model: model, instructions: instructions)
      let options = GenerationOptions(
        sampling: temperature == nil ? .greedy : nil,
        temperature: temperature,
        maximumResponseTokens: maxTokens
      )
      do {
        return try await session.respond(to: prompt, options: options).content
      } catch let error as LanguageModelSession.GenerationError {
        throw promptException(error)
      }
    }
    #endif
    throw Exception(name: "ModelUnavailable", description: "AI on this device needs iOS 26 or later with Apple Intelligence on.", code: notSupported)
  }

  #if canImport(FoundationModels)
  @available(iOS 26.0, *)
  private static func promptException(_ error: LanguageModelSession.GenerationError) -> Exception {
    switch error {
    case .exceededContextWindowSize:
      return Exception(name: "TooLarge", description: "The request is too long for Apple's on-device model.", code: tooLarge)
    case .unsupportedLanguageOrLocale, .assetsUnavailable:
      return Exception(name: "NotSupported", description: "Apple's on-device model cannot take this request: \(error.localizedDescription)", code: notSupported)
    case .rateLimited:
      return Exception(name: "NotAllowed", description: "iOS is limiting on-device AI right now, for example while Kalam is in the background.", code: notAllowed)
    default:
      return Exception(name: "Failed", description: error.localizedDescription, code: failed)
    }
  }
  #endif

  private static func installAppAttest(_ config: FirebaseConfig) {
    if FirebaseApp.app(name: appName) != nil { return }
    // The factory must be set before the Firebase app is configured.
    AppCheck.setAppCheckProviderFactory(KalamAppCheckProviderFactory())
    let options = FirebaseOptions(googleAppID: config.appId, gcmSenderID: config.gcmSenderId)
    options.apiKey = config.apiKey
    options.projectID = config.projectId
    FirebaseApp.configure(name: appName, options: options)
  }
}

/// App Attest where the device supports it, DeviceCheck otherwise (Firebase App Attest guide).
private final class KalamAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
  func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
    if DCAppAttestService.shared.isSupported { return AppAttestProvider(app: app) }
    return DeviceCheckProvider(app: app)
  }
}

#if targetEnvironment(simulator)
/// The simulator's one Apple Intelligence check for this launch (simulatorAnswers()).
private final class SimulatorCheck: @unchecked Sendable {
  private let lock = NSLock()
  private var task: Task<Bool, Never>?

  /// The running or finished check; the first caller starts it.
  func run(_ start: @escaping @Sendable () async -> Bool) -> Task<Bool, Never> {
    lock.lock()
    defer { lock.unlock() }
    if let task { return task }
    let created = Task { await start() }
    task = created
    return created
  }
}
#endif

/// Running generate() calls by request id, so a JS AbortSignal can cancel them.
private final class RunningRequests: @unchecked Sendable {
  private let lock = NSLock()
  private var tasks: [String: Task<String, Error>] = [:]

  func add(_ id: String, _ task: Task<String, Error>) {
    lock.lock(); tasks[id] = task; lock.unlock()
  }

  func remove(_ id: String) {
    lock.lock(); tasks[id] = nil; lock.unlock()
  }

  func cancel(_ id: String) -> Bool {
    lock.lock(); let task = tasks.removeValue(forKey: id); lock.unlock()
    task?.cancel()
    return task != nil
  }

  func cancelAll() {
    lock.lock(); let all = Array(tasks.values); tasks = [:]; lock.unlock()
    all.forEach { $0.cancel() }
  }
}

struct GenerateOptions: Record {
  @Field var prompt: String = ""
  @Field var instructions: String? = nil
  @Field var temperature: Double? = nil
  @Field var maxOutputTokens: Int? = nil
}

struct FirebaseConfig: Record {
  @Field var apiKey: String = ""
  @Field var projectId: String = ""
  @Field var appId: String = ""
  @Field var gcmSenderId: String = ""
}
