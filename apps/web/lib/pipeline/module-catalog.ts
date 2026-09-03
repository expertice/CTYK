import type { ArtifactTypeId } from "../../types/artifact.types";
import type { ModuleId } from "../../types/pipeline.types";
import { getLlmTaskContract } from "./llm-task-contracts";

/** Источники аудио — группа «ИСТОЧНИК» в палитре конструктора. */
export const AUDIO_SOURCE_MODULE_IDS: readonly ModuleId[] = [
  "AUDIO_FROM_UPLOAD",
  "AUDIO_FROM_URL",
  "AUDIO_FROM_API",
  "AUDIO_FROM_RTSP",
  "CHECKLIST_SOURCE",
];

/** Цепочка обработки аудио/речи — группа «Обработка» в палитре конструктора. */
export const PROCESSING_MODULE_IDS: readonly ModuleId[] = [
  "AUDIO_PREPARE",
  "ASR",
  "DIARIZATION",
  "SPEAKER_TURN_MERGE",
  "SPEAKER_DRAFT_EDIT",
  "PSYCH_STATE",
];

/** LLM-модули — группа «МОДУЛИ LLM» в палитре конструктора (порядок карточек). */
export const LLM_PALETTE_MODULE_IDS: readonly ModuleId[] = [
  "LLM_TASK_SUMMARY",
  "LLM_TASK_SPEAKER_NAMES",
  "LLM_TASK_PSYCH",
  "LLM_TASK_CHECKLIST",
  "LLM_PUPPET",
];

/** Доступные в рантайме модули и типичные входы/выходы (для конструктора и документации). */
export interface ModuleCatalogEntry {
  id: ModuleId;
  label: string;
  description: string;
  typicalRequires: ArtifactTypeId[];
  typicalProduces: ArtifactTypeId[];
}

export const PIPELINE_MODULE_CATALOG: ModuleCatalogEntry[] = [
  {
    id: "AUDIO_FROM_UPLOAD",
    label: "АУДИО ФАЙЛ",
    description: "Источник AUDIO из локально загруженного файла (local://uploads/...).",
    typicalRequires: ["AUDIO_SOURCE"],
    typicalProduces: ["AUDIO"],
  },
  {
    id: "AUDIO_FROM_URL",
    label: "АУДИО URL",
    description: "Источник AUDIO по прямому URL (HTTP/HTTPS download).",
    typicalRequires: ["AUDIO_SOURCE"],
    typicalProduces: ["AUDIO"],
  },
  {
    id: "AUDIO_FROM_API",
    label: "АУДИО API",
    description: "Источник AUDIO из внешнего API (endpoint/method/headers/body).",
    typicalRequires: ["AUDIO_SOURCE"],
    typicalProduces: ["AUDIO"],
  },
  {
    id: "AUDIO_FROM_RTSP",
    label: "АУДИО RTSP",
    description: "Источник AUDIO из RTSP-потока (захват во временный wav через ffmpeg).",
    typicalRequires: ["AUDIO_SOURCE"],
    typicalProduces: ["AUDIO"],
  },
  {
    id: "CHECKLIST_SOURCE",
    label: "ЧЕК-ЛИСТ (ФАЙЛ)",
    description:
      "Читает внешний JSON чек-листа и отдаёт артефакт CHECKLIST_DEFINITION (источник тем/пунктов для анализа).",
    typicalRequires: [],
    typicalProduces: ["CHECKLIST_DEFINITION"],
  },
  {
    id: "AUDIO_PREPARE",
    label: "APREP",
    description:
      "Подготовка аудио: нормализация под модель (mono/Hz), единый prepared URL и универсальные чанки таймлайна.",
    typicalRequires: ["AUDIO"],
    typicalProduces: ["AUDIO_PREPARED"],
  },
  {
    id: "ASR",
    label: "ASR",
    description:
      "Распознавание речи (faster-whisper): рабочий путь AUDIO_PREPARED → TEXT, fallback-вход AUDIO сохранён.",
    typicalRequires: ["AUDIO_PREPARED", "AUDIO"],
    typicalProduces: ["TEXT"],
  },
  {
    id: "DIARIZATION",
    label: "ДИАРИЗАЦИЯ",
    description:
      "Диаризация (pyannote / эвристика). Входы: AUDIO_PREPARED и TEXT. Выход: SPEAKER_SEGMENTS.",
    typicalRequires: ["AUDIO_PREPARED", "TEXT"],
    typicalProduces: ["SPEAKER_SEGMENTS"],
  },
  {
    id: "SPEAKER_TURN_MERGE",
    label: "СЛИЯНИЕ РЕПЛИК",
    description:
      "Сливает подряд идущие сегменты одного спикера в одну реплику. На выходе **READY_SPEAKERS** (автопуть) и **DRAFT_SPEAKERS** (тот же черновик для модуля ручной правки). Вход — **SPEAKER_SEGMENTS** или **TRANSCRIPT_SEGMENTS** с диаризации.",
    typicalRequires: ["SPEAKER_SEGMENTS"],
    typicalProduces: ["READY_SPEAKERS", "DRAFT_SPEAKERS"],
  },
  {
    id: "SPEAKER_DRAFT_EDIT",
    label: "ПРАВКА СПИКЕРОВ",
    description:
      "Пауза пайплайна: таблица реплик в статусе сессии. Вход **DRAFT_SPEAKERS**, после «Продолжить» в стор записывается **READY_SPEAKERS** и запускается хвост сценария.",
    typicalRequires: ["DRAFT_SPEAKERS"],
    typicalProduces: ["READY_SPEAKERS"],
  },
  {
    id: "PSYCH_STATE",
    label: "PROSODY",
    description:
      "Просодика (librosa): канонично читает **READY_SPEAKERS** + AUDIO_PREPARED (fallback в config: DRAFT/SPEAKER_SEGMENTS). Детерминированный матчинг по JSON-лексикону → **PSYCH_LABELS** (psych_matcher_v1); плюс **ENRICHED_TRANSCRIPT** с метриками сегментов.",
    typicalRequires: ["READY_SPEAKERS", "AUDIO_PREPARED"],
    typicalProduces: ["ENRICHED_TRANSCRIPT", "PSYCH_LABELS"],
  },
  {
    id: "LLM_TASK_SUMMARY",
    label: "ОБОБЩЕНИЕ (LLM)",
    description:
      "Подзадача на графе: структурированная суммаризация **LLM_SUMMARY** (+ короткий fallback **SUMMARY_TEXT**). Канонический вход — **READY_SPEAKERS**; опционально **SPEAKER_IDENTITY_MAP** и психо-артефакты как контекст. Соедините выход **LLM_SUBTASK** с **LLM_PUPPET**.",
    typicalRequires: getContractOrThrow("LLM_TASK_SUMMARY").inputArtifacts,
    typicalProduces: getContractOrThrow("LLM_TASK_SUMMARY").outputArtifacts,
  },
  {
    id: "LLM_TASK_SPEAKER_NAMES",
    label: "ДЕАНОН (LLM)",
    description:
      "Подзадача: SPEAKER_IDENTITY_MAP (IDM). \nКанонический вход — **READY_SPEAKERS** (RDY). \nВозвращает identity-map отдельно от таймлайна: speakerId + displayName + role. \n**LLM_SUBTASK** → **LLM_PUPPET**.",
    typicalRequires: getContractOrThrow("LLM_TASK_SPEAKER_NAMES").inputArtifacts,
    typicalProduces: getContractOrThrow("LLM_TASK_SPEAKER_NAMES").outputArtifacts,
  },
  {
    id: "LLM_TASK_PSYCH",
    label: "РАЗБОР (LLM)",
    description:
      "LLM для нарратива и (опционально) проверки словарных prosody-совпадений: **READY_SPEAKERS** + **PSYCH_LABELS**. При `enableLlmLexiconCheck=true` модель валидирует weak/все сегменты и возвращает source=rules|llm|mixed; плюс **LLM_PSYCH_NARRATIVE** (JSON с narrative.timelineEvents). **LLM_SUBTASK** → **LLM_PUPPET**.",
    typicalRequires: getContractOrThrow("LLM_TASK_PSYCH").inputArtifacts,
    typicalProduces: getContractOrThrow("LLM_TASK_PSYCH").outputArtifacts,
  },
  {
    id: "LLM_TASK_CHECKLIST",
    label: "ЧЕК-ЛИСТ (LLM)",
    description: "Подзадача: CHECKLIST_RESULTS. **LLM_SUBTASK** → **LLM_PUPPET**.",
    typicalRequires: getContractOrThrow("LLM_TASK_CHECKLIST").inputArtifacts,
    typicalProduces: getContractOrThrow("LLM_TASK_CHECKLIST").outputArtifacts,
  },
  {
    id: "LLM_PUPPET",
    label: "ПУЛЬТ (LLM)",
    description:
      "Единственный узел вызова модели. Подключайте **LLM_SUBTASK** от подзадач `LLM_TASK_*`; порядок вызовов — `llmRunOrder` на шагах подзадач. Пульт не работает без подключенной хотя бы одной подзадачи.",
    typicalRequires: ["LLM_SUBTASK"],
    typicalProduces: [
      "SUMMARY_TEXT",
      "LLM_SUMMARY",
      "CHECKLIST_RESULTS",
      "PSYCH_LABELS",
      "PSYCH_NARRATIVE",
      "SPEAKER_IDENTITY_MAP",
    ],
  },
  {
    id: "REPORT_OUTPUT",
    label: "ОТЧЕТ",
    description:
      "Собирает SessionReport из артефактов сессии. В графе — один мультивход: подключите один или несколько допустимых типов (TEXT, SPEAKER_SEGMENTS, ENRICHED_TRANSCRIPT, SUMMARY_TEXT, PSYCH_*, CHECKLIST_RESULTS). В плитке модуля доступны чекбоксы renderInputs для включения/выключения рендера каждого типа в итоговый отчет.",
    typicalRequires: [],
    typicalProduces: ["SESSION_REPORT"],
  },
];

function getContractOrThrow(moduleId: ModuleId): {
  inputArtifacts: ArtifactTypeId[];
  outputArtifacts: ArtifactTypeId[];
} {
  const c = getLlmTaskContract(moduleId);
  if (!c) {
    throw new Error(`LLM contract not found for module: ${moduleId}`);
  }
  return {
    inputArtifacts: [...c.inputArtifacts],
    outputArtifacts: [...c.outputArtifacts],
  };
}
