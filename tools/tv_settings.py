#!/usr/bin/env python3
"""Reads the TV's settings (read-only) and prints the ones it answers for.

    python3 tools/tv_settings.py [ip]

webOS only answers for named keys, so this asks a list of known ones. Pair once first (the TV asks to allow):
the settings client is a separate key in ~/.ssh and never goes into the app. Writing settings is refused to unsigned
clients on webOS 24 (401), so changes are made in the TV's own Settings menu.
"""
import json
import os
import sys

import tvlib

ip = sys.argv[1] if len(sys.argv) > 1 else tvlib.default_ip()
tvlib.ssap(ip, 'settings/getSystemSettings', {'category': 'picture', 'keys': ['pictureMode']}, settings=True)  # pairs once
key = open(os.path.expanduser('~/.ssh/tvlauncher_ssap_settings_' + ip.replace('.', '_'))).read().strip()
ws=tvlib.Socket(ip)
ws.send({'type':'register','id':'register','payload':{'forcePairing':False,'pairingType':'PROMPT','manifest':tvlib.SETTINGS_MANIFEST,'client-key':key}})
while ws.receive(30).get('type')!='registered': pass
cands={
 'picture':['pictureMode','brightness','backlight','contrast','color','sharpness','energySaving','eyeComfortMode','truMotionMode','motionEyeCare','dynamicContrast','superResolution','noiseReduction','mpegNoiseReduction','smoothGradation','realCinema','peakBrightness','adjustingLuminance','aiBrightness','ambientLightCompensation','localDimming','hdrDynamicToneMapping','blackLevel','gamma','colorGamut','colorTemperature'],
 'option':['liveplus','livePlus','acrOnOff','quickStartMode','enableQuickGame','autoPowerOff','standByLightMode','ecoMode','motionSensor','energySavingAuto','IPControlSecureKey','countryGroup','smartServiceCountryCode2','autoUpdate','adNotification','homeAutoLaunch','homePromotion','storeAutoUpdate','instantGameResponse','gameOptimization','simplink','simplinkEnable','autoDeviceDetect','quickStartPlus','screenOff','firstTvSignalRecovery','phlCitySelect','storeMode','powerOnLight','autoLaunchLastApp','lastInputApp'],
 'general':['eulaInfoStatus','language','menuLanguage','autoUpdate','swUpdateAuto','tvName','deviceName','screenSaver','screenSaverTime','ecoMode','eyeComfort','homeAutoLaunch','homePromotion','aiRecommendation','contentRecommendation','homeAdvertisement','autoLaunchLastApp','powerOnAutoLaunch','smartTvPrivacy','viewingInformation','interestBasedAds','voiceInformation'],
 'sound':['soundMode','soundOutput','autoVolume','avSync','eArcSupport','digitalSoundOutput','tvSpeakerSoundOutput','soundAdjustLeftRight'],
 'aiPicture':['aiPicture','aiSound','aiBrightness','aiGenreSelection'],
 'time':['autoClock','timeZone','sleepTimer','offTimer','onTimer','autoOff4h','autoPowerOff'],
 'network':['wolwowlOnOff','wakeOnLan','deviceName','bluetoothSupport'],
 'other':['simplinkEnable','acrOnOff','liveplus','screenRemoteAutoLaunch','quickStartPlus'],
}
found={}
i=0
for cat,keys in cands.items():
    for k in keys:
        i+=1
        ws.send({'type':'request','id':'q%d'%i,'uri':'ssap://settings/getSystemSettings','payload':{'category':cat,'keys':[k]}})
        while True:
            m=ws.receive(30)
            if m.get('id')=='q%d'%i: break
        if m.get('type')!='error' and (m.get('payload') or {}).get('settings'):
            v=m['payload']['settings']
            if k in v: found.setdefault(cat,{})[k]=v[k]
ws.close()
for c,d in found.items():
    print(c); [print('  %-28s %s'%(k,json.dumps(v)[:80])) for k,v in d.items()]
