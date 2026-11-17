import type { SupportedLang } from '../i18n/translations.ts';

export type VoiceCommandAction =
  | 'reset_scene'
  | 'toggle_menu'
  | 'snap_part'
  | 'auto_assemble'
  | 'explode_view'
  | 'collapse_view'
  | 'recenter_view'
  | 'next_module'
  | 'module_turbine'
  | 'module_gearbox'
  | 'module_robotarm'
  | 'module_spectrometer'
  | 'toggle_rokid'
  | 'toggle_offline'
  | 'start_recording'
  | 'stop_recording'
  | 'replay_session'
  | 'vr_sbs'
  | 'vr_mono'
  | 'vr_off'
  | 'toggle_3dof';

export interface VoiceCommandStateSnapshot {
  supported: boolean;
  active: boolean;
  listening: boolean;
  lang: SupportedLang;
  lastTranscript: string;
  lastAction: VoiceCommandAction | null;
  errorMessage: string;
}

interface CommandPattern {
  action: VoiceCommandAction;
  phrases: string[];
}

const LANG_BCP47: Record<SupportedLang, string> = {
  en: 'en-US',
  ru: 'ru-RU',
  de: 'de-DE',
};

const COMMAND_PATTERNS: CommandPattern[] = [
  {
    action: 'reset_scene',
    phrases: [
      'reset scene',
      'reset assembly',
      'reset workbench',
      'restart scene',
      'reset',
      'сброс сцены',
      'сбросить сцену',
      'сброс сборки',
      'сбросить',
      'сброс',
      'szene zurücksetzen',
      'montage zurücksetzen',
      'zurücksetzen',
    ],
  },
  {
    action: 'toggle_menu',
    phrases: [
      'toggle menu',
      'show menu',
      'hide menu',
      'open menu',
      'close menu',
      'toggle controls',
      'hide controls',
      'show controls',
      'открыть меню',
      'скрыть меню',
      'показать меню',
      'переключить меню',
      'меню',
      'menü umschalten',
      'menü öffnen',
      'menü schließen',
      'menü ausblenden',
      'menü einblenden',
      'menü',
    ],
  },
  {
    action: 'snap_part',
    phrases: [
      'snap part',
      'snap next part',
      'snap next',
      'attach part',
      'connect part',
      'assemble part',
      'next part',
      'snap',
      'стыковать деталь',
      'собрать деталь',
      'следующая деталь',
      'стыковать',
      'teil einrasten',
      'nächstes teil',
      'einrasten',
    ],
  },
  {
    action: 'auto_assemble',
    phrases: [
      'auto assemble',
      'auto build',
      'assemble all',
      'complete assembly',
      'автосборка',
      'собрать всё',
      'автоматическая сборка',
      'automontage',
      'alles montieren',
    ],
  },
  {
    action: 'explode_view',
    phrases: [
      'explode view',
      'exploded view',
      'expand view',
      'expand parts',
      'explode',
      'режим разбора',
      'разобрать вид',
      'разбор',
      'explosionsansicht',
      'explosion',
    ],
  },
  {
    action: 'collapse_view',
    phrases: [
      'collapse view',
      'close exploded',
      'unexplode',
      'collapse',
      'свернуть разбор',
      'соединить',
      'zusammenklappen',
      'ansicht schließen',
    ],
  },
  {
    action: 'recenter_view',
    phrases: [
      'recenter view',
      'center view',
      'recenter camera',
      'recenter',
      'центрировать вид',
      'центрировать',
      'ansicht zentrieren',
      'zentrieren',
    ],
  },
  {
    action: 'next_module',
    phrases: [
      'next module',
      'switch module',
      'change module',
      'следующий модуль',
      'сменить модуль',
      'nächstes modul',
      'modul wechseln',
    ],
  },
  {
    action: 'module_turbine',
    phrases: ['load turbine', 'jet turbine', 'turbine', 'турбина', 'турбину'],
  },
  {
    action: 'module_gearbox',
    phrases: ['load gearbox', 'gearbox', 'редуктор', 'planetengetriebe', 'getriebe'],
  },
  {
    action: 'module_robotarm',
    phrases: ['load robot', 'robot arm', 'робот', 'манипулятор', 'roboter', 'roboterarm'],
  },
  {
    action: 'module_spectrometer',
    phrases: ['load spectrometer', 'spectrometer', 'optics', 'спектрометр', 'оптика', 'spektrometer'],
  },
  {
    action: 'toggle_rokid',
    phrases: [
      'toggle rokid',
      'rokid mode',
      'glasses mode',
      'режим rokid',
      'режим очков',
      'rokid modus',
    ],
  },
  {
    action: 'toggle_offline',
    phrases: [
      'toggle offline',
      'offline mode',
      'офлайн режим',
      'полевой офлайн',
      'offline modus',
    ],
  },
  {
    action: 'start_recording',
    phrases: [
      'start recording',
      'record session',
      'begin recording',
      'начать запись',
      'записать сессию',
      'включить запись',
      'aufnahme starten',
      'sitzung aufnehmen',
    ],
  },
  {
    action: 'stop_recording',
    phrases: [
      'stop recording',
      'save recording',
      'finish recording',
      'остановить запись',
      'сохранить запись',
      'стоп запись',
      'aufnahme stoppen',
      'aufnahme speichern',
    ],
  },
  {
    action: 'replay_session',
    phrases: [
      'replay session',
      'play recording',
      'start replay',
      'воспроизвести запись',
      'повтор сессии',
      'повторить сборку',
      'wiedergabe starten',
      'sitzung abspielen',
    ],
  },
  {
    action: 'vr_sbs',
    phrases: [
      'horizontal sbs',
      'vr sbs',
      'side by side',
      'stereo vr',
      'vr mode',
      'горизонтальный sbs',
      'стерео vr',
      'режим vr',
      'vr sbs',
      'horizontal sbs',
      'vr modus',
      'nebeneinander',
    ],
  },
  {
    action: 'vr_mono',
    phrases: [
      'monoscopic mode',
      'monoscopic',
      'mono vr',
      'mono mode',
      'моноскопический режим',
      'моно vr',
      'моно режим',
      'monoskopischer modus',
      'monoskopisch',
      'mono modus',
    ],
  },
  {
    action: 'vr_off',
    phrases: [
      'exit vr',
      'vr off',
      'disable vr',
      'normal view',
      'выйти из vr',
      'выключить vr',
      'обычный вид',
      'vr beenden',
      'vr aus',
      'normale ansicht',
    ],
  },
  {
    action: 'toggle_3dof',
    phrases: [
      '3dof mode',
      'three dof',
      'gyro mode',
      'landscape mode',
      'режим 3dof',
      'гироскоп',
      'ландшафтный режим',
      '3dof modus',
      'querformat',
    ],
  },
];

function normalizeSpeech(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:"'«»„“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export class VoiceCommandEngine {
  private recognition: SpeechRecognition | null = null;
  private active = false;
  private listening = false;
  private lang: SupportedLang = 'en';
  private lastTranscript = '';
  private lastAction: VoiceCommandAction | null = null;
  private errorMessage = '';
  private consumedResultIndexes = new Set<number>();
  private lastActionTimestamps = new Map<VoiceCommandAction, number>();
  private restartTimer: number | null = null;
  private consecutiveErrors = 0;

  private commandListeners = new Set<(action: VoiceCommandAction, transcript: string) => void>();
  private stateListeners = new Set<(snap: VoiceCommandStateSnapshot) => void>();

  isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  getSnapshot(): VoiceCommandStateSnapshot {
    return {
      supported: this.isSupported(),
      active: this.active,
      listening: this.listening,
      lang: this.lang,
      lastTranscript: this.lastTranscript,
      lastAction: this.lastAction,
      errorMessage: this.errorMessage,
    };
  }

  onCommand(cb: (action: VoiceCommandAction, transcript: string) => void): () => void {
    this.commandListeners.add(cb);
    return () => this.commandListeners.delete(cb);
  }

  onStateChange(cb: (snap: VoiceCommandStateSnapshot) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.getSnapshot());
    return () => this.stateListeners.delete(cb);
  }

  private emitState() {
    const snap = this.getSnapshot();
    for (const cb of this.stateListeners) cb(snap);
  }

  setLanguage(lang: SupportedLang) {
    if (this.lang === lang) return;
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = LANG_BCP47[lang];
      if (this.active) {
        // Restart cleanly so recognizer picks up updated language model immediately
        try {
          this.recognition.stop();
        } catch {
          // Ignore
        }
      }
    }
    this.emitState();
  }

  start(): boolean {
    if (!this.isSupported()) {
      this.errorMessage = 'Web Speech API unavailable in this browser';
      this.emitState();
      return false;
    }
    if (this.active) return true;

    this.errorMessage = '';
    this.active = true;
    this.consecutiveErrors = 0;
    this.consumedResultIndexes.clear();
    this.beginSession();
    this.emitState();
    return true;
  }

  stop() {
    this.active = false;
    this.listening = false;
    if (this.restartTimer !== null) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.onerror = null;
        this.recognition.onresult = null;
        this.recognition.onstart = null;
        this.recognition.stop();
      } catch {
        // Ignore stop errors
      }
      this.recognition = null;
    }
    this.emitState();
  }

  toggle(): boolean {
    if (this.active) {
      this.stop();
      return false;
    }
    return this.start();
  }

  /**
   * Parses a spoken phrase against localized command patterns.
   * Exposed publicly for deterministic testing and quick invocation.
   */
  matchTranscript(transcript: string): VoiceCommandAction | null {
    const clean = normalizeSpeech(transcript);
    if (!clean) return null;

    // Exact match first, then substring match with longest phrase priority
    let bestMatch: { action: VoiceCommandAction; score: number } | null = null;
    for (const entry of COMMAND_PATTERNS) {
      for (const phrase of entry.phrases) {
        if (clean === phrase) {
          return entry.action;
        }
        // Check phrase boundaries to avoid partial word misfires
        if (
          clean.endsWith(phrase) ||
          clean.includes(` ${phrase} `) ||
          clean.startsWith(`${phrase} `)
        ) {
          const score = phrase.length + (clean.endsWith(phrase) ? 20 : 0);
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { action: entry.action, score };
          }
        }
      }
    }
    return bestMatch ? bestMatch.action : null;
  }

  private beginSession() {
    if (!this.active || typeof window === 'undefined') return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = LANG_BCP47[this.lang];
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;

    rec.onstart = () => {
      this.listening = true;
      this.errorMessage = '';
      this.consecutiveErrors = 0;
      this.consumedResultIndexes.clear();
      this.emitState();
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const primary = result[0]?.transcript?.trim() || '';
        if (primary) {
          this.lastTranscript = primary;
        }

        if (this.consumedResultIndexes.has(i)) continue;

        let matched: VoiceCommandAction | null = null;
        let matchedText = primary;
        for (let altIdx = 0; altIdx < result.length; altIdx++) {
          const altText = result[altIdx]?.transcript || '';
          const candidate = this.matchTranscript(altText);
          if (candidate) {
            matched = candidate;
            matchedText = altText.trim();
            break;
          }
        }

        if (matched) {
          const now = performance.now();
          const lastFired = this.lastActionTimestamps.get(matched) ?? 0;
          if (now - lastFired > 1100) {
            this.lastActionTimestamps.set(matched, now);
            this.consumedResultIndexes.add(i);
            this.lastAction = matched;
            this.lastTranscript = matchedText;
            for (const cb of this.commandListeners) {
              cb(matched, matchedText);
            }
          }
        } else if (result.isFinal) {
          this.consumedResultIndexes.add(i);
        }
      }
      this.emitState();
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const err = event.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        this.errorMessage = 'Microphone permission denied for Voice Commands';
        this.stop();
        return;
      }
      if (err === 'no-speech' || err === 'aborted') {
        return;
      }
      this.consecutiveErrors += 1;
      this.errorMessage = `Speech error: ${err}`;
      this.emitState();
    };

    rec.onend = () => {
      this.listening = false;
      this.emitState();
      if (!this.active) return;

      const delayMs = this.consecutiveErrors > 2 ? 1200 : 250;
      if (this.restartTimer !== null) window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (this.active) this.beginSession();
      }, delayMs);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Unable to start speech recognition';
      this.active = false;
      this.listening = false;
      this.emitState();
    }
  }
}

export const voiceCommandEngine = new VoiceCommandEngine();
