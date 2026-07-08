# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Run app

npm run tauri dev

## Build for App Store (won't run locally bc it's signed)

npm run tauri build -- --config src-tauri/tauri.appstore.conf.json

### Create the .pkg

xcrun productbuild \
 --component "src-tauri/target/release/bundle/macos/Nail Nudge.app" /Applications \
 --sign "CF319DA765A4C6EA74EB79C4B0071679430EC0EB" \
 "Nail Nudge.pkg"
