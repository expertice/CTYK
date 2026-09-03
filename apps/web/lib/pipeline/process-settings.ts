export interface ProcessSettings {
  enforceGraphModulePortsMatchProgram: boolean;
  enforceEdgeTypeCompatibility: boolean;
  showUniversalInputForReport: boolean;
}

export const DEFAULT_PROCESS_SETTINGS: ProcessSettings = {
  enforceGraphModulePortsMatchProgram: true,
  enforceEdgeTypeCompatibility: true,
  showUniversalInputForReport: true,
};

export function parseProcessSettings(raw: unknown): ProcessSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_PROCESS_SETTINGS;
  const casted = raw as Partial<ProcessSettings>;
  return {
    enforceGraphModulePortsMatchProgram:
      typeof casted.enforceGraphModulePortsMatchProgram === "boolean"
        ? casted.enforceGraphModulePortsMatchProgram
        : DEFAULT_PROCESS_SETTINGS.enforceGraphModulePortsMatchProgram,
    enforceEdgeTypeCompatibility:
      typeof casted.enforceEdgeTypeCompatibility === "boolean"
        ? casted.enforceEdgeTypeCompatibility
        : DEFAULT_PROCESS_SETTINGS.enforceEdgeTypeCompatibility,
    showUniversalInputForReport:
      typeof casted.showUniversalInputForReport === "boolean"
        ? casted.showUniversalInputForReport
        : DEFAULT_PROCESS_SETTINGS.showUniversalInputForReport,
  };
}

export function toNormalizeProcessSettings(process: ProcessSettings) {
  return {
    enforceGraphModulePortsMatchProgram: process.enforceGraphModulePortsMatchProgram,
  };
}

export function toValidationProcessSettings(process: ProcessSettings) {
  return {
    enforceEdgeTypeCompatibility: process.enforceEdgeTypeCompatibility,
    showUniversalInputForReport: process.showUniversalInputForReport,
  };
}
