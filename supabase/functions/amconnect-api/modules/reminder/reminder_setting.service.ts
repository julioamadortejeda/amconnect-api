import { NotFoundError } from "../../shared/errors.ts";
import {
  DEFAULT_DAYS_BEFORE,
  GENERATED_REMINDER_TYPE_CODES,
} from "./reminder_generation.constants.ts";
import type { ReminderTypeRow } from "./reminder_generation.repository.ts";
import type {
  ReminderSettingDTO,
  ReminderSettingRequestDTO,
} from "./reminder_setting.dto.ts";
import type {
  IReminderSettingRepository,
  ReminderSettingRow,
} from "./reminder_setting.repository.ts";

export interface ResolvedSetting {
  daysBefore: number;
  isActive: boolean;
}

/**
 * Answers "how many days ahead do we warn for this type on this branch?" without
 * hitting the database again. Built once per run so the daily job can walk a
 * whole book of policies with a single settings query.
 *
 * Precedence: per-branch row → advisor's default row → built-in default.
 */
export class ReminderSettingResolver {
  private readonly byType = new Map<string, ReminderSettingRow>();
  private readonly byTypeAndBranch = new Map<string, ReminderSettingRow>();
  private readonly typesById = new Map<string, ReminderTypeRow>();
  private readonly typesByCode = new Map<string, ReminderTypeRow>();

  constructor(rows: ReminderSettingRow[], types: ReminderTypeRow[]) {
    for (const type of types) {
      this.typesById.set(type.id, type);
      this.typesByCode.set(type.code, type);
    }
    for (const row of rows) {
      if (row.branchId === null) this.byType.set(row.reminderTypeId, row);
      else this.byTypeAndBranch.set(`${row.reminderTypeId}:${row.branchId}`, row);
    }
  }

  type(code: string): ReminderTypeRow | undefined {
    return this.typesByCode.get(code);
  }

  resolve(typeCode: string, branchId: string | null): ResolvedSetting {
    const type = this.typesByCode.get(typeCode);
    const fallback = { daysBefore: DEFAULT_DAYS_BEFORE[typeCode] ?? 0, isActive: true };
    if (!type) return fallback;

    const override = branchId ? this.byTypeAndBranch.get(`${type.id}:${branchId}`) : undefined;
    const row = override ?? this.byType.get(type.id);
    if (!row) return fallback;

    return { daysBefore: row.daysBefore, isActive: row.isActive };
  }

  /** Stored default row for a type, if the advisor customised it. */
  storedDefault(typeId: string): ReminderSettingRow | undefined {
    return this.byType.get(typeId);
  }

  overridesFor(typeId: string): ReminderSettingRow[] {
    return [...this.byTypeAndBranch.values()].filter((r) => r.reminderTypeId === typeId);
  }
}

export class ReminderSettingService {
  constructor(
    private readonly repository: IReminderSettingRepository,
    private readonly agentId: string,
  ) {}

  async buildResolver(): Promise<ReminderSettingResolver> {
    const [rows, types] = await Promise.all([
      this.repository.findAllByAgent(this.agentId),
      this.repository.findTypesByCodes(GENERATED_REMINDER_TYPE_CODES),
    ]);
    return new ReminderSettingResolver(rows, types);
  }

  /**
   * The configuration as the advisor should see it: every generated type with the
   * values actually in force, so no client has to know the built-in defaults.
   */
  async getEffective(): Promise<ReminderSettingDTO[]> {
    const [resolver, branches] = await Promise.all([
      this.buildResolver(),
      this.repository.findBranches(this.agentId),
    ]);
    const branchNames = new Map(branches.map((b) => [b.id, b.name]));

    const settings: ReminderSettingDTO[] = [];
    for (const code of GENERATED_REMINDER_TYPE_CODES) {
      const type = resolver.type(code);
      if (!type) continue;

      const stored = resolver.storedDefault(type.id);
      const effective = resolver.resolve(code, null);

      settings.push({
        typeId: type.id,
        typeCode: type.code,
        typeName: type.name,
        daysBefore: effective.daysBefore,
        isActive: effective.isActive,
        isCustomized: stored !== undefined,
        settingId: stored?.id ?? null,
        overrides: resolver
          .overridesFor(type.id)
          // A branch the advisor deleted leaves its override behind; skip it.
          .filter((row) => row.branchId !== null && branchNames.has(row.branchId))
          .map((row) => ({
            id: row.id,
            branchId: row.branchId as string,
            branchName: branchNames.get(row.branchId as string) as string,
            daysBefore: row.daysBefore,
            isActive: row.isActive,
          }))
          .sort((a, b) => a.branchName.localeCompare(b.branchName)),
      });
    }

    return settings;
  }

  /** Saves one value and returns the whole configuration, already re-resolved. */
  async update(input: ReminderSettingRequestDTO): Promise<ReminderSettingDTO[]> {
    const resolver = await this.buildResolver();
    const requestedCode = input.reminderTypeCode?.toUpperCase();
    const type = input.reminderTypeId
      ? GENERATED_REMINDER_TYPE_CODES.map((c) => resolver.type(c)).find((t) => t?.id === input.reminderTypeId)
      : requestedCode
      ? resolver.type(requestedCode)
      : undefined;

    if (!type) {
      throw new NotFoundError("Ese tipo de recordatorio no existe o no se genera automáticamente.");
    }

    const branchId = input.branchId ?? null;
    // Se escriben SIEMPRE los dos valores. Si solo se manda uno, el otro se
    // rellena con el que ya estaba en vigor: la columna days_before tiene
    // `default 30` en la BD, así que insertar una fila a medias haría que
    // apagar un aviso le cambiara la ventana de paso.
    const current = resolver.resolve(type.code, branchId);

    await this.repository.upsert({
      agentId: this.agentId,
      reminderTypeId: type.id,
      branchId,
      daysBefore: input.daysBefore ?? current.daysBefore,
      isActive: input.isActive ?? current.isActive,
    });

    return this.getEffective();
  }

  /** Quita la excepción de un ramo: ese ramo vuelve a seguir el default. */
  async removeOverride(typeCode: string, branchId: string): Promise<ReminderSettingDTO[]> {
    const resolver = await this.buildResolver();
    const type = resolver.type(typeCode.toUpperCase());
    if (!type) {
      throw new NotFoundError("Ese tipo de recordatorio no existe o no se genera automáticamente.");
    }

    await this.repository.deleteOverride(this.agentId, type.id, branchId);
    return this.getEffective();
  }
}
