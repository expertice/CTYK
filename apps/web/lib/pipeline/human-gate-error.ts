/** Бросается модулем, ожидающим ввод человека; оркестратор переводит прогон в `paused`. */
export class HumanGateError extends Error {
  readonly gate: string;

  constructor(gate: string, message?: string) {
    super(message ?? `Human gate: ${gate}`);
    this.name = "HumanGateError";
    this.gate = gate;
  }
}

export function isHumanGateError(e: unknown): e is HumanGateError {
  return e instanceof HumanGateError;
}
