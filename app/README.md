# TEM-view Lite: the iOS and Android apps

A free app version of the exhibit with:
- TEM, STEM and the Ronchigram
- the three training tasks
- voice commands, using the phone's own speech recognition
- all six specimens

It is the website's own code in the lite edition (`window.TEMVIEW_EDITION = 'lite'`, see `js/config.js`), wrapped
with [Capacitor](https://capacitorjs.com) 8. Every physics fix on the website reaches the apps on the next build.

| Folder or file | What it is |
| --- | --- |
| `build.mjs` | Builds `www/` from the website: lite edition, with three.js, fonts and narration bundled, so the app works offline and loads no code from the network |
| `capacitor.config.json` | App id, name and colors |
| `native.mjs` | Reapplies the customizations to the generated projects: icons, splash screens, iOS permission texts, iOS 15 minimum (`npm run native`) |
| `android/` | The Android Studio project |
| `ios/` | The Xcode project (CocoaPods, because the speech plugin has no Swift package) |

To preview the lite edition on the web: `https://advanced-em.github.io/TEM-view/?edition=lite`, or locally
`npm run build` and serve `www/`.

## One-time setup on the Mac

1. **Xcode:** install it from the Mac App Store (about 15 GB), open it once to accept the license and install the
   iOS simulator, then point the command-line tools at it:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
2. **CocoaPods:** the speech plugin needs it.
   ```bash
   brew install cocoapods
   ```
3. **Android Studio:** from developer.android.com/studio. It brings the Android SDK and Java. Open it once and let it
   install the SDK.
4. **First Xcode run:** `sudo xcodebuild -runFirstLaunch`, then `xcodebuild -downloadPlatform iOS` for the
   simulator.
5. **Regenerating a native project** (only if it is deleted or Capacitor is upgraded):
   ```bash
   cd app && npm install && npm run build
   npx cap add ios --packagemanager CocoaPods && npx cap add android
   npm run native && (cd ios/App && LANG=en_US.UTF-8 pod install)
   ```
   The `native` step reapplies the icons, splash screens, microphone and speech permission texts, and the iOS 15
   minimum (Xcode 27 builds for iOS 15 and later). Capacitor 8's template uses the scene life cycle, which apps
   built with the iOS 27 SDK require.

## Everyday use

```bash
cd app
npm run ios        # build, sync and open Xcode: pick a simulator or your iPhone and press Run
npm run android    # build, sync and open Android Studio: pick an emulator or your phone and press Run
```

Run `npm run build && npx cap sync` after any change to the website's files.

## Publishing

**Accounts:** register both as the LLC, not as a person. Both need the LLC's free D-U-N-S number.
- Apple Developer Program: $99 a year.
- Google Play Console: $25 once.

**App id:** `org.advancedem.temview` in `capacitor.config.json` is a placeholder. The id cannot change after the
first upload, so set the final one first. It is usually the company's reversed domain, for example
`com.yourllc.temview`.

**iOS:**
1. In Xcode, select the team (signing) and set the version and build numbers.
2. Choose Product → Archive, then upload to App Store Connect.
3. Test with TestFlight.
4. Fill in the store listing (`store-listing.md`) and the privacy label, then submit for review.

**Android:**
1. In Android Studio, choose Build → Generate Signed App Bundle. Keep the upload key safe.
2. Upload the bundle to the Play Console, starting with an internal testing track.
3. Fill in the store listing, the Data safety form and the content rating, then roll out to production.

Both stores need the privacy policy URL: `https://advanced-em.github.io/TEM-view/privacy.html`.

## Notes for review

- **Apple rule 4.2 (minimum functionality):** the app is an interactive physics simulator with offline use, native
  speech recognition and training tasks, not a website in a frame.
- **Apple rule 2.5.2 (downloaded code):** the lite edition has no Python IDE, and everything it runs is in the app.
- **Tipping and payments:** the "Buy me a coffee" link is hidden in the apps (store rules). The Console is a
  physical product, so linking to its page is allowed.
- **Console hardware:**
  - iOS recognises only certain game controllers (MFi, Xbox, PlayStation), so the Console will need a Bluetooth mode
    and a native plugin.
  - On Android, gamepad access from inside an app's browser view is not guaranteed and needs testing on devices.

  Console support in the apps is therefore a later step.
