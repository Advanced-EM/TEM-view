// Applies TEM-view's customizations to the generated native projects: app icons, dark splash screens,
// the iOS microphone and speech permission texts, and the iOS minimum version. Run after `npx cap add ios`
// or `npx cap add android` (npm run native), so the projects can be regenerated at any time.
// Images are drawn with Python's Pillow from ../icons (python3 -m pip install pillow).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = dirname(fileURLToPath(import.meta.url)), icons = join(app, '..', 'icons');
const py = (code) => execFileSync('python3', ['-c', code], { stdio: 'inherit' });

const ios = join(app, 'ios/App');
if (existsSync(ios)) {
  const plist = join(ios, 'App/Info.plist');
  const set = (k, v) => { try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${k}`, plist], { stdio: 'ignore' }); } catch {} execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${k} string ${v}`, plist]); };
  set('NSMicrophoneUsageDescription', 'TEM-view listens only while you hold the talk button, to run voice commands.');
  set('NSSpeechRecognitionUsageDescription', 'Your spoken commands are turned into text to control the simulated microscope.');
  // Xcode 27 builds for iOS 15 and later; the plugins' pod specs still say 14
  const podfile = join(ios, 'Podfile');
  let pf = readFileSync(podfile, 'utf8').replace(/platform :ios, '1[0-4]\.0'/, "platform :ios, '15.0'");
  if (!pf.includes("IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'")) pf = pf.replace(/post_install do \|installer\|\n/, `post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0' }
  end
`);
  writeFileSync(podfile, pf);
  const pbx = join(ios, 'App.xcodeproj/project.pbxproj');
  writeFileSync(pbx, readFileSync(pbx, 'utf8').replace(/IPHONEOS_DEPLOYMENT_TARGET = 1[0-4]\.0;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;'));
  const assets = join(ios, 'App/Assets.xcassets');
  py(`
from PIL import Image
import glob, json, os
I=${JSON.stringify(icons + '/')}; A=${JSON.stringify(assets + '/')}
ic=json.load(open(A+'AppIcon.appiconset/Contents.json'))['images'][0]['filename']
Image.open(I+'app-store-1024.png').convert('RGB').save(A+'AppIcon.appiconset/'+ic)
logo=Image.open(I+'icon-1024.png').convert('RGBA')
for p in glob.glob(A+'Splash.imageset/*.png'):
    w,h=Image.open(p).size; k=int(min(w,h)*0.19); s=Image.new('RGB',(w,h),(5,7,11)); l=logo.resize((k,k),Image.LANCZOS)
    s.paste(l,((w-k)//2,(h-k)//2),l); s.save(p)
print('iOS: icon, splash, permissions, iOS 15')`);
}

const res = join(app, 'android/app/src/main/res');
if (existsSync(res)) {
  py(`
from PIL import Image
import glob, numpy as np
I=${JSON.stringify(icons + '/')}; R=${JSON.stringify(res + '/')}
full=Image.open(I+'icon-1024.png').convert('RGBA'); sq=np.asarray(Image.open(I+'app-store-1024.png').convert('RGB')).astype(float)
alpha=np.clip(np.abs(sq-sq[0,0]).sum(-1)*6,0,255)
fg=Image.fromarray(np.dstack([sq,alpha]).astype('uint8'))
for name,px in (('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)):
    for f in ('ic_launcher.png','ic_launcher_round.png'): full.resize((px,px),Image.LANCZOS).save(f'{R}mipmap-{name}/{f}')
    F=int(px*108/48); c=Image.new('RGBA',(F,F),(0,0,0,0)); k=int(F*0.62); c.paste(fg.resize((k,k),Image.LANCZOS),((F-k)//2,(F-k)//2)); c.save(f'{R}mipmap-{name}/ic_launcher_foreground.png')
for p in glob.glob(R+'drawable*/splash.png'):
    w,h=Image.open(p).size; k=int(min(w,h)*0.28); s=Image.new('RGB',(w,h),(5,7,11)); l=full.resize((k,k),Image.LANCZOS); s.paste(l,((w-k)//2,(h-k)//2),l); s.save(p)
open(R+'values/ic_launcher_background.xml','w').write('<?xml version="1.0" encoding="utf-8"?>\\n<resources>\\n    <color name="ic_launcher_background">#05070B</color>\\n</resources>\\n')
print('Android: launcher icons, splash')`);
}
