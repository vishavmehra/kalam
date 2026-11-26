// Prebuild steps for the kalam-widget module (docs/14 §18).
//
// Android needs nothing here: the module's own AndroidManifest.xml registers the widget and the picker, and Gradle merges it.
//
// iOS widgets live in a WidgetKit extension, which is a second Xcode target. That is only added when asked for:
//   ["./modules/kalam-widget/app.plugin.js", { "ios": true }]                       // App Group group.<bundle id>
//   ["./modules/kalam-widget/app.plugin.js", { "ios": { "appGroup": "group.x.y" } }] // or name the group
// The plugin then: gives the app the App Groups entitlement, writes the group into Info.plist (KalamWidgetAppGroup, read by
// KalamWidgetModule.swift), copies ios-widget/*.swift into ios/KalamWidget, adds the extension target and embeds it, and
// tells EAS Build about the extension (extra.eas.build.experimental.ios.appExtensions) so it gets its own signing.
//
// The iOS part was never run. It edits the Xcode project with the `xcode` library that Expo's config plugins ship with;
// the helpers that build text and settings are unit tested (src/core/widgets/plugin.test.ts), the project edit is not.
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const {
  withEntitlementsPlist, withInfoPlist, withXcodeProject,
} = require('expo/config-plugins');

const TARGET = 'KalamWidget';
const SOURCES = path.join(__dirname, 'ios-widget');
const DEPLOYMENT_TARGET = '17.0'; // AppIntentConfiguration

/** The App Group both targets share. `override` wins; otherwise group.<bundle id>. */
function appGroupFor(bundleId, override) {
  if (override) return override;
  if (!bundleId) throw new Error('kalam-widget: ios.bundleIdentifier is needed to name the App Group.');
  return `group.${bundleId}`;
}

/** Entitlements with `group` added to the App Groups list. Never removes a group that is already there. */
function addAppGroup(entitlements, group) {
  const key = 'com.apple.security.application-groups';
  const list = Array.isArray(entitlements[key]) ? entitlements[key] : [];
  entitlements[key] = list.includes(group) ? list : [...list, group];
  return entitlements;
}

/** Info.plist text of the extension. */
function extensionInfoPlist(group, version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key><string>Kalam</string>
  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key><string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key><string>${version || '1.0'}</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>KalamWidgetAppGroup</key><string>${group}</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string>
  </dict>
</dict>
</plist>
`;
}

/** Entitlements file text of the extension. */
function extensionEntitlements(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.application-groups</key>
  <array><string>${group}</string></array>
</dict>
</plist>
`;
}

/** `extra` with the extension added for EAS Build, replacing an older entry of the same target. Does not touch anything else. */
function withEasExtension(extra, bundleId, group) {
  const e = extra ?? {};
  const eas = e.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const others = (ios.appExtensions ?? []).filter((x) => x.targetName !== TARGET);
  const entry = { targetName: TARGET, bundleIdentifier: bundleId, entitlements: { 'com.apple.security.application-groups': [group] } };
  return { ...e, eas: { ...eas, build: { ...build, experimental: { ...experimental, ios: { ...ios, appExtensions: [...others, entry] } } } } };
}

/** Build settings of the extension's two configurations. */
function extensionBuildSettings({ bundleId, team, version }) {
  return {
    PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}"`,
    INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
    CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
    SWIFT_VERSION: '5.0',
    IPHONEOS_DEPLOYMENT_TARGET: DEPLOYMENT_TARGET,
    TARGETED_DEVICE_FAMILY: '"1,2"',
    SKIP_INSTALL: 'YES',
    CURRENT_PROJECT_VERSION: '1',
    MARKETING_VERSION: version || '1.0',
    GENERATE_INFOPLIST_FILE: 'NO',
    ...(team ? { DEVELOPMENT_TEAM: team } : {}),
  };
}

function withExtensionTarget(config, { group }) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const iosRoot = cfg.modRequest.platformProjectRoot;
    const bundleId = `${cfg.ios?.bundleIdentifier}.widget`;
    const version = cfg.version;
    const dir = path.join(iosRoot, TARGET);
    fs.mkdirSync(dir, { recursive: true });
    const swift = fs.readdirSync(SOURCES).filter((f) => f.endsWith('.swift'));
    for (const f of swift) fs.copyFileSync(path.join(SOURCES, f), path.join(dir, f));
    fs.writeFileSync(path.join(dir, 'Info.plist'), extensionInfoPlist(group, version));
    fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), extensionEntitlements(group));

    // Prebuild can run again on the same project: do nothing the second time.
    if (project.pbxTargetByName(TARGET)) return cfg;

    const main = project.getFirstTarget();
    const mainSettings = project.pbxXCBuildConfigurationSection();
    const team = Object.values(mainSettings).find((c) => c && c.buildSettings && c.buildSettings.DEVELOPMENT_TEAM)?.buildSettings.DEVELOPMENT_TEAM;

    const files = [...swift, 'Info.plist', `${TARGET}.entitlements`];
    const groupRef = project.addPbxGroup(files, TARGET, TARGET);
    project.addToPbxGroup(groupRef.uuid, project.getFirstProject().firstProject.mainGroup);

    const target = project.addTarget(TARGET, 'app_extension', TARGET, bundleId);
    project.addBuildPhase(swift, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase(['SwiftUI.framework', 'WidgetKit.framework'], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);

    for (const c of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (c && c.buildSettings && c.buildSettings.PRODUCT_NAME === `"${TARGET}"`) {
        Object.assign(c.buildSettings, extensionBuildSettings({ bundleId, team, version }));
      }
    }

    // The app must build the extension first and carry it in its PlugIns folder.
    project.addTargetDependency(main.uuid, [target.uuid]);
    const embedded = Object.values(project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}).some(
      (p) => p && Array.isArray(p.files) && p.files.some((f) => /KalamWidget\.appex/.test(f.comment ?? '')),
    );
    if (!embedded) project.addBuildPhase([`${TARGET}.appex`], 'PBXCopyFilesBuildPhase', 'Embed Foundation Extensions', main.uuid, 'app_extension');
    return cfg;
  });
}

module.exports = function withKalamWidget(config, options) {
  const ios = options?.ios;
  if (!ios) return config; // Android needs no prebuild step.
  const group = appGroupFor(config.ios?.bundleIdentifier, typeof ios === 'object' ? ios.appGroup : undefined);
  let next = withEntitlementsPlist(config, (cfg) => {
    addAppGroup(cfg.modResults, group);
    return cfg;
  });
  next = withInfoPlist(next, (cfg) => {
    cfg.modResults.KalamWidgetAppGroup = group;
    return cfg;
  });
  next = withExtensionTarget(next, { group });
  next.extra = withEasExtension(next.extra, `${config.ios?.bundleIdentifier}.widget`, group);
  return next;
};
Object.assign(module.exports, { TARGET, appGroupFor, addAppGroup, extensionInfoPlist, extensionEntitlements, withEasExtension, extensionBuildSettings });
