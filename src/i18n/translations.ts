export type SupportedLang = 'en' | 'ru' | 'de';

export interface TranslationBundle {
  appTitle: string;
  appSubtitle: string;
  hideControls: string;
  showControls: string;
  statusOnline: string;
  statusOffline: string;
  statusFieldOffline: string;
  signInGoogle: string;
  signOut: string;
  signedInAs: string;
  enterXr: string;
  enterAr: string;
  installPwa: string;
  tabs: {
    modules: string;
    multiplayer: string;
    visionQr: string;
    spatialSync: string;
    recordings: string;
    vrMode: string;
    analytics: string;
    rokid: string;
  };
  actions: {
    explodedView: string;
    resetAssembly: string;
    snapAssist: string;
    autoAssemble: string;
    offlineToggle: string;
    syncNow: string;
    androidGyro: string;
    androidGyroLandscape: string;
    landscapeBadge: string;
    rotateLandscapeHint: string;
    lockLandscapeBtn: string;
    recenterView: string;
    arPassthrough: string;
  };
  modules: {
    heading: string;
    progressLabel: string;
    completedBanner: string;
    turbineTitle: string;
    turbineDesc: string;
    gearboxTitle: string;
    gearboxDesc: string;
    robotarmTitle: string;
    robotarmDesc: string;
    spectrometerTitle: string;
    spectrometerDesc: string;
    customTitle: string;
    customDesc: string;
  };
  multiplayer: {
    heading: string;
    roomCode: string;
    displayName: string;
    joinRoom: string;
    leaveRoom: string;
    connectedPeers: string;
    disconnectedHint: string;
    pinNotePlaceholder: string;
    pinNoteBtn: string;
    voiceEnable: string;
    voiceLeave: string;
    voiceMute: string;
    voiceUnmute: string;
    voiceDeafen: string;
    voiceUndeafen: string;
    voiceReady: string;
    voiceSpeaking: string;
    voiceMuted: string;
    voiceOff: string;
    voiceJoinRoomHint: string;
  };
  vision: {
    heading: string;
    startCamera: string;
    stopCamera: string;
    gestureLabel: string;
    detectedObjects: string;
    qrScannerTitle: string;
    uploadQrImage: string;
    sampleQrRoom: string;
    sampleQrModel: string;
    roomBoundsActive: string;
    noCameraFallback: string;
    openScannerBtn: string;
    scannerTitle: string;
    scannerSubtitle: string;
    permGranted: string;
    permPrompt: string;
    permDenied: string;
    permUnsupported: string;
    allowCameraBtn: string;
    switchCamBtn: string;
    rescanBtn: string;
    applyRoomBtn: string;
    autoApplyLabel: string;
    awaitingMarker: string;
    decodedTitle: string;
    dimensionsLabel: string;
    originLabel: string;
    markerIdLabel: string;
    deniedHint: string;
    closeBtn: string;
  };
  spatialSync: {
    heading: string;
    mappingNamePlaceholder: string;
    saveMapping: string;
    shareToggle: string;
    savedMappings: string;
    loadMapping: string;
    deleteMapping: string;
    pendingQueue: string;
    signInRequired: string;
  };
  analytics: {
    heading: string;
    accuracy: string;
    avgDuration: string;
    snappedParts: string;
    collisions: string;
    recentEvents: string;
    realtimeCloud: string;
  };
  rokid: {
    heading: string;
    presetLabel: string;
    enableRokid: string;
    disableRokid: string;
    fovLabel: string;
    ipdLabel: string;
    sbsStereo: string;
    opticalSeeThrough: string;
    imuTracking: string;
    comfortVignette: string;
    latencyLabel: string;
  };
  spatialCard: {
    title: string;
    moduleLabel: string;
    progress: string;
    exploded: string;
    reset: string;
    autoSnap: string;
    rokidMode: string;
    voiceMode: string;
    langLabel: string;
    vrMode: string;
    recordStart: string;
    recordStop: string;
    replayStart: string;
    replayPause: string;
    replayResume: string;
  };
  vrMode: {
    heading: string;
    subtitle: string;
    modeOff: string;
    modeOffDesc: string;
    modeSbs: string;
    modeSbsDesc: string;
    modeMono: string;
    modeMonoDesc: string;
    aspectLabel: string;
    aspectFull: string;
    aspectHalf: string;
    fovLabel: string;
    ipdLabel: string;
    dividerLabel: string;
    imuLabel: string;
    vignetteLabel: string;
    quickOff: string;
    quickSbs: string;
    quickMono: string;
  };
  recordings: {
    heading: string;
    namePlaceholder: string;
    shareToggle: string;
    startBtn: string;
    stopSaveBtn: string;
    recordingStarted: string;
    savedPrefix: string;
    recBadge: string;
    replayBadge: string;
    playBtn: string;
    pauseBtn: string;
    stepPrevBtn: string;
    stepNextBtn: string;
    exitReplayBtn: string;
    replayItemBtn: string;
    deleteBtn: string;
    speedLabel: string;
    timelineLabel: string;
    empty: string;
    framesLabel: string;
    snapsLabel: string;
    stepsTimeline: string;
  };
  voiceCmd: {
    btnOff: string;
    btnOn: string;
    btnUnsupported: string;
    listeningHint: string;
    lastCmdPrefix: string;
    actions: {
      reset_scene: string;
      toggle_menu: string;
      snap_part: string;
      auto_assemble: string;
      explode_view: string;
      collapse_view: string;
      recenter_view: string;
      next_module: string;
      module_turbine: string;
      module_gearbox: string;
      module_robotarm: string;
      module_spectrometer: string;
      toggle_rokid: string;
      toggle_offline: string;
      start_recording: string;
      stop_recording: string;
      replay_session: string;
      vr_sbs: string;
      vr_mono: string;
      vr_off: string;
      toggle_3dof: string;
    };
  };
}

export const TRANSLATIONS: Record<SupportedLang, TranslationBundle> = {
  en: {
    appTitle: 'AeroLab XR',
    appSubtitle: '3D Physics Assembly & Spatial Training',
    hideControls: 'Hide Controls (H)',
    showControls: 'Show Controls (H)',
    statusOnline: 'Cloud Online',
    statusOffline: 'Offline Mode',
    statusFieldOffline: 'Field Offline',
    signInGoogle: 'Sign In',
    signOut: 'Sign Out',
    signedInAs: 'Operator',
    enterXr: 'Enter VR / AR',
    enterAr: 'Enter AR (ARCore)',
    installPwa: 'Install App',
    tabs: {
      modules: 'Modules',
      multiplayer: 'Multiplayer',
      visionQr: 'Camera & QR',
      spatialSync: 'Spatial Sync',
      recordings: 'Recordings',
      vrMode: 'VR Mode',
      analytics: 'Analytics',
      rokid: 'Rokid Max',
    },
    actions: {
      explodedView: 'Exploded',
      resetAssembly: 'Reset',
      snapAssist: 'Snap Next',
      autoAssemble: 'Auto Build',
      offlineToggle: 'Field Offline',
      syncNow: 'Sync Queue',
      androidGyro: '3DoF Gyro',
      androidGyroLandscape: '3DoF Landscape',
      landscapeBadge: '3DoF · Landscape',
      rotateLandscapeHint: 'Rotate device to landscape for 3DoF tracking',
      lockLandscapeBtn: 'Lock Landscape',
      recenterView: 'Recenter',
      arPassthrough: 'AR / VR BG',
    },
    modules: {
      heading: 'Engineering Simulation Modules',
      progressLabel: 'Assembly Progress',
      completedBanner: 'Assembly Verified — Live Kinematic Simulation Active',
      turbineTitle: 'Axial Jet Turbine Core',
      turbineDesc: '5-stage high-bypass rotor, compressor, annular combustor & exhaust nozzle.',
      gearboxTitle: 'Planetary Reduction Gearbox',
      gearboxDesc: 'Sun, carrier & triple planetary gear train with live torque ratio physics.',
      robotarmTitle: '6-Axis Articulated Robot Arm',
      robotarmDesc: 'Turret pedestal, dual servo booms & parallel precision gripper assembly.',
      spectrometerTitle: 'Optical Waveguide Bench',
      spectrometerDesc: 'Collimator, crown-glass dispersion prism, mirror & CCD detector rail.',
      customTitle: 'QR-Imported Custom Assembly',
      customDesc: 'Parametric 3D assembly loaded dynamically from QR field specification.',
    },
    multiplayer: {
      heading: 'Collaborative Shared Lab',
      roomCode: 'Room Code',
      displayName: 'Operator Name',
      joinRoom: 'Join / Sync',
      leaveRoom: 'Leave',
      connectedPeers: 'Active Peers',
      disconnectedHint: 'Connect to collaborate with real-time 3D avatars and part locks.',
      pinNotePlaceholder: 'Pin spatial note at workbench...',
      pinNoteBtn: 'Pin 3D Note',
      voiceEnable: 'Enable Voice (WebRTC)',
      voiceLeave: 'Leave Voice',
      voiceMute: 'Mute Mic (M)',
      voiceUnmute: 'Unmute Mic (M)',
      voiceDeafen: 'Deafen',
      voiceUndeafen: 'Audio On',
      voiceReady: 'Mic Live',
      voiceSpeaking: 'Speaking',
      voiceMuted: 'Muted',
      voiceOff: 'Voice Off',
      voiceJoinRoomHint: 'Join a multiplayer room to talk via WebRTC.',
    },
    vision: {
      heading: 'AR Camera Vision & QR Importer',
      startCamera: 'Start Camera CV',
      stopCamera: 'Stop Camera',
      gestureLabel: 'Detected Gesture',
      detectedObjects: 'AR Recognized Objects',
      qrScannerTitle: 'QR Room-Scale & 3D Model Import',
      uploadQrImage: 'Scan QR Image',
      sampleQrRoom: 'Test QR: Room Scale',
      sampleQrModel: 'Test QR: 3D Model',
      roomBoundsActive: 'Room Scale Active',
      noCameraFallback: 'Camera idle or unavailable — upload QR or trigger test payloads.',
      openScannerBtn: 'QR Scanner Overlay',
      scannerTitle: 'Room-Scale QR Marker Scanner',
      scannerSubtitle: 'Point the camera at an external QR marker to import room dimensions, origin & yaw.',
      permGranted: 'Camera: Granted',
      permPrompt: 'Camera: Permission Needed',
      permDenied: 'Camera: Denied',
      permUnsupported: 'Camera: Unavailable',
      allowCameraBtn: 'Allow Camera & Scan',
      switchCamBtn: 'Switch Camera',
      rescanBtn: 'Rescan Marker',
      applyRoomBtn: 'Import Room Scale',
      autoApplyLabel: 'Auto-import on scan',
      awaitingMarker: 'Align an external QR marker inside the viewfinder…',
      decodedTitle: 'Detected Room-Scale Spatial Config',
      dimensionsLabel: 'Dimensions',
      originLabel: 'Origin & Yaw',
      markerIdLabel: 'Marker ID',
      deniedHint: 'Camera access was denied. Enable camera permission in browser settings, or upload a QR marker image.',
      closeBtn: 'Close',
    },
    spatialSync: {
      heading: 'Cloud-Synced Spatial Mappings',
      mappingNamePlaceholder: 'Site / Workbench Mapping Name',
      saveMapping: 'Save Mapping',
      shareToggle: 'Shared Team Map',
      savedMappings: 'Saved Sessions',
      loadMapping: 'Load',
      deleteMapping: 'Delete',
      pendingQueue: 'Pending Offline Sync',
      signInRequired: 'Sign in for cloud sync; offline local cache always active.',
    },
    analytics: {
      heading: 'Real-Time Performance Analytics',
      accuracy: 'Snap Accuracy',
      avgDuration: 'Avg Step Time',
      snappedParts: 'Snapped Parts',
      collisions: 'Physics Impacts',
      recentEvents: 'Live Telemetry Stream',
      realtimeCloud: 'Firestore Live Sync',
    },
    rokid: {
      heading: 'Rokid Max AR Glasses (Gen 1) & Comfort',
      presetLabel: '50° Birdbath FOV · 1920×1080/eye · Low-Latency Mode',
      enableRokid: 'Enable Rokid Max Mode',
      disableRokid: 'Exit Rokid Max Mode',
      fovLabel: 'Optical FOV',
      ipdLabel: 'IPD Calibration',
      sbsStereo: '3D SBS Stereo Split',
      opticalSeeThrough: 'Additive Optical Black-Key',
      imuTracking: '3DoF IMU Head Track',
      comfortVignette: 'Anti-Nausea Vignette',
      latencyLabel: 'Frame Latency',
    },
    spatialCard: {
      title: 'AeroLab Spatial Console',
      moduleLabel: 'Module',
      progress: 'Progress',
      exploded: 'Exploded',
      reset: 'Reset',
      autoSnap: 'Snap Next',
      rokidMode: 'Rokid AR',
      voiceMode: 'Voice',
      langLabel: 'Lang',
      vrMode: 'VR',
      recordStart: '● Rec',
      recordStop: '■ Stop Rec',
      replayStart: '▶ Replay',
      replayPause: '⏸ Pause',
      replayResume: '▶ Resume',
    },
    vrMode: {
      heading: 'VR Viewing Modes — Horizontal SBS & Monoscopic',
      subtitle: 'Switch between standard view, dual-eye Side-by-Side 3D stereo, and single-viewport Monoscopic VR.',
      modeOff: 'Standard / AR',
      modeOffDesc: 'Normal full-viewport workbench or AR passthrough.',
      modeSbs: 'VR · Horizontal SBS',
      modeSbsDesc: 'Dual L|R stereo viewports with adjustable IPD & FOV.',
      modeMono: 'VR · Monoscopic',
      modeMonoDesc: 'Zero-disparity single-eye VR viewport & WebXR sync.',
      aspectLabel: 'SBS Aspect',
      aspectFull: 'Full SBS (50/50)',
      aspectHalf: 'Half SBS (16:9)',
      fovLabel: 'VR FOV',
      ipdLabel: 'Eye IPD',
      dividerLabel: 'SBS Center Seam (L | R)',
      imuLabel: '3DoF Gyro Head Track',
      vignetteLabel: 'Anti-Nausea Vignette',
      quickOff: 'VR: OFF',
      quickSbs: 'VR · SBS',
      quickMono: 'VR · MONO',
    },
    recordings: {
      heading: 'Spatial Recording & Training Replay',
      namePlaceholder: 'Training Recording Title',
      shareToggle: 'Share Recording',
      startBtn: '● Start Recording',
      stopSaveBtn: '■ Stop & Save',
      recordingStarted: 'Recording assembly & physics...',
      savedPrefix: 'Saved replay',
      recBadge: 'REC',
      replayBadge: 'REPLAY',
      playBtn: 'Play',
      pauseBtn: 'Pause',
      stepPrevBtn: '⏮ Step',
      stepNextBtn: 'Step ⏭',
      exitReplayBtn: 'Exit Replay',
      replayItemBtn: 'Replay',
      deleteBtn: 'Delete',
      speedLabel: 'Speed',
      timelineLabel: 'Timeline',
      empty: 'No spatial recordings yet. Start recording an assembly session!',
      framesLabel: 'frames',
      snapsLabel: 'snaps',
      stepsTimeline: 'Key Steps',
    },
    voiceCmd: {
      btnOff: 'Voice Cmd',
      btnOn: 'Listening…',
      btnUnsupported: 'Voice N/A',
      listeningHint: 'Say: "Reset Scene", "Snap Part", "Start Recording", "Replay Session"',
      lastCmdPrefix: 'Voice',
      actions: {
        reset_scene: 'Reset Scene',
        toggle_menu: 'Toggle Menu',
        snap_part: 'Snap Part',
        auto_assemble: 'Auto Build',
        explode_view: 'Explode View',
        collapse_view: 'Collapse View',
        recenter_view: 'Recenter View',
        next_module: 'Next Module',
        module_turbine: 'Turbine Module',
        module_gearbox: 'Gearbox Module',
        module_robotarm: 'Robot Arm Module',
        module_spectrometer: 'Spectrometer Module',
        toggle_rokid: 'Rokid Mode',
        toggle_offline: 'Field Offline',
        start_recording: 'Start Recording',
        stop_recording: 'Stop Recording',
        replay_session: 'Replay Session',
        vr_sbs: 'VR Horizontal SBS',
        vr_mono: 'VR Monoscopic',
        vr_off: 'Exit VR Mode',
        toggle_3dof: '3DoF Landscape',
      },
    },
  },
  ru: {
    appTitle: 'AeroLab XR',
    appSubtitle: '3D-сборка и физическая симуляция',
    hideControls: 'Скрыть панель (H)',
    showControls: 'Показать панель (H)',
    statusOnline: 'Облако активно',
    statusOffline: 'Офлайн-режим',
    statusFieldOffline: 'Полевой офлайн',
    signInGoogle: 'Войти',
    signOut: 'Выйти',
    signedInAs: 'Оператор',
    enterXr: 'Режим VR / AR',
    enterAr: 'AR-режим (ARCore)',
    installPwa: 'Установить',
    tabs: {
      modules: 'Модули',
      multiplayer: 'Мультиплеер',
      visionQr: 'Камера и QR',
      spatialSync: 'Пространство',
      recordings: 'Записи 3D',
      vrMode: 'Режим VR',
      analytics: 'Аналитика',
      rokid: 'Rokid Max',
    },
    actions: {
      explodedView: 'Разбор',
      resetAssembly: 'Сброс',
      snapAssist: 'Стыковать',
      autoAssemble: 'Автосборка',
      offlineToggle: 'Полевой офлайн',
      syncNow: 'Синхронизировать',
      androidGyro: 'Гироскоп 3DoF',
      androidGyroLandscape: '3DoF Ландшафт',
      landscapeBadge: '3DoF · Ландшафт',
      rotateLandscapeHint: 'Поверните устройство горизонтально для режима 3DoF',
      lockLandscapeBtn: 'Горизонтально',
      recenterView: 'Центрировать',
      arPassthrough: 'AR / VR фон',
    },
    modules: {
      heading: 'Учебные инженерные модули',
      progressLabel: 'Прогресс сборки',
      completedBanner: 'Сборка подтверждена — запущена кинематическая симуляция',
      turbineTitle: 'Осевая турбина двигателя',
      turbineDesc: '5-ступенчатый ротор, компрессор, камера сгорания и сопло.',
      gearboxTitle: 'Планетарный редуктор',
      gearboxDesc: 'Солнечная шестерня, водило и 3 сателлита с передаточным числом.',
      robotarmTitle: '6-осевой робот-манипулятор',
      robotarmDesc: 'Поворотная турель, сервоприводы плеча и прецизионный захват.',
      spectrometerTitle: 'Оптический спектрометр',
      spectrometerDesc: 'Коллиматор, дисперсионная призма, зеркало и матрица ПЗС.',
      customTitle: 'Модель из QR-кода',
      customDesc: 'Параметрическая 3D-сборка, импортированная через QR-код.',
    },
    multiplayer: {
      heading: 'Совместная лаборатория',
      roomCode: 'Код комнаты',
      displayName: 'Имя оператора',
      joinRoom: 'Войти',
      leaveRoom: 'Выйти',
      connectedPeers: 'Участники',
      disconnectedHint: 'Подключитесь для совместной работы с 3D-аватарами.',
      pinNotePlaceholder: 'Закрепить 3D-заметку...',
      pinNoteBtn: 'Добавить заметку',
      voiceEnable: 'Вкл. голос (WebRTC)',
      voiceLeave: 'Выкл. голос',
      voiceMute: 'Микр. выкл (M)',
      voiceUnmute: 'Микр. вкл (M)',
      voiceDeafen: 'Без звука',
      voiceUndeafen: 'Звук вкл',
      voiceReady: 'В эфире',
      voiceSpeaking: 'Говорит',
      voiceMuted: 'Заглушён',
      voiceOff: 'Без голоса',
      voiceJoinRoomHint: 'Войдите в комнату для голосовой связи WebRTC.',
    },
    vision: {
      heading: 'AR-распознавание и QR-импорт',
      startCamera: 'Вкл. камеру CV',
      stopCamera: 'Выкл. камеру',
      gestureLabel: 'Жест руки',
      detectedObjects: 'Объекты AR',
      qrScannerTitle: 'QR-сканер комнаты и 3D-моделей',
      uploadQrImage: 'Скан QR из файла',
      sampleQrRoom: 'Тест QR: Комната',
      sampleQrModel: 'Тест QR: 3D-модель',
      roomBoundsActive: 'Масштаб комнаты активен',
      noCameraFallback: 'Камера неактивна — загрузите QR-файл или запустите тест.',
      openScannerBtn: 'QR-сканер',
      scannerTitle: 'QR-сканер калибровки комнаты',
      scannerSubtitle: 'Наведите камеру на внешний QR-маркер для импорта размеров, центра и угла комнаты.',
      permGranted: 'Камера: Разрешена',
      permPrompt: 'Камера: Нужен доступ',
      permDenied: 'Камера: Запрещена',
      permUnsupported: 'Камера: Недоступна',
      allowCameraBtn: 'Разрешить камеру',
      switchCamBtn: 'Сменить камеру',
      rescanBtn: 'Сканировать снова',
      applyRoomBtn: 'Импортировать границы',
      autoApplyLabel: 'Автоимпорт при скане',
      awaitingMarker: 'Поместите внешний QR-маркер в рамку…',
      decodedTitle: 'Распознанная конфигурация комнаты',
      dimensionsLabel: 'Габариты',
      originLabel: 'Начало и курс',
      markerIdLabel: 'ID маркера',
      deniedHint: 'Доступ к камере отклонён. Разрешите камеру в настройках браузера или загрузите фото QR-кода.',
      closeBtn: 'Закрыть',
    },
    spatialSync: {
      heading: 'Облачная синхронизация карт',
      mappingNamePlaceholder: 'Название карты пространства',
      saveMapping: 'Сохранить карту',
      shareToggle: 'Общий доступ',
      savedMappings: 'Сохранённые сессии',
      loadMapping: 'Загрузить',
      deleteMapping: 'Удалить',
      pendingQueue: 'Очередь офлайн-синхронизации',
      signInRequired: 'Войдите для облака; локальный кэш работает всегда.',
    },
    analytics: {
      heading: 'Аналитика эффективности',
      accuracy: 'Точность стыковки',
      avgDuration: 'Ср. время шага',
      snappedParts: 'Собрано деталей',
      collisions: 'Столкновения',
      recentEvents: 'Поток телеметрии',
      realtimeCloud: 'Firestore в реальном времени',
    },
    rokid: {
      heading: 'Очки Rokid Max (1-го пок.) и комфорт',
      presetLabel: '50° Birdbath FOV · 1920×1080/глаз · Низкая задержка',
      enableRokid: 'Вкл. режим Rokid Max',
      disableRokid: 'Выкл. режим Rokid Max',
      fovLabel: 'Оптический FOV',
      ipdLabel: 'Межзрачковое (IPD)',
      sbsStereo: '3D SBS стереорежим',
      opticalSeeThrough: 'Аддитивная оптика',
      imuTracking: '3DoF IMU трекинг головы',
      comfortVignette: 'Виньетка комфорта',
      latencyLabel: 'Задержка кадра',
    },
    spatialCard: {
      title: 'Пространственный пульт',
      moduleLabel: 'Модуль',
      progress: 'Прогресс',
      exploded: 'Разбор',
      reset: 'Сброс',
      autoSnap: 'Стыковать',
      rokidMode: 'Rokid AR',
      voiceMode: 'Голос',
      langLabel: 'Язык',
      vrMode: 'VR',
      recordStart: '● Запись',
      recordStop: '■ Стоп',
      replayStart: '▶ Повтор',
      replayPause: '⏸ Пауза',
      replayResume: '▶ Далее',
    },
    vrMode: {
      heading: 'Режимы VR — Горизонтальный SBS и Моно',
      subtitle: 'Переключение между обычным видом, стереопарой Side-by-Side и моноскопическим VR.',
      modeOff: 'Обычный / AR',
      modeOffDesc: 'Стандартная сцена или сквозной AR-режим.',
      modeSbs: 'VR · Гориз. SBS',
      modeSbsDesc: 'Два экрана Л|П со стереосдвигом IPD и настройкой FOV.',
      modeMono: 'VR · Моноскоп',
      modeMonoDesc: 'Единый кадр VR без параллакса (в т.ч. в WebXR).',
      aspectLabel: 'Формат SBS',
      aspectFull: 'Full SBS (50/50)',
      aspectHalf: 'Half SBS (16:9)',
      fovLabel: 'Угол VR FOV',
      ipdLabel: 'База глаз IPD',
      dividerLabel: 'Разделитель L | R',
      imuLabel: '3DoF Гироскоп',
      vignetteLabel: 'Виньетка комфорта',
      quickOff: 'VR: ВЫКЛ',
      quickSbs: 'VR · SBS',
      quickMono: 'VR · МОНО',
    },
    recordings: {
      heading: 'Пространственная запись и учебный повтор',
      namePlaceholder: 'Название учебной записи',
      shareToggle: 'Поделиться записью',
      startBtn: '● Начать запись',
      stopSaveBtn: '■ Стоп и сохранить',
      recordingStarted: 'Запись сборки и физики...',
      savedPrefix: 'Запись сохранена',
      recBadge: 'ЗАПИСЬ',
      replayBadge: 'ПОВТОР',
      playBtn: 'Пуск',
      pauseBtn: 'Пауза',
      stepPrevBtn: '⏮ Шаг',
      stepNextBtn: 'Шаг ⏭',
      exitReplayBtn: 'Выход из повтора',
      replayItemBtn: 'Повтор',
      deleteBtn: 'Удалить',
      speedLabel: 'Скорость',
      timelineLabel: 'Шкала',
      empty: 'Записей пока нет. Начните запись сборки!',
      framesLabel: 'кадров',
      snapsLabel: 'стыковок',
      stepsTimeline: 'Ключевые шаги',
    },
    voiceCmd: {
      btnOff: 'Команды',
      btnOn: 'Слушаю…',
      btnUnsupported: 'Речь Н/Д',
      listeningHint: 'Скажите: «Сброс сцены», «Стыковать деталь», «Начать запись», «Воспроизвести запись»',
      lastCmdPrefix: 'Команда',
      actions: {
        reset_scene: 'Сброс сцены',
        toggle_menu: 'Меню',
        snap_part: 'Стыковать деталь',
        auto_assemble: 'Автосборка',
        explode_view: 'Режим разбора',
        collapse_view: 'Свернуть разбор',
        recenter_view: 'Центрировать',
        next_module: 'След. модуль',
        module_turbine: 'Турбина',
        module_gearbox: 'Редуктор',
        module_robotarm: 'Робот',
        module_spectrometer: 'Спектрометр',
        toggle_rokid: 'Режим Rokid',
        toggle_offline: 'Офлайн-режим',
        start_recording: 'Начать запись',
        stop_recording: 'Остановить запись',
        replay_session: 'Повтор сессии',
        vr_sbs: 'VR Гориз. SBS',
        vr_mono: 'VR Моноскоп',
        vr_off: 'Выход из VR',
        toggle_3dof: 'Гироскоп 3DoF',
      },
    },
  },
  de: {
    appTitle: 'AeroLab XR',
    appSubtitle: '3D-Physikmontage & Raumtraining',
    hideControls: 'Steuerung ausblenden (H)',
    showControls: 'Steuerung einblenden (H)',
    statusOnline: 'Cloud Online',
    statusOffline: 'Offline-Modus',
    statusFieldOffline: 'Feld-Offline',
    signInGoogle: 'Anmelden',
    signOut: 'Abmelden',
    signedInAs: 'Techniker',
    enterXr: 'VR / AR starten',
    enterAr: 'AR starten (ARCore)',
    installPwa: 'App installieren',
    tabs: {
      modules: 'Module',
      multiplayer: 'Mehrspieler',
      visionQr: 'Kamera & QR',
      spatialSync: 'Raumsync',
      recordings: 'Aufnahmen',
      vrMode: 'VR-Modus',
      analytics: 'Analytik',
      rokid: 'Rokid Max',
    },
    actions: {
      explodedView: 'Explosion',
      resetAssembly: 'Reset',
      snapAssist: 'Einrasten',
      autoAssemble: 'Automontage',
      offlineToggle: 'Feld-Offline',
      syncNow: 'Sync-Queue',
      androidGyro: '3DoF-Gyro',
      androidGyroLandscape: '3DoF Querformat',
      landscapeBadge: '3DoF · Querformat',
      rotateLandscapeHint: 'Gerät für 3DoF-Tracking ins Querformat drehen',
      lockLandscapeBtn: 'Querformat',
      recenterView: 'Zentrieren',
      arPassthrough: 'AR / VR BG',
    },
    modules: {
      heading: 'Technische Simulationsmodule',
      progressLabel: 'Montagefortschritt',
      completedBanner: 'Montage bestätigt — Live-Kinematik aktiv',
      turbineTitle: 'Axial-Strahltriebwerk',
      turbineDesc: '5-stufiger Rotor, Verdichter, Ringbrennkammer & Schubdüse.',
      gearboxTitle: 'Planetengetriebe',
      gearboxDesc: 'Sonnenrad, Steg und 3 Planetenräder mit Übersetzungssimulation.',
      robotarmTitle: '6-Achs-Industrieroboter',
      robotarmDesc: 'Drehsockel, Servoarme und Präzisions-Parallelgreifer.',
      spectrometerTitle: 'Optische Spektrometerbank',
      spectrometerDesc: 'Kollimator, Kronglas-Dispersionsprisma, Spiegel & CCD-Sensor.',
      customTitle: 'QR-Importiertes 3D-Modell',
      customDesc: 'Parametrische 3D-Baugruppe aus QR-Feldspezifikation.',
    },
    multiplayer: {
      heading: 'Kollaboratives Lernlabor',
      roomCode: 'Raumcode',
      displayName: 'Name',
      joinRoom: 'Beitreten',
      leaveRoom: 'Verlassen',
      connectedPeers: 'Aktive Teilnehmer',
      disconnectedHint: 'Verbinden für Echtzeit-3D-Avatare und Teil-Sperren.',
      pinNotePlaceholder: '3D-Notiz an Werkbank heften...',
      pinNoteBtn: 'Notiz anheften',
      voiceEnable: 'Sprachchat (WebRTC)',
      voiceLeave: 'Sprache trennen',
      voiceMute: 'Stumm (M)',
      voiceUnmute: 'Mikro an (M)',
      voiceDeafen: 'Taub',
      voiceUndeafen: 'Ton an',
      voiceReady: 'Mikro aktiv',
      voiceSpeaking: 'Spricht',
      voiceMuted: 'Stumm',
      voiceOff: 'Kein Audio',
      voiceJoinRoomHint: 'Raum beitreten für Echtzeit-WebRTC-Sprache.',
    },
    vision: {
      heading: 'AR-Kameravision & QR-Importer',
      startCamera: 'Kamera-CV starten',
      stopCamera: 'Kamera stoppen',
      gestureLabel: 'Erkannte Geste',
      detectedObjects: 'AR-Objekterkennung',
      qrScannerTitle: 'QR Raummaß- & 3D-Modell-Import',
      uploadQrImage: 'QR-Bild scannen',
      sampleQrRoom: 'Test-QR: Raumdaten',
      sampleQrModel: 'Test-QR: 3D-Modell',
      roomBoundsActive: 'Raumgrenzen aktiv',
      noCameraFallback: 'Kamera inaktiv — QR-Bild hochladen oder Testdaten laden.',
      openScannerBtn: 'QR-Scanner',
      scannerTitle: 'QR-Raumkalibrierungs-Scanner',
      scannerSubtitle: 'Kamera auf externen QR-Marker richten, um Raummaße, Ursprung & Winkel zu importieren.',
      permGranted: 'Kamera: Erlaubt',
      permPrompt: 'Kamera: Freigabe nötig',
      permDenied: 'Kamera: Abgelehnt',
      permUnsupported: 'Kamera: Nicht verfügbar',
      allowCameraBtn: 'Kamera erlauben & scannen',
      switchCamBtn: 'Kamera wechseln',
      rescanBtn: 'Neu scannen',
      applyRoomBtn: 'Raumdaten importieren',
      autoApplyLabel: 'Auto-Import beim Scan',
      awaitingMarker: 'Externen QR-Marker im Sucher ausrichten…',
      decodedTitle: 'Erkannte Raumkonfiguration',
      dimensionsLabel: 'Abmessungen',
      originLabel: 'Ursprung & Gierwinkel',
      markerIdLabel: 'Marker-ID',
      deniedHint: 'Kamerazugriff verweigert. Kameraberechtigung im Browser aktivieren oder QR-Bild hochladen.',
      closeBtn: 'Schließen',
    },
    spatialSync: {
      heading: 'Cloud-Sync für Raumkartierung',
      mappingNamePlaceholder: 'Name der Raumkartierung',
      saveMapping: 'Kartierung speichern',
      shareToggle: 'Team-Freigabe',
      savedMappings: 'Gespeicherte Sitzungen',
      loadMapping: 'Laden',
      deleteMapping: 'Löschen',
      pendingQueue: 'Ausstehender Offline-Sync',
      signInRequired: 'Anmelden für Cloud-Sync; lokaler Offline-Cache aktiv.',
    },
    analytics: {
      heading: 'Echtzeit-Leistungsanalytik',
      accuracy: 'Präzision',
      avgDuration: 'Ø Schrittzeit',
      snappedParts: 'Montierte Teile',
      collisions: 'Physik-Kontakte',
      recentEvents: 'Live-Telemetriestream',
      realtimeCloud: 'Firestore Live-Sync',
    },
    rokid: {
      heading: 'Rokid Max AR-Brille (Gen 1) & Komfort',
      presetLabel: '50° Birdbath FOV · 1920×1080/Auge · Niedrige Latenz',
      enableRokid: 'Rokid Max Modus aktivieren',
      disableRokid: 'Rokid Max Modus beenden',
      fovLabel: 'Optisches FOV',
      ipdLabel: 'Augenabstand (IPD)',
      sbsStereo: '3D SBS Stereo-Split',
      opticalSeeThrough: 'Additives Optik-Schwarz',
      imuTracking: '3DoF IMU Kopf-Tracking',
      comfortVignette: 'Komfort-Vignette',
      latencyLabel: 'Bildlatenz',
    },
    spatialCard: {
      title: 'AeroLab Raumkonsole',
      moduleLabel: 'Modul',
      progress: 'Fortschritt',
      exploded: 'Explosion',
      reset: 'Reset',
      autoSnap: 'Einrasten',
      rokidMode: 'Rokid AR',
      voiceMode: 'Sprache',
      langLabel: 'Sprache',
      vrMode: 'VR',
      recordStart: '● Aufn.',
      recordStop: '■ Stopp',
      replayStart: '▶ Replay',
      replayPause: '⏸ Pause',
      replayResume: '▶ Weiter',
    },
    vrMode: {
      heading: 'VR-Anzeigemodi — Horizontal SBS & Monoskopisch',
      subtitle: 'Wechseln zwischen Standardansicht, dualem Side-by-Side-Stereo und Monoskopischem VR.',
      modeOff: 'Standard / AR',
      modeOffDesc: 'Normale Einzelansicht oder AR-Passthrough.',
      modeSbs: 'VR · Horizontal SBS',
      modeSbsDesc: 'Geteilte L|R-Stereoansicht mit IPD- & FOV-Kalibrierung.',
      modeMono: 'VR · Monoskopisch',
      modeMonoDesc: 'Einzelkamera-VR ohne Disparität (inkl. WebXR-Sync).',
      aspectLabel: 'SBS-Format',
      aspectFull: 'Full SBS (50/50)',
      aspectHalf: 'Half SBS (16:9)',
      fovLabel: 'VR FOV',
      ipdLabel: 'Augenabstand IPD',
      dividerLabel: 'SBS-Trennlinie (L | R)',
      imuLabel: '3DoF Gyro-Tracking',
      vignetteLabel: 'Komfort-Vignette',
      quickOff: 'VR: AUS',
      quickSbs: 'VR · SBS',
      quickMono: 'VR · MONO',
    },
    recordings: {
      heading: 'Raum-Aufzeichnung & Trainings-Wiedergabe',
      namePlaceholder: 'Titel der Trainingsaufnahme',
      shareToggle: 'Aufnahme teilen',
      startBtn: '● Aufnahme starten',
      stopSaveBtn: '■ Stopp & Speichern',
      recordingStarted: 'Montage & Physik werden aufgezeichnet...',
      savedPrefix: 'Aufnahme gespeichert',
      recBadge: 'AUFN',
      replayBadge: 'REPLAY',
      playBtn: 'Abspielen',
      pauseBtn: 'Pause',
      stepPrevBtn: '⏮ Schritt',
      stepNextBtn: 'Schritt ⏭',
      exitReplayBtn: 'Replay beenden',
      replayItemBtn: 'Abspielen',
      deleteBtn: 'Löschen',
      speedLabel: 'Tempo',
      timelineLabel: 'Zeitachse',
      empty: 'Noch keine Raumaufnahmen. Starten Sie eine Montageaufzeichnung!',
      framesLabel: 'Frames',
      snapsLabel: 'Einraster',
      stepsTimeline: 'Schlüsselschritte',
    },
    voiceCmd: {
      btnOff: 'Sprachbefehl',
      btnOn: 'Hört zu…',
      btnUnsupported: 'Sprache N/V',
      listeningHint: 'Sage: „Szene zurücksetzen“, „Teil einrasten“, „Aufnahme starten“, „Wiedergabe starten“',
      lastCmdPrefix: 'Befehl',
      actions: {
        reset_scene: 'Szene zurücksetzen',
        toggle_menu: 'Menü umschalten',
        snap_part: 'Teil einrasten',
        auto_assemble: 'Automontage',
        explode_view: 'Explosionsansicht',
        collapse_view: 'Zusammenklappen',
        recenter_view: 'Zentrieren',
        next_module: 'Nächstes Modul',
        module_turbine: 'Turbinen-Modul',
        module_gearbox: 'Getriebe-Modul',
        module_robotarm: 'Roboterarm-Modul',
        module_spectrometer: 'Spektrometer-Modul',
        toggle_rokid: 'Rokid-Modus',
        toggle_offline: 'Feld-Offline',
        start_recording: 'Aufnahme starten',
        stop_recording: 'Aufnahme stoppen',
        replay_session: 'Wiedergabe starten',
        vr_sbs: 'VR Horizontal SBS',
        vr_mono: 'VR Monoskopisch',
        vr_off: 'VR beenden',
        toggle_3dof: '3DoF Querformat',
      },
    },
  },
};
